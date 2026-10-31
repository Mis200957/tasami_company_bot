(function () {
  'use strict';
  var API = window.TSM_API;
  var app = document.getElementById('app');
  var modalRoot = document.getElementById('modal-root');
  var toastEl = document.getElementById('toast');

  var state = { token: null, user: null, view: 'home', counts: {}, cache: {} };

  // ------------------------------------------------------------ helpers
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n2(v) { return v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(v) { if (v == null) return '—'; var x = Number(v); return (x > 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function time(v) {
    if (!v) return '—';
    if (v === 'infinity') return 'حتى ترجّعه للبوت';
    return new Date(v).toLocaleString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
  }
  function ago(v) {
    if (!v) return '—';
    var m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
    if (m < 1) return 'الآن'; if (m < 60) return 'منذ ' + m + ' د';
    var h = Math.round(m / 60); if (h < 48) return 'منذ ' + h + ' س';
    return 'منذ ' + Math.round(h / 24) + ' يوم';
  }
  function toast(msg, isErr) {
    toastEl.textContent = msg; toastEl.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toast.t); toast.t = setTimeout(function () { toastEl.className = ''; }, 3200);
  }
  var ERR = {
    bad_login: 'اسم المستخدم أو كلمة المرور غير صحيحة', locked: 'الحساب مقفول مؤقتًا بعد محاولات خاطئة، جرّب بعد قليل',
    bad_code: 'رمز التفعيل غير صحيح', bad_username: 'اسم المستخدم: حروف إنجليزية صغيرة وأرقام فقط (3 أحرف على الأقل)',
    weak_password: 'كلمة المرور لازم تكون 10 أحرف على الأقل', already_setup: 'تم إنشاء المدير من قبل، سجّل دخولك',
    forbidden: 'هذه العملية للمدير فقط', duplicate: 'الرقم أو الاسم مسجل من قبل', bad_phone: 'رقم الجوال غير صحيح',
    bad_value: 'قيمة غير صحيحة', stale: 'تم التعامل مع هذه الرسالة من قبل، حدّث الصفحة', not_found: 'غير موجود',
    self_lockout: 'لا يمكنك إيقاف حسابك أو إزالة صلاحية المدير عن نفسك', not_authorized: 'غير مصرح لك باعتماد الأسعار',
    network: 'تعذر الاتصال بالخادم', server: 'حدث خطأ في الخادم', no_items: 'أضف صنف واحد على الأقل',
    no_price: 'فيه صنف مالوش سعر بالعبوة دي. اختار عبوة من القائمة أو اكتب السعر بإيدك', bad_item: 'فيه صنف أو كمية مش صحيحة', locked: 'العرض اتبعت خلاص ومينفعش يتعدّل، اعمل عرض جديد',
    no_pdf: 'ملف PDF لسه بيتجهز، جرّب بعد دقيقة'
  };
  function errText(r) {
    var k = r && (r.error || r.reason) || 'server';
    if (k.indexOf('already_') === 0) return 'تم التعامل مع هذا السعر من قبل';
    return ERR[k] || k;
  }

  function api(action, data) {
    return fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, cache: 'no-store',
      body: JSON.stringify({ action: action, token: state.token, data: data || {} })
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'network' }; }).then(function (r) {
      if (r && r.error === 'auth') { signOut(true); throw new Error('auth'); }
      return r || { ok: false, error: 'server' };
    });
  }
  function act(action, data, okMsg) {
    return api(action, data).then(function (r) {
      if (!r.ok) { toast(errText(r), true); return null; }
      if (okMsg) toast(okMsg);
      return r;
    });
  }
  function isAdmin() { return state.user && state.user.role === 'admin'; }

  // ------------------------------------------------------------ labels
  var KIND = { supplier_checkin: 'متابعة يومية', merchant_quote_24h: 'متابعة عرض · 24 ساعة', merchant_quote_72h: 'متابعة عرض · 3 أيام', merchant_quote_168h: 'متابعة عرض · 7 أيام', manual: 'رسالة يدوية', auto_reply: 'رد تلقائي', quote_pdf: 'عرض سعر (PDF)' };
  var OUT = { pending_approval: ['بانتظار موافقتك', 'acc'], queued: ['جاهزة للإرسال', 'good'], previewed: ['معاينة على تيليجرام', ''], sending: ['جارٍ الإرسال', ''], sent: ['أُرسلت', 'good'], failed: ['فشلت', 'bad'], skipped: ['لم تُرسل', 'warn'], cancelled: ['ملغاة', ''] };
  var SKIP = { human_takeover: 'المحادثة مع موظف', contact_paused: 'جهة الاتصال موقوفة', followups_off: 'المتابعة مقفولة', demo_contact: 'رقم تجريبي' };
  var FAIL = { needs_template: 'خارج نافذة الـ 24 ساعة ومفيش قالب معتمد لهذا النوع', no_inbox: 'رقم واتساب الخط ده مش متحدد في الإعدادات', no_pdf: 'ملف العرض ماكانش جاهز' };
  var QSTATUS = { draft: ['مسودة', ''], needs_review: ['بانتظار اعتمادك', 'acc'], approved: ['معتمد · جاري الإرسال', 'warn'], sent: ['اتبعت', 'good'], accepted: ['اتقبل', 'good'], rejected: ['اترفض', 'bad'], expired: ['انتهت صلاحيته', ''], cancelled: ['ملغي', ''] };
  function whoApproved(v) { if (!v) return '—'; if (v === 'bot') return 'البوت تلقائيًا'; return String(v).replace('panel:', '').replace('telegram:', 'تيليجرام: '); }
  var TRUST = { new: ['جديد', 'warn'], trusted: ['موثوق', 'good'], blocked: ['محظور', 'bad'] };
  var MSTATUS = { lead: ['محتمل', 'warn'], active: ['نشط', 'good'], inactive: ['غير نشط', ''], blocked: ['محظور', 'bad'] };
  var ACTION = { setup: 'إنشاء المدير', login: 'تسجيل دخول', login_failed: 'محاولة دخول خاطئة', supplier_save: 'تعديل مورد', merchant_save: 'تعديل تاجر',
    takeover_start: 'إيقاف البوت ودخول موظف', takeover_end: 'إرجاع المحادثة للبوت', send_message: 'رسالة يدوية', outbox_approve: 'اعتماد رسالة',
    outbox_cancel: 'إلغاء رسالة', outbox_approve_all: 'اعتماد كل الرسائل', price_approve: 'اعتماد سعر', price_reject: 'رفض سعر',
    setting_save: 'تغيير إعداد', outbox_retry: 'إعادة محاولة إرسال', pricing_rule_save: 'تعديل نسبة ربح', pricing_rule_delete: 'حذف نسبة ربح', sell_price_apply: 'اعتماد سعر بيع', sell_price_apply_all: 'اعتماد كل أسعار البيع', user_save: 'تعديل مستخدم', change_password: 'تغيير كلمة المرور',
    quote_save: 'حفظ عرض سعر', quote_approve: 'اعتماد عرض سعر', quote_cancel: 'إلغاء عرض سعر', quote_resend: 'إعادة إرسال عرض سعر', quote_accepted: 'العرض اتقبل', quote_rejected: 'العرض اترفض' };
  function pill(map, k) { var v = map[k] || [k, '']; return '<span class="pill ' + v[1] + '">' + esc(v[0]) + '</span>'; }
  function outPill(o) {
    var p = pill(OUT, o.status);
    if (o.status === 'skipped' && SKIP[o.error]) p += ' <span class="label">' + esc(SKIP[o.error]) + '</span>';
    if (o.status === 'failed' && o.error) p += ' <span class="label">' + esc(FAIL[o.error] || 'خطأ من رمّانة') + '</span>';
    return p;
  }
  var LOGO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/></svg>';

  // ------------------------------------------------------------ login
  function signOut(expired) {
    state.token = null; state.user = null; state.afterClose = null; store('tsm_token', null);
    showLogin(expired ? 'انتهت الجلسة، سجّل الدخول مرة أخرى' : '');
  }
  function showLogin(msg) {
    closeModal();
    api('setup_status').then(function (r) {
      var setup = r.ok && r.needs_setup;
      app.innerHTML = '<div class="login"><form class="panel form" id="login-form" autocomplete="on">' +
        '<div class="brand"><div class="mark">' + LOGO + '</div><div><h1>لوحة تحكم تسامي</h1><div class="muted">' + (setup ? 'إنشاء حساب المدير الأول' : 'تسجيل الدخول') + '</div></div></div>' +
        (setup ? '<label class="field"><span>رمز التفعيل</span><input type="text" name="code" required autocomplete="off" dir="ltr"><small>تجده في n8n داخل workflow لوحة التحكم</small></label>' +
                 '<label class="field"><span>الاسم الظاهر</span><input type="text" name="display_name" placeholder="محمد"></label>' : '') +
        '<label class="field"><span>اسم المستخدم</span><input type="text" name="username" required autocomplete="username" dir="ltr"></label>' +
        '<label class="field"><span>كلمة المرور</span><input type="password" name="password" required autocomplete="' + (setup ? 'new-password' : 'current-password') + '" dir="ltr">' + (setup ? '<small>10 أحرف على الأقل</small>' : '') + '</label>' +
        '<div class="err-line" id="login-err">' + esc(msg || '') + '</div>' +
        '<button class="btn primary" type="submit">' + (setup ? 'إنشاء الحساب والدخول' : 'دخول') + '</button></form></div>';
      document.getElementById('login-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target, btn = f.querySelector('button'); btn.disabled = true;
        var data = { username: f.username.value, password: f.password.value };
        if (setup) { data.code = f.code.value; data.display_name = f.display_name.value; }
        api(setup ? 'setup' : 'login', data).then(function (res) {
          btn.disabled = false;
          if (!res.ok) { document.getElementById('login-err').textContent = errText(res) + (res.minutes ? ' (' + res.minutes + ' دقيقة)' : ''); return; }
          state.token = res.token; state.user = res.user; store('tsm_token', res.token);
          renderShell(); go('home');
        });
      });
    });
  }

  // ------------------------------------------------------------ shell
  var VIEWS = [
    ['home', 'الرئيسية'], ['quotes', 'عروض الأسعار'], ['outbox', 'الرسائل الصادرة'], ['suppliers', 'الموردون'], ['merchants', 'التجار'],
    ['prices', 'اعتماد الأسعار'], ['pricing', 'التسعير'], ['settings', 'الإعدادات', true], ['users', 'المستخدمون', true], ['audit', 'سجل العمليات', true]
  ];
  function renderShell() {
    app.innerHTML = '<div class="shell"><aside class="side"><div class="brand"><div class="mark">' + LOGO + '</div><div><b>تسامي الوطنية</b><span class="label">لوحة التحكم</span></div></div>' +
      '<nav class="nav" id="nav"></nav><div class="side-foot"><span>' + esc(state.user.display_name) + ' · <span class="label">' + (isAdmin() ? 'مدير' : 'موظف') + '</span></span>' +
      '<span><button class="btn sm" id="pw-btn">كلمة المرور</button> <button class="btn sm" id="out-btn">خروج</button></span></div></aside>' +
      '<main class="main" id="main"></main></div>';
    document.getElementById('out-btn').onclick = function () { api('logout').catch(function () {}); signOut(false); };
    document.getElementById('pw-btn').onclick = passwordModal;
    renderNav();
  }
  function renderNav() {
    var nav = document.getElementById('nav'); if (!nav) return;
    nav.innerHTML = VIEWS.filter(function (v) { return !v[2] || isAdmin(); }).map(function (v) {
      var b = '';
      if (v[0] === 'outbox' && state.counts.outbox_pending) b = '<span class="badge num">' + state.counts.outbox_pending + '</span>';
      if (v[0] === 'quotes' && state.counts.quotes_review) b = '<span class="badge num">' + state.counts.quotes_review + '</span>';
      if (v[0] === 'prices' && state.counts.prices_pending) b = '<span class="badge num">' + state.counts.prices_pending + '</span>';
      return '<button data-view="' + v[0] + '" class="' + (state.view === v[0] ? 'on' : '') + '"><span>' + v[1] + '</span>' + b + '</button>';
    }).join('');
    nav.querySelectorAll('button').forEach(function (b) { b.onclick = function () { go(b.dataset.view); }; });
  }
  function go(view) {
    state.view = view; renderNav();
    var main = document.getElementById('main');
    main.innerHTML = '<p class="muted">جارٍ التحميل…</p>';
    ({ home: viewHome, quotes: viewQuotes, outbox: viewOutbox, suppliers: viewSuppliers, merchants: viewMerchants, prices: viewPrices, pricing: viewPricing,
       settings: viewSettings, users: viewUsers, audit: viewAudit }[view] || viewHome)(main);
  }
  function refreshCounts(r) {
    if (!r || !r.counts) return;
    state.counts.outbox_pending = r.counts.outbox_pending; state.counts.prices_pending = (r.data && r.data.kpi && r.data.kpi.pending) || 0;
    renderNav();
  }
  function head(title, sub, tools) {
    return '<div class="page-head"><div><h1>' + title + '</h1>' + (sub ? '<p class="muted">' + sub + '</p>' : '') + '</div>' + (tools ? '<div class="toolbar">' + tools + '</div>' : '') + '</div>';
  }

  // ------------------------------------------------------------ home
  function viewHome(main) {
    api('overview').then(function (r) {
      if (!r.ok) { main.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
      refreshCounts(r);
      var D = r.data, k = D.kpi || {}, c = r.counts || {};
      var chips = '<span class="chip"><span class="dot ' + (D.whatsapp_connected ? '' : 'off') + '"></span>' + (D.whatsapp_connected ? 'واتساب متصل' : 'واتساب غير مربوط بعد') + '</span>' +
        '<span class="chip"><span class="dot ' + (r.require_approval ? 'off' : '') + '"></span>' + (r.require_approval ? 'رسائل البوت تنتظر موافقتك' : 'رسائل البوت تُرسل تلقائيًا') + '</span>' +
        (D.demo_rows > 0 ? '<span class="chip"><span class="pill warn">تشمل بيانات تجريبية</span></span>' : '');
      var html = head('أهلًا ' + esc(state.user.display_name), 'آخر تحديث ' + time(D.generated_at), '<div class="chips">' + chips + '</div>');
      html += '<section class="kpis">' +
        '<button class="kpi attn" data-go="outbox"><span class="label">رسائل بانتظار موافقتك</span><b class="num">' + (c.outbox_pending || 0) + '</b><span class="label">اضغط للمراجعة</span></button>' +
        '<button class="kpi attn" data-go="prices"><span class="label">أسعار بانتظار الاعتماد</span><b class="num">' + (k.pending || 0) + '</b><span class="label">' + (k.oldest_pending_min != null ? 'أقدمها ' + ago(Date.now() - k.oldest_pending_min * 60000) : 'لا شيء معلق') + '</span></button>' +
        '<div class="kpi"><span class="label">محادثات مع موظف الآن</span><b class="num">' + (c.takeovers || 0) + '</b><span class="label">البوت صامت معهم</span></div>' +
        '<div class="kpi"><span class="label">رسائل أسعار اليوم</span><b class="num">' + (k.received_today || 0) + '</b><span class="label">من <span class="num">' + (k.suppliers_today || 0) + '</span> موردين · <span class="num">' + (c.suppliers || 0) + '</span> مورد نشط</span></div></section>';
      var recent = (D.recent || []).slice(0, 6).map(function (x) {
        return '<tr><td>' + esc(x.product) + ' · ' + esc(x.pack || x.unit) + '</td><td>' + esc(x.supplier) + '</td><td class="num">' + n2(x.prev) + ' → ' + n2(x.price) + '</td><td class="num ' + (x.change_pct > 0 ? 'up' : x.change_pct < 0 ? 'down' : '') + '">' + pct(x.change_pct) + '</td><td>' + (x.auto ? '<span class="pill">تلقائي</span>' : '<span class="pill good">يدوي</span>') + '</td></tr>';
      }).join('');
      var quotes = (D.quotes || []).slice(0, 6).map(function (q) {
        var steps = (q.steps || []).map(function (s) { return '<span class="pill ' + (s.status === 'sent' ? 'good' : s.status === 'pending' ? 'acc' : '') + '">' + esc({ '24h': '24س', '72h': '3 أيام', '168h': '7 أيام' }[s.step] || s.step) + '</span>'; }).join(' ');
        return '<tr><td class="num">' + esc(q.quote_no) + '</td><td>' + esc(q.merchant) + '</td><td class="num">' + n2(q.total) + '</td><td>' + steps + '</td></tr>';
      }).join('');
      html += '<div class="grid2"><section class="panel"><div class="panel-head"><h2>آخر التغييرات المعتمدة</h2><span class="label">7 أيام</span></div>' +
        (recent ? '<div class="table-wrap"><table style="min-width:0"><thead><tr><th>الصنف</th><th>المورد</th><th>السعر</th><th>التغير</th><th></th></tr></thead><tbody>' + recent + '</tbody></table></div>' : '<p class="empty">لا توجد تغييرات بعد.</p>') + '</section>' +
        '<section class="panel"><div class="panel-head"><h2>متابعة عروض التجار</h2><span class="label">24 ساعة · 3 أيام · 7 أيام</span></div>' +
        (quotes ? '<div class="table-wrap"><table style="min-width:0"><thead><tr><th>العرض</th><th>التاجر</th><th>القيمة</th><th>المتابعة</th></tr></thead><tbody>' + quotes + '</tbody></table></div>' : '<p class="empty">لا توجد عروض مرسلة بعد.</p>') + '</section></div>';
      main.innerHTML = html;
      main.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.dataset.go); }; });
    });
  }

  // ------------------------------------------------------------ outbox
  var outFilter = 'pending';
  function viewOutbox(main) {
    api('outbox', { filter: outFilter }).then(function (r) {
      if (!r.ok) { main.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
      var items = r.items || [];
      var pending = items.filter(function (o) { return o.status === 'pending_approval'; }).length;
      if (outFilter === 'pending') { state.counts.outbox_pending = pending; renderNav(); }
      var tools = '<select id="of" aria-label="عرض"><option value="pending"' + (outFilter === 'pending' ? ' selected' : '') + '>بانتظار موافقتك</option><option value="all"' + (outFilter === 'all' ? ' selected' : '') + '>كل الرسائل</option></select>' +
        (pending > 1 ? '<button class="btn primary" id="approve-all">اعتماد الكل (' + pending + ')</button>' : '');
      var html = head('الرسائل الصادرة', 'كل رسالة يكتبها البوت تمر من هنا. تقدر تعدّل النص قبل الاعتماد أو تلغيها.', tools);
      html += '<div class="msgs">' + (items.map(function (o) {
        var open = o.status === 'pending_approval';
        return '<article class="msg' + (open ? '' : ' done') + '" data-id="' + o.id + '"><div class="msg-top"><div><b>' + (o.line === 'supplier' ? 'مورد' : 'تاجر') + ': ' + esc(o.to) + '</b> <span class="label num">' + esc(o.phone) + '</span><div class="label">' + esc(KIND[o.kind] || o.kind) + ' · ' + time(o.at) + (o.by ? ' · ' + esc(o.by.replace('panel:', '')) : '') + '</div></div>' + outPill(o) + '</div>' +
          (open ? '<textarea aria-label="نص الرسالة" rows="' + Math.min(12, String(o.body).split('\n').length + 1) + '">' + esc(o.body) + '</textarea><div class="msg-actions"><button class="btn primary" data-a="approve">اعتماد وإرسال</button><button class="btn danger" data-a="cancel">إلغاء</button>' + (o.contact_id ? '<button class="btn" data-a="chat">فتح المحادثة</button>' : '') + '</div>'
                : '<div class="msg-body">' + esc(o.body) + '</div>' + (o.original_body ? '<div class="label">عُدّلت قبل الإرسال</div>' : '') + (o.status === 'failed' ? '<div class="msg-actions"><button class="btn" data-a="retry">إعادة المحاولة</button>' + (o.contact_id ? '<button class="btn" data-a="chat">فتح المحادثة</button>' : '') + '</div>' : '')) +
          '</article>';
      }).join('') || '<p class="empty">' + (outFilter === 'pending' ? 'لا توجد رسائل تنتظر موافقتك.' : 'لا توجد رسائل بعد.') + '</p>') + '</div>';
      main.innerHTML = html;
      document.getElementById('of').onchange = function (e) { outFilter = e.target.value; go('outbox'); };
      var all = document.getElementById('approve-all');
      if (all) all.onclick = function () { act('outbox_approve_all', {}, 'تم اعتماد الرسائل').then(function (x) { if (x) go('outbox'); }); };
      main.querySelectorAll('.msg').forEach(function (card) {
        var id = Number(card.dataset.id), o = items.filter(function (i) { return i.id === id; })[0];
        card.querySelectorAll('[data-a]').forEach(function (b) {
          b.onclick = function () {
            if (b.dataset.a === 'chat') { chatModal(o.line, o.contact_id, o.to); return; }
            b.disabled = true;
            var p = b.dataset.a === 'approve' ? act('outbox_approve', { id: id, body: card.querySelector('textarea').value }, 'تم الاعتماد')
                  : b.dataset.a === 'retry' ? act('outbox_retry', { id: id }, 'رجعت لطابور الإرسال')
                  : act('outbox_cancel', { id: id }, 'تم الإلغاء');
            p.then(function (x) { if (x) go('outbox'); else b.disabled = false; });
          };
        });
      });
    });
  }


  // ------------------------------------------------------------ quotes
  var quoteFilter = 'open';
  function viewQuotes(main) {
    api('quotes', { filter: quoteFilter }).then(function (r) {
      if (!r.ok) { main.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
      var items = r.items || [];
      var review = items.filter(function (q) { return q.status === 'needs_review' || q.status === 'draft'; }).length;
      if (quoteFilter === 'open') { state.counts.quotes_review = items.filter(function (q) { return q.status === 'needs_review'; }).length; renderNav(); }
      var tools = '<input type="text" class="search" id="q" placeholder="بحث برقم العرض أو التاجر">' +
        '<select id="qf" aria-label="عرض"><option value="open"' + (quoteFilter === 'open' ? ' selected' : '') + '>المفتوحة</option><option value="all"' + (quoteFilter === 'all' ? ' selected' : '') + '>كل العروض</option></select>' +
        '<button class="btn primary" id="new-q">عرض سعر جديد</button>';
      var rows = items.map(function (q) {
        var m = q.merchant || {}, send = q.send ? pill(OUT, q.send.status) : '';
        return '<tr data-id="' + q.id + '"><td><b class="num">' + esc(q.quote_no) + '</b><div class="label">' + time(q.created_at) + '</div></td>' +
          '<td class="who"><b>' + esc(m.company || m.name || '—') + '</b><span class="label num">' + esc(m.phone || '') + '</span></td>' +
          '<td class="num">' + (q.items || []).length + '</td><td><b class="num">' + n2(q.total) + '</b><div class="label">شامل الضريبة</div></td>' +
          '<td>' + pill(QSTATUS, q.status) + '</td><td>' + esc(whoApproved(q.approved_by)) + '</td><td>' + send + (q.has_pdf ? ' <span class="pill">PDF</span>' : '') + '</td>' +
          '<td class="actions"><button class="btn sm' + (q.status === 'needs_review' ? ' primary' : '') + '" data-open="' + q.id + '">' + (q.status === 'needs_review' && isAdmin() ? 'مراجعة واعتماد' : 'فتح') + '</button></td></tr>';
      }).join('');
      main.innerHTML = head('عروض الأسعار', 'البوت بيعمل العروض ويبعتها لوحده تحت الحد اللي محدده. اللي فوق الحد أو فيه صنف مالوش سعر بيستنى اعتمادك هنا أو على تيليجرام.', tools) +
        (review ? '<section class="panel"><span class="pill acc">' + review + ' عرض مستني مراجعة</span></section>' : '') +
        '<section class="panel">' + (rows ? '<div class="table-wrap"><table><thead><tr><th>العرض</th><th>التاجر</th><th>أصناف</th><th>الإجمالي</th><th>الحالة</th><th>اعتمده</th><th>الإرسال</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<p class="empty">' + (quoteFilter === 'open' ? 'مفيش عروض مفتوحة.' : 'مفيش عروض لسه.') + '</p>') + '</section>';
      filterRows(main, document.getElementById('q'));
      document.getElementById('qf').onchange = function (e) { quoteFilter = e.target.value; go('quotes'); };
      document.getElementById('new-q').onclick = function () { quoteModal(null); };
      main.querySelectorAll('[data-open]').forEach(function (b) {
        b.onclick = function () { quoteModal(items.filter(function (q) { return q.id === Number(b.dataset.open); })[0]); };
      });
    });
  }

  function loadCatalog() {
    if (state.cache.catalog && Date.now() - state.cache.catalogAt < 120000) return Promise.resolve(state.cache.catalog);
    return api('quote_catalog').then(function (r) { if (r.ok) { state.cache.catalog = r; state.cache.catalogAt = Date.now(); } return r; });
  }

  function downloadPdf(q) {
    act('quote_pdf', { id: q.id }).then(function (r) {
      if (!r) return;
      var bin = atob(r.base64), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
      var a = document.createElement('a'); a.href = url; a.download = r.file_name || 'quote.pdf'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }

  function quoteModal(q) {
    loadCatalog().then(function (cat) {
      if (!cat || !cat.ok) { toast(errText(cat), true); return; }
      var editable = !q || ['draft', 'needs_review', 'approved'].indexOf(q.status) >= 0;
      var products = {}, order = [];
      (cat.items || []).forEach(function (it) {
        if (!products[it.product_id]) { products[it.product_id] = { name: it.name, packs: [] }; order.push(it.product_id); }
        products[it.product_id].packs.push({ label: it.label, price: Number(it.price) });
      });
      var rate = Number(cat.vat_rate_pct || 15) / 100;
      var lines = q ? (q.items || []).map(function (i) { return { product_id: i.product_id, qty: Number(i.qty), unit: i.unit || '', price: Number(i.unit_price), manual: false }; }) : [{ product_id: '', qty: '', unit: '', price: null, manual: false }];
      var m = q ? (q.merchant || {}) : {};
      var merchants = cat.merchants || [];

      function productOptions(sel) {
        return '<option value="">اختار الصنف…</option>' + order.map(function (pid) {
          return '<option value="' + pid + '"' + (String(pid) === String(sel) ? ' selected' : '') + '>' + esc(products[pid].name) + '</option>';
        }).join('');
      }
      function packPrice(l) {
        var p = products[l.product_id]; if (!p) return null;
        var hit = p.packs.filter(function (k) { return k.label === l.unit; })[0];
        return hit ? hit.price : null;
      }
      function known(l) { return l.manual ? l.price : (packPrice(l) != null ? packPrice(l) : (l.price || null)); }
      function sumHtml(l) {
        var k = known(l);
        return k != null && Number(l.qty) > 0 ? n2(Number(l.qty) * k) : (l.unit && Number(l.qty) > 0 ? '<span class="label">يتحسب عند الحفظ</span>' : '—');
      }
      function lineHtml(l, i) {
        var p = products[l.product_id], list = p ? p.packs.map(function (k) { return '<option value="' + esc(k.label) + '">' + esc(k.label) + ' · ' + n2(k.price) + '</option>'; }).join('') : '';
        var kn = known(l), sum = sumHtml(l);
        return '<div class="qline" data-i="' + i + '">' +
          '<select data-f="product_id" aria-label="الصنف"' + (editable ? '' : ' disabled') + '>' + productOptions(l.product_id) + '</select>' +
          '<input type="number" data-f="qty" min="0" step="any" value="' + esc(l.qty) + '" placeholder="الكمية" aria-label="الكمية" dir="ltr"' + (editable ? '' : ' disabled') + '>' +
          '<input type="text" data-f="unit" list="packs-' + i + '" value="' + esc(l.unit) + '" placeholder="العبوة أو طن/كيلو" aria-label="العبوة"' + (editable ? '' : ' disabled') + '><datalist id="packs-' + i + '">' + list + '<option value="طن"><option value="كيلو"></datalist>' +
          '<input type="number" data-f="price" min="0" step="0.01" value="' + (l.manual && l.price != null ? esc(l.price) : '') + '" placeholder="' + (kn != null && !l.manual ? n2(kn) : 'سعر يدوي') + '" aria-label="سعر الوحدة" dir="ltr"' + (editable ? '' : ' disabled') + '>' +
          '<span class="sum num">' + sum + '</span>' +
          (editable ? '<button class="btn sm" type="button" data-del="' + i + '" aria-label="حذف السطر">×</button>' : '<span></span>') + '</div>';
      }
      var title = q ? 'عرض سعر ' + esc(q.quote_no) : 'عرض سعر جديد';
      var merchantPart = q
        ? '<div class="panel-head"><div><b>' + esc(m.company || m.name || '—') + '</b> <span class="label num">' + esc(m.phone) + '</span><div class="label">' + esc(m.city || '') + '</div></div>' + pill(QSTATUS, q.status) + '</div>'
        : '<div class="form-row"><label class="field"><span>تاجر مسجل</span><select id="q-merchant"><option value="">تاجر جديد…</option>' + merchants.map(function (x) { return '<option value="' + x.id + '">' + esc((x.company || x.name || '') + ' · ' + x.phone) + '</option>'; }).join('') + '</select></label>' +
          '<label class="field"><span>جوال الواتساب (لتاجر جديد)</span><input type="tel" id="q-phone" dir="ltr" placeholder="05xxxxxxxx"></label></div>' +
          '<div class="form-row" id="q-new"><label class="field"><span>الاسم</span><input type="text" id="q-name"></label><label class="field"><span>المنشأة / المدينة</span><div class="toolbar" style="flex-wrap:nowrap"><input type="text" id="q-company" placeholder="المنشأة"><input type="text" id="q-city" placeholder="المدينة"></div></label></div>';
      var meta = q ? '<div class="chips"><span class="chip">اعتمده: ' + esc(whoApproved(q.approved_by)) + '</span><span class="chip">صالح حتى: <span class="num">' + esc(q.valid_to ? String(q.valid_to).slice(0, 10) : '—') + '</span></span>' +
          (q.send ? '<span class="chip">الإرسال: ' + outPill(q.send) + '</span>' : '') + '</div>' : '';
      openModal(title, merchantPart + meta +
        '<div class="qlines"><div class="qline head"><span>الصنف</span><span>الكمية</span><span>العبوة</span><span>سعر الوحدة</span><span>الإجمالي</span><span></span></div><div id="q-lines"></div></div>' +
        (editable ? '<div class="toolbar"><button class="btn sm" type="button" id="q-add">+ صنف</button>' +
          '<label class="check"><span class="switch"><input type="checkbox" id="q-vat"' + ((q ? q.prices_include_vat : cat.include_vat_default) ? ' checked' : '') + '><i></i></span>الأسعار شاملة الضريبة</label>' +
          '<label class="check">صالح <input type="number" id="q-days" min="1" max="60" value="' + esc(cat.valid_days || 3) + '" style="max-width:70px" dir="ltr"> أيام</label></div>' : '') +
        '<div class="qtotals" id="q-totals"></div>' +
        '<div class="toolbar" id="q-actions"></div>',
        function (box) {
          box.classList.add('wide');
          function totals() {
            var sub = 0, unknown = false;
            lines.forEach(function (l) {
              var pr = l.manual ? l.price : packPrice(l); if (pr == null && !l.manual && l.price) pr = l.price;
              if (Number(l.qty) > 0 && l.product_id) { if (pr != null) sub += Number(l.qty) * pr; else unknown = true; }
            });
            var incl = q && !editable ? q.prices_include_vat : (box.querySelector('#q-vat') ? box.querySelector('#q-vat').checked : false);
            var vat = incl ? sub - sub / (1 + rate) : sub * rate, total = incl ? sub : sub + vat;
            if (q && !editable) { sub = Number(q.subtotal); vat = Number(q.vat_amount); total = Number(q.total); unknown = false; }
            box.querySelector('#q-totals').innerHTML = '<span>المجموع: <span class="num">' + n2(sub) + '</span></span><span>الضريبة ' + Math.round(rate * 100) + '%: <span class="num">' + n2(vat) + '</span></span><b>الإجمالي: <span class="num">' + n2(total) + '</span> ر.س</b>' + (unknown ? '<span class="label">فيه سطر هيتحسب بالتحويل عند الحفظ</span>' : '');
          }
          function draw() {
            box.querySelector('#q-lines').innerHTML = lines.map(lineHtml).join('');
            totals();
            box.querySelectorAll('.qline[data-i]').forEach(function (row) {
              var i = Number(row.dataset.i);
              row.querySelectorAll('[data-f]').forEach(function (el) {
                var f = el.dataset.f;
                if (f === 'product_id') {
                  el.onchange = function () { var l = lines[i], p = products[el.value]; l.product_id = el.value; l.unit = p && p.packs.length === 1 ? p.packs[0].label : ''; l.price = null; l.manual = false; draw(); };
                  return;
                }
                // Typing only refreshes the numbers, so the field being typed in is never replaced.
                el.oninput = el.onchange = function () {
                  var l = lines[i];
                  if (f === 'price') { l.manual = el.value !== ''; l.price = el.value === '' ? null : Number(el.value); }
                  else if (f === 'qty') l.qty = el.value;
                  else { l.unit = el.value.trim(); if (!l.manual) l.price = null; var ph = row.querySelector('[data-f=price]'), kk = known(l); if (!l.manual) ph.placeholder = kk != null ? n2(kk) : 'سعر يدوي'; }
                  row.querySelector('.sum').innerHTML = sumHtml(l); totals();
                };
              });
              var del = row.querySelector('[data-del]'); if (del) del.onclick = function () { lines.splice(i, 1); if (!lines.length) lines.push({ product_id: '', qty: '', unit: '', price: null, manual: false }); draw(); };
            });
          }
          function payload() {
            var d = { items: lines.filter(function (l) { return l.product_id && Number(l.qty) > 0; }).map(function (l) {
              var x = { product_id: Number(l.product_id), qty: Number(l.qty), unit: l.unit || null }; if (l.manual && l.price != null) x.unit_price = l.price; return x; }) };
            if (q) { d.id = q.id; d.merchant_id = m.id; }
            else {
              var mid = box.querySelector('#q-merchant').value;
              if (mid) d.merchant_id = Number(mid);
              else { d.phone = box.querySelector('#q-phone').value; d.name = box.querySelector('#q-name').value; d.company = box.querySelector('#q-company').value; d.city = box.querySelector('#q-city').value; }
            }
            var vatBox = box.querySelector('#q-vat'); if (vatBox) d.prices_include_vat = vatBox.checked;
            var days = box.querySelector('#q-days'); if (days && days.value) d.valid_days = Number(days.value);
            return d;
          }
          function save(thenApprove) {
            var d = payload(); if (!d.items.length) { toast(ERR.no_items, true); return; }
            act('quote_save', d, thenApprove ? null : 'اتحفظ العرض').then(function (r) {
              if (!r) return;
              q = r.quote; lines = (q.items || []).map(function (i) { return { product_id: i.product_id, qty: Number(i.qty), unit: i.unit || '', price: Number(i.unit_price), manual: false }; });
              if (thenApprove) {
                act('quote_approve', { id: q.id }, 'اتعمد العرض، والـ PDF هيتبعت للتاجر خلال دقيقة').then(function (x) { if (x) closeModal(); });
              } else { closeModal(); }
            });
          }
          function actions() {
            var a = box.querySelector('#q-actions'), html = '';
            if (editable) {
              html += '<button class="btn" type="button" id="qa-save">حفظ' + (q && q.status === 'approved' ? ' (يرجع مسودة)' : ' كمسودة') + '</button>';
              if (isAdmin()) html += '<button class="btn primary" type="button" id="qa-approve">حفظ واعتماد وإرسال</button>';
            }
            if (q && q.has_pdf) html += '<button class="btn" type="button" id="qa-pdf">تنزيل PDF</button>';
            if (q && isAdmin() && (q.status === 'sent' || (q.status === 'approved' && q.send && q.send.status === 'failed'))) html += '<button class="btn" type="button" id="qa-resend">إعادة إرسال للتاجر</button>';
            if (q && isAdmin() && q.status === 'sent') html += '<button class="btn good" type="button" id="qa-acc">التاجر وافق</button><button class="btn" type="button" id="qa-rej">التاجر رفض</button>';
            if (q && isAdmin() && ['cancelled', 'accepted', 'rejected', 'expired'].indexOf(q.status) < 0) html += '<button class="btn danger" type="button" id="qa-cancel">إلغاء العرض</button>';
            a.innerHTML = html;
            var on = function (id, f) { var b = a.querySelector('#' + id); if (b) b.onclick = f; };
            on('qa-save', function () { save(false); });
            on('qa-approve', function () { save(true); });
            on('qa-pdf', function () { downloadPdf(q); });
            on('qa-resend', function () { act('quote_resend', { id: q.id }, 'رجع لطابور الإرسال').then(function (x) { if (x) closeModal(); }); });
            on('qa-acc', function () { act('quote_status', { id: q.id, status: 'accepted' }, 'اتسجل إن التاجر وافق، والمتابعة وقفت').then(function (x) { if (x) closeModal(); }); });
            on('qa-rej', function () { act('quote_status', { id: q.id, status: 'rejected' }, 'اتسجل إن التاجر رفض، والمتابعة وقفت').then(function (x) { if (x) closeModal(); }); });
            on('qa-cancel', function () { if (!window.confirm('إلغاء العرض ' + q.quote_no + '؟ لو لسه ماتبعتش مش هيتبعت، والمتابعة هتقف.')) return; act('quote_cancel', { id: q.id }, 'اتلغى العرض').then(function (x) { if (x) closeModal(); }); });
          }
          var addBtn = box.querySelector('#q-add'); if (addBtn) addBtn.onclick = function () { lines.push({ product_id: '', qty: '', unit: '', price: null, manual: false }); draw(); };
          var vatBox = box.querySelector('#q-vat'); if (vatBox) vatBox.onchange = draw;
          var sel = box.querySelector('#q-merchant');
          if (sel) sel.onchange = function () { box.querySelector('#q-new').style.display = sel.value ? 'none' : ''; box.querySelector('#q-phone').disabled = !!sel.value; };
          draw(); actions();
        });
      state.afterClose = function () { go('quotes'); };
    });
  }

  // ------------------------------------------------------------ contacts
  function takeoverCell(c) {
    return c.takeover_until ? '<span class="pill warn">مع موظف · ' + esc(time(c.takeover_until)) + '</span>' : '<span class="pill good">البوت شغال</span>';
  }
  function toggle(name, on, label) {
    return '<label class="switch" title="' + esc(label) + '"><input type="checkbox" data-t="' + name + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(label) + '"><i></i></label>';
  }
  function filterRows(main, input) {
    input.oninput = function () {
      var q = input.value.trim().toLowerCase();
      main.querySelectorAll('tbody tr').forEach(function (tr) { tr.style.display = !q || tr.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none'; });
    };
  }

  function viewSuppliers(main) {
    api('suppliers').then(function (r) {
      if (!r.ok) { main.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
      var items = r.items || []; state.cache.suppliers = items;
      var tools = '<input type="text" class="search" id="q" placeholder="بحث بالاسم أو الرقم">' + (isAdmin() ? '<button class="btn primary" id="add">إضافة مورد</button>' : '');
      var rows = items.map(function (s) {
        return '<tr data-id="' + s.id + '" class="' + (s.active ? '' : 'off') + '"><td class="who"><b>' + esc(s.name || '—') + (s.demo ? ' <span class="pill warn">تجريبي</span>' : '') + '</b><span class="label">' + esc(s.company || '') + '</span></td>' +
          '<td class="num">' + esc(s.phone) + '</td><td>' + pill(TRUST, s.trust) + '</td>' +
          '<td>' + (isAdmin() ? toggle('active', s.active, 'المورد مفعّل') : (s.active ? 'نعم' : 'لا')) + '</td>' +
          '<td>' + (isAdmin() ? toggle('checkin_enabled', s.checkin_enabled, 'المتابعة اليومية') : (s.checkin_enabled ? 'نعم' : 'لا')) + '</td>' +
          '<td>' + takeoverCell(s) + '</td><td>' + ago(s.last_message) + '</td><td class="num">' + s.approved_items + (s.pending_items ? ' <span class="pill acc">' + s.pending_items + ' معلق</span>' : '') + '</td>' +
          '<td class="actions"><button class="btn sm" data-a="chat">المحادثة</button>' + (isAdmin() ? '<button class="btn sm" data-a="edit">تعديل</button>' : '') + '</td></tr>';
      }).join('');
      main.innerHTML = head('الموردون', 'المتابعة اليومية تُرسل لكل مورد مفعّل لم يرسل أسعاره اليوم.', tools) +
        '<section class="panel">' + (rows ? '<div class="table-wrap"><table><thead><tr><th>المورد</th><th>الجوال</th><th>الثقة</th><th>مفعّل</th><th>متابعة يومية</th><th>المحادثة</th><th>آخر أسعار</th><th>أسعار معتمدة</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="empty">لا يوجد موردون بعد.</p>') + '</section>';
      filterRows(main, document.getElementById('q'));
      var add = document.getElementById('add'); if (add) add.onclick = function () { supplierModal(null); };
      bindRows(main, items, 'supplier');
    });
  }

  function viewMerchants(main) {
    api('merchants').then(function (r) {
      if (!r.ok) { main.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
      var items = r.items || []; state.cache.merchants = items;
      var tools = '<input type="text" class="search" id="q" placeholder="بحث بالاسم أو الرقم أو المدينة">' + (isAdmin() ? '<button class="btn primary" id="add">إضافة تاجر</button>' : '');
      var rows = items.map(function (m) {
        return '<tr data-id="' + m.id + '" class="' + (m.status === 'blocked' || m.status === 'inactive' ? 'off' : '') + '"><td class="who"><b>' + esc(m.name || m.company || '—') + (m.demo ? ' <span class="pill warn">تجريبي</span>' : '') + '</b><span class="label">' + esc([m.company, m.city].filter(Boolean).join(' · ')) + '</span></td>' +
          '<td class="num">' + esc(m.phone) + '</td><td>' + pill(MSTATUS, m.status) + '</td>' +
          '<td>' + (isAdmin() ? toggle('followups_enabled', m.followups_enabled, 'متابعة عروض الأسعار') : (m.followups_enabled ? 'نعم' : 'لا')) + '</td>' +
          '<td>' + takeoverCell(m) + '</td><td class="num">' + (m.open_quotes || 0) + '</td><td>' + ago(m.last_quote) + '</td>' +
          '<td class="actions"><button class="btn sm" data-a="chat">المحادثة</button>' + (isAdmin() ? '<button class="btn sm" data-a="edit">تعديل</button>' : '') + '</td></tr>';
      }).join('');
      main.innerHTML = head('التجار', 'المتابعة بعد عرض السعر تتوقف تلقائيًا عند القبول أو الرفض، أو لو قفلتها هنا.', tools) +
        '<section class="panel">' + (rows ? '<div class="table-wrap"><table><thead><tr><th>التاجر</th><th>الجوال</th><th>الحالة</th><th>متابعة العروض</th><th>المحادثة</th><th>عروض مفتوحة</th><th>آخر عرض</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="empty">لا يوجد تجار بعد.</p>') + '</section>';
      filterRows(main, document.getElementById('q'));
      var add = document.getElementById('add'); if (add) add.onclick = function () { merchantModal(null); };
      bindRows(main, items, 'merchant');
    });
  }

  function bindRows(main, items, line) {
    main.querySelectorAll('tbody tr').forEach(function (tr) {
      var id = Number(tr.dataset.id), c = items.filter(function (i) { return i.id === id; })[0];
      tr.querySelectorAll('[data-a]').forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.a === 'chat') chatModal(line, id, c.name || c.company || c.phone);
          else if (line === 'supplier') supplierModal(c); else merchantModal(c);
        };
      });
      tr.querySelectorAll('[data-t]').forEach(function (inp) {
        inp.onchange = function () {
          var d = Object.assign({}, c); d[inp.dataset.t] = inp.checked;
          act(line + '_save', d, 'تم الحفظ').then(function (x) { if (x) c[inp.dataset.t] = inp.checked; else inp.checked = !inp.checked; });
        };
      });
    });
  }

  // ------------------------------------------------------------ modals
  function closeModal() {
    modalRoot.innerHTML = ''; document.removeEventListener('keydown', escClose);
    var f = state.afterClose; state.afterClose = null; if (f) f();
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function openModal(title, body, onMount) {
    modalRoot.innerHTML = '<div class="overlay" id="ov"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><div class="modal-head"><h2 id="mt">' + title + '</h2><button class="x" id="mx" aria-label="إغلاق">×</button></div>' + body + '</div></div>';
    document.getElementById('mx').onclick = closeModal;
    document.getElementById('ov').addEventListener('mousedown', function (e) { if (e.target.id === 'ov') closeModal(); });
    document.addEventListener('keydown', escClose);
    if (onMount) onMount(modalRoot.querySelector('.modal'));
    var first = modalRoot.querySelector('input, textarea, select'); if (first) first.focus();
  }
  function formData(f) {
    var d = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name) return;
      d[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return d;
  }
  function sw(name, on, label) { return '<label class="check"><span class="switch"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '><i></i></span>' + label + '</label>'; }
  function opts(map, cur) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(map[k][0]) + '</option>'; }).join(''); }

  function supplierModal(s) {
    s = s || { active: true, checkin_enabled: true, trust: 'new' };
    openModal(s.id ? 'تعديل مورد' : 'إضافة مورد',
      '<form class="form" id="f"><div class="form-row"><label class="field"><span>الاسم</span><input type="text" name="name" value="' + esc(s.name) + '" required></label>' +
      '<label class="field"><span>الشركة</span><input type="text" name="company" value="' + esc(s.company) + '"></label></div>' +
      '<div class="form-row"><label class="field"><span>جوال الواتساب</span><input type="tel" name="phone" value="' + esc(s.phone) + '" required dir="ltr" placeholder="05xxxxxxxx"><small>يقبل 05… أو +966… أو أرقام عربية</small></label>' +
      '<label class="field"><span>درجة الثقة</span><select name="trust">' + opts(TRUST, s.trust) + '</select><small>المحظور لا تصله رسائل ولا تُقبل أسعاره</small></label></div>' +
      '<label class="field"><span>ملاحظات</span><textarea name="notes" rows="2">' + esc(s.notes) + '</textarea></label>' +
      '<div class="toolbar">' + sw('active', s.active, 'المورد مفعّل') + sw('checkin_enabled', s.checkin_enabled, 'إرسال المتابعة اليومية') + '</div>' +
      '<div class="toolbar"><button class="btn primary" type="submit">حفظ</button><button class="btn" type="button" id="cn">إلغاء</button></div></form>',
      function (m) {
        m.querySelector('#cn').onclick = closeModal;
        m.querySelector('#f').onsubmit = function (e) {
          e.preventDefault(); var d = formData(e.target); if (s.id) d.id = s.id;
          act('supplier_save', d, 'تم حفظ المورد').then(function (x) { if (x) { closeModal(); go('suppliers'); } });
        };
      });
  }

  function merchantModal(c) {
    c = c || { status: 'active', followups_enabled: true };
    openModal(c.id ? 'تعديل تاجر' : 'إضافة تاجر',
      '<form class="form" id="f"><div class="form-row"><label class="field"><span>اسم الشخص</span><input type="text" name="name" value="' + esc(c.name) + '"></label>' +
      '<label class="field"><span>المنشأة</span><input type="text" name="company" value="' + esc(c.company) + '"></label></div>' +
      '<div class="form-row"><label class="field"><span>جوال الواتساب</span><input type="tel" name="phone" value="' + esc(c.phone) + '" required dir="ltr" placeholder="05xxxxxxxx"></label>' +
      '<label class="field"><span>المدينة</span><input type="text" name="city" value="' + esc(c.city) + '"></label></div>' +
      '<div class="form-row"><label class="field"><span>الرقم الضريبي</span><input type="text" name="vat_number" value="' + esc(c.vat_number) + '" dir="ltr"></label>' +
      '<label class="field"><span>الحالة</span><select name="status">' + opts(MSTATUS, c.status) + '</select></label></div>' +
      '<label class="field"><span>ملاحظات</span><textarea name="notes" rows="2">' + esc(c.notes) + '</textarea></label>' +
      sw('followups_enabled', c.followups_enabled, 'متابعة عروض الأسعار تلقائيًا') +
      '<div class="toolbar"><button class="btn primary" type="submit">حفظ</button><button class="btn" type="button" id="cn">إلغاء</button></div></form>',
      function (m) {
        m.querySelector('#cn').onclick = closeModal;
        m.querySelector('#f').onsubmit = function (e) {
          e.preventDefault(); var d = formData(e.target); if (c.id) d.id = c.id;
          act('merchant_save', d, 'تم حفظ التاجر').then(function (x) { if (x) { closeModal(); go('merchants'); } });
        };
      });
  }

  function chatModal(line, id, name) {
    var list = state.cache[line === 'supplier' ? 'suppliers' : 'merchants'] || [];
    var contact = list.filter(function (x) { return x.id === id; })[0] || {};
    openModal('المحادثة مع ' + esc(name), '<div id="tk"></div><div class="chat" id="chat"><p class="empty">جارٍ التحميل…</p></div>' +
      '<form class="form" id="send"><label class="field"><span>رسالة منك (تُرسل باسمك مباشرة)</span><textarea name="body" rows="3" required maxlength="2000"></textarea></label>' +
      '<div class="toolbar"><button class="btn primary" type="submit">إرسال</button><span class="label">' + 'لحد ما الواتساب يتربط، الرسالة تظهر كمعاينة على تيليجرام' + '</span></div></form>',
      function (m) {
        function drawTakeover() {
          var on = !!contact.takeover_until;
          m.querySelector('#tk').innerHTML = '<div class="takeover-bar' + (on ? ' on' : '') + '"><span>' + (on ? '<b>البوت متوقف مع هذا ' + (line === 'supplier' ? 'المورد' : 'التاجر') + '</b> · ' + esc(time(contact.takeover_until)) : 'البوت هو اللي بيرد ويتابع هنا') + '</span><span class="toolbar">' +
            (on ? '<button class="btn good sm" data-h="0">رجّع المحادثة للبوت</button>'
                : '<button class="btn sm" data-h="1">أوقف البوت ساعة</button><button class="btn sm" data-h="24">يوم</button><button class="btn sm primary" data-h="-1">أوقفه لحد ما أرجّعه</button>') +
            '</span></div>';
          m.querySelectorAll('[data-h]').forEach(function (b) {
            b.onclick = function () {
              var h = Number(b.dataset.h);
              act('takeover', { line: line, id: id, hours: h }, h === 0 ? 'رجعت المحادثة للبوت' : 'البوت متوقف، المحادثة معك الآن').then(function (x) {
                if (!x) return;
                contact.takeover_until = x.until || null;
                if (x.skipped_messages) toast('تم إيقاف ' + x.skipped_messages + ' رسالة كانت جاهزة من البوت');
                drawTakeover(); loadChat();
              });
            };
          });
        }
        function loadChat() {
          api('conversation', { line: line, id: id }).then(function (r) {
            var box = m.querySelector('#chat'); if (!box) return;
            if (!r.ok) { box.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
            box.innerHTML = (r.items || []).map(function (x) {
              var meta = time(x.at) + (x.dir === 'out' ? ' · ' + esc(KIND[x.kind] || x.kind) + ' · ' + esc((OUT[x.status] || [x.status])[0]) + (x.by ? ' · ' + esc(String(x.by).replace('panel:', '')) : '') : '');
              return '<div class="bubble ' + x.dir + (x.kind === 'manual' ? ' manual' : '') + '"><span>' + esc(x.body) + '</span><span class="label">' + meta + '</span></div>';
            }).join('') || '<p class="empty">لا توجد رسائل بعد. الرسائل الواردة تظهر هنا بعد ربط الواتساب.</p>';
            box.scrollTop = box.scrollHeight;
          });
        }
        drawTakeover(); loadChat();
        m.querySelector('#send').onsubmit = function (e) {
          e.preventDefault(); var t = e.target.body;
          act('send_message', { line: line, id: id, body: t.value }, 'تمت إضافة رسالتك').then(function (x) { if (x) { t.value = ''; loadChat(); } });
        };
      });
    // keep the table in sync when the modal closes
    state.afterClose = function () { go(state.view); };
  }

  function passwordModal() {
    openModal('تغيير كلمة المرور', '<form class="form" id="f"><label class="field"><span>كلمة المرور الحالية</span><input type="password" name="old_password" required autocomplete="current-password" dir="ltr"></label>' +
      '<label class="field"><span>كلمة المرور الجديدة</span><input type="password" name="new_password" required minlength="10" autocomplete="new-password" dir="ltr"><small>10 أحرف على الأقل</small></label>' +
      '<div class="toolbar"><button class="btn primary" type="submit">حفظ</button></div></form>', function (m) {
        m.querySelector('#f').onsubmit = function (e) {
          e.preventDefault();
          act('change_password', formData(e.target), 'تم تغيير كلمة المرور').then(function (x) { if (x) closeModal(); });
        };
      });
  }

  // ------------------------------------------------------------ prices
  function viewPrices(main) {
    api('overview').then(function (r) {
      if (!r.ok) { main.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
      refreshCounts(r);
      var items = (r.data && r.data.pending) || [];
      var html = head('اعتماد الأسعار', isAdmin() ? 'نفس بطاقات تيليجرام. اللي تعتمده هنا يتسجل باسمك.' : 'الاعتماد للمدير فقط، تقدر تتابع هنا.');
      html += '<div class="msgs">' + (items.map(function (p) {
        return '<article class="card ' + esc(p.reason_key) + '" data-id="' + p.id + '"><div class="msg-top"><div><b>' + esc(p.product) + ' · ' + esc(p.pack || p.unit) + '</b><div class="label">' + esc(p.supplier) + ' · ' + time(p.at) + '</div></div><span class="pill warn">' + esc(p.reason) + '</span></div>' +
          '<div class="figs"><div><span class="label">السابق</span><strong class="num">' + n2(p.prev) + '</strong></div><div><span class="label">الجديد</span><strong class="num ' + (p.change_pct > 0 ? 'up' : p.change_pct < 0 ? 'down' : '') + '">' + n2(p.price) + (p.change_pct != null ? ' (' + pct(p.change_pct) + ')' : '') + '</strong></div>' +
          '<div><span class="label">سعر البيع</span><strong class="num">' + n2(p.sell) + '</strong></div><div><span class="label">الهامش</span><strong class="num">' + (p.margin_before != null ? p.margin_before + '% → ' : '') + (p.margin_after != null ? p.margin_after + '%' : '—') + '</strong></div></div>' +
          (isAdmin() ? '<div class="msg-actions"><button class="btn good" data-a="approve">اعتماد</button><button class="btn danger" data-a="reject">رفض</button><input type="number" step="0.01" min="0" placeholder="سعر مصحح" aria-label="سعر مصحح" style="max-width:150px"><button class="btn" data-a="fix">اعتماد بالسعر المصحح</button></div>' : '') +
          '</article>';
      }).join('') || '<p class="empty">لا توجد أسعار بانتظار الاعتماد.</p>') + '</div>';
      main.innerHTML = html;
      main.querySelectorAll('.card').forEach(function (card) {
        var id = Number(card.dataset.id);
        card.querySelectorAll('[data-a]').forEach(function (b) {
          b.onclick = function () {
            var d = { id: id, decision: b.dataset.a === 'reject' ? 'reject' : 'approve' };
            if (b.dataset.a === 'fix') { var v = card.querySelector('input').value; if (!(Number(v) > 0)) { toast('اكتب السعر المصحح أولًا', true); return; } d.corrected = v; }
            b.disabled = true;
            act('price_decide', d, d.decision === 'reject' ? 'تم الرفض' : 'تم الاعتماد').then(function (x) { if (x) go('prices'); else b.disabled = false; });
          };
        });
      });
    });
  }

  // ------------------------------------------------------------ pricing
  var pricingOnlyChanges = false;
  function viewPricing(main) {
    api('pricing').then(function (r) {
      if (!r.ok) { main.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
      var s = r.settings || {}, rows = r.rows || [], admin = isAdmin();
      var changes = rows.filter(function (x) { return x.needs_update; }).length;
      var tools = '<input type="text" class="search" id="q" placeholder="بحث بالصنف أو المورد">' +
        '<label class="check"><span class="switch"><input type="checkbox" id="only"' + (pricingOnlyChanges ? ' checked' : '') + '><i></i></span>اللي سعره محتاج تحديث بس</label>' +
        (admin && changes ? '<button class="btn primary" id="apply-all">اعتماد كل الأسعار المقترحة (' + changes + ')</button>' : '');
      var html = head('التسعير', 'سعر البيع = تكلفة المورد + نسبة ربحك من التكلفة. التكلفة هي أرخص سعر معتمد وساري من الموردين.', '');

      var cats = (r.category_rules || []).map(function (c) {
        return '<div class="panel-head" style="border-top:1px solid var(--line);padding-top:10px"><span>' + esc(c.category) + '</span><span class="toolbar"><b class="num">' + Number(c.markup_pct) + '%</b>' +
          (admin ? '<button class="btn sm danger" data-del-rule="' + c.id + '">حذف</button>' : '') + '</span></div>';
      }).join('');
      var catOptions = (r.categories || []).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      html += '<div class="grid2"><section class="panel"><div class="panel-head"><h2>نسبة الربح</h2><span class="label">من سعر الشراء</span></div>' +
        '<div class="panel-head"><label class="field" for="def" style="flex:1"><b style="font-weight:600">النسبة العامة لكل الأصناف</b><small>مثال: 8 يعني الكيس اللي بـ 100 يتباع بـ 108</small></label>' +
        '<span class="toolbar"><input type="number" id="def" step="0.5" min="0" value="' + (r.default_rule == null ? '' : Number(r.default_rule)) + '" placeholder="مش متحددة" dir="ltr" style="max-width:110px"' + (admin ? '' : ' disabled') + '><span>%</span>' + (admin ? '<button class="btn sm primary" id="def-save">حفظ</button>' : '') + '</span></div>' +
        '<div class="label" style="margin-top:6px">نسبة مختلفة لمجموعة أصناف (تغلب على النسبة العامة)</div>' + (cats || '<p class="label">ما فيش.</p>') +
        (admin ? '<div class="toolbar"><select id="cat" style="max-width:200px">' + catOptions + '</select><input type="number" id="cat-pct" step="0.5" min="0" placeholder="%" dir="ltr" style="max-width:90px"><button class="btn sm" id="cat-add">إضافة</button></div>' : '') +
        '</section>' +
        '<section class="panel"><div class="panel-head"><h2>قواعد الحساب</h2></div>' +
        '<div class="panel-head"><label class="field" for="minp" style="flex:1"><b style="font-weight:600">أقل نسبة ربح مقبولة</b><small>لو سعر البيع الحالي ربحه أقل منها يتعلّم بالأحمر</small></label><span class="toolbar"><input type="number" id="minp" step="0.5" min="0" value="' + esc(s.pricing_min_markup_pct) + '" dir="ltr" style="max-width:90px"' + (admin ? '' : ' disabled') + '><span>%</span>' + (admin ? '<button class="btn sm" data-set="pricing_min_markup_pct">حفظ</button>' : '') + '</span></div>' +
        '<div class="panel-head"><label class="field" for="rnd" style="flex:1"><b style="font-weight:600">التقريب لفوق لأقرب</b><small>عشان سعر البيع يطلع رقم سهل</small></label><span class="toolbar"><select id="rnd"' + (admin ? '' : ' disabled') + '>' +
          [0.25, 0.5, 1, 5, 10].map(function (v) { return '<option value="' + v + '"' + (Number(s.pricing_round_to) === v ? ' selected' : '') + '>' + v + ' ريال</option>'; }).join('') + '</select>' + (admin ? '<button class="btn sm" data-set="pricing_round_to">حفظ</button>' : '') + '</span></div>' +
        '<div class="panel-head"><label class="field" for="vat" style="flex:1"><b style="font-weight:600">الضريبة في عرض السعر</b><small>الضريبة ' + esc(s.vat_rate_pct) + '%</small></label><span class="toolbar"><select id="vat"' + (admin ? '' : ' disabled') + '><option value="excluded"' + (s.pricing_vat_mode !== 'included' ? ' selected' : '') + '>السعر + الضريبة منفصلة</option><option value="included"' + (s.pricing_vat_mode === 'included' ? ' selected' : '') + '>السعر شامل الضريبة</option></select>' + (admin ? '<button class="btn sm" data-set="pricing_vat_mode">حفظ</button>' : '') + '</span></div>' +
        '</section></div>';

      var list = pricingOnlyChanges ? rows.filter(function (x) { return x.needs_update; }) : rows;
      var trs = list.map(function (x, i) {
        var scopeAr = { product: 'خاصة بالصنف', category: 'من المجموعة', 'default': 'العامة' }[x.rule_scope] || '';
        var costCell = x.cost != null
          ? '<b class="num">' + n2(x.cost) + '</b><div class="label">' + esc(x.supplier) + (x.suppliers > 1 ? ' · أرخص من ' + x.suppliers + ' موردين' : '') + (x.includes_shipping ? ' · شامل الشحن' : '') + '</div>'
          : '<span class="label">ما فيش سعر مورد ساري</span>';
        var pctCell = admin
          ? '<span class="toolbar" style="flex-wrap:nowrap"><input type="number" step="0.5" min="0" data-pct="' + i + '" value="' + (x.markup_pct == null ? '' : Number(x.markup_pct)) + '" dir="ltr" style="max-width:76px"><button class="btn sm" data-save-pct="' + i + '">حفظ</button>' + (x.product_rule != null ? '<button class="btn sm" data-clear-pct="' + i + '" title="رجوع للنسبة العامة">×</button>' : '') + '</span><div class="label">' + scopeAr + '</div>'
          : (x.markup_pct == null ? '—' : '<span class="num">' + Number(x.markup_pct) + '%</span><div class="label">' + scopeAr + '</div>');
        var sellCell = x.sell != null
          ? '<b class="num">' + n2(x.sell) + '</b><div class="label">' + (x.current_profit_pct != null ? 'ربح <span class="num ' + (x.below_min ? 'up' : '') + '">' + x.current_profit_pct + '%</span>' + (x.below_min ? ' <span class="pill bad">أقل من المسموح</span>' : '') : '') + '</div>'
          : '<span class="label">ما فيش</span>';
        return '<tr data-i="' + i + '"><td class="who"><b>' + esc(x.product) + '</b><span class="label">' + esc(x.category || '') + '</span></td><td>' + esc(x.pack || x.unit_ar || '') + '</td>' +
          '<td>' + costCell + '</td><td>' + pctCell + '</td><td>' + (x.suggested != null ? '<b class="num">' + n2(x.suggested) + '</b>' : '<span class="label">—</span>') + '</td><td>' + sellCell + '</td>' +
          '<td class="actions">' + (admin && x.needs_update ? '<button class="btn sm primary" data-apply="' + i + '">اعتمد ' + n2(x.suggested) + '</button>' : (x.suggested != null && !x.needs_update ? '<span class="pill good">مظبوط</span>' : '')) + '</td></tr>';
      }).join('');
      html += '<section class="panel"><div class="panel-head"><h2>أسعار البيع</h2><div class="toolbar">' + tools + '</div></div>' +
        (trs ? '<div class="table-wrap"><table><thead><tr><th>الصنف</th><th>العبوة</th><th>التكلفة (أرخص مورد)</th><th>نسبة الربح</th><th>سعر البيع المقترح</th><th>سعر البيع الحالي</th><th></th></tr></thead><tbody>' + trs + '</tbody></table></div>'
             : '<p class="empty">' + (pricingOnlyChanges ? 'كل الأسعار مظبوطة.' : 'لا توجد أصناف بعد.') + '</p>') + '</section>';
      main.innerHTML = html;

      filterRows(main, document.getElementById('q'));
      document.getElementById('only').onchange = function (e) { pricingOnlyChanges = e.target.checked; go('pricing'); };
      if (!admin) return;
      var reload = function (x) { if (x) go('pricing'); };
      document.getElementById('def-save').onclick = function () {
        var v = document.getElementById('def').value; if (v === '') { toast('اكتب النسبة الأول', true); return; }
        act('pricing_rule_save', { scope: 'default', markup_pct: Number(v) }, 'تم حفظ النسبة العامة').then(reload);
      };
      var addCat = document.getElementById('cat-add');
      if (addCat) addCat.onclick = function () {
        var v = document.getElementById('cat-pct').value; if (v === '') { toast('اكتب النسبة الأول', true); return; }
        act('pricing_rule_save', { scope: 'category', category: document.getElementById('cat').value, markup_pct: Number(v) }, 'تم الحفظ').then(reload);
      };
      main.querySelectorAll('[data-del-rule]').forEach(function (b) { b.onclick = function () { act('pricing_rule_delete', { id: Number(b.dataset.delRule) }, 'تم الحذف').then(reload); }; });
      main.querySelectorAll('[data-set]').forEach(function (b) {
        b.onclick = function () {
          var k = b.dataset.set, el = { pricing_min_markup_pct: 'minp', pricing_round_to: 'rnd', pricing_vat_mode: 'vat' }[k];
          var v = document.getElementById(el).value;
          act('setting_save', { key: k, value: k === 'pricing_vat_mode' ? v : Number(v) }, 'تم الحفظ').then(reload);
        };
      });
      main.querySelectorAll('[data-save-pct]').forEach(function (b) {
        b.onclick = function () {
          var x = list[Number(b.dataset.savePct)], v = main.querySelector('[data-pct="' + b.dataset.savePct + '"]').value;
          if (v === '') { toast('اكتب النسبة الأول', true); return; }
          act('pricing_rule_save', { scope: 'product', product_id: x.product_id, markup_pct: Number(v) }, 'تم حفظ نسبة الصنف').then(reload);
        };
      });
      main.querySelectorAll('[data-clear-pct]').forEach(function (b) {
        b.onclick = function () { act('pricing_rule_delete', { product_id: list[Number(b.dataset.clearPct)].product_id }, 'رجع للنسبة العامة').then(reload); };
      });
      main.querySelectorAll('[data-apply]').forEach(function (b) {
        b.onclick = function () {
          var x = list[Number(b.dataset.apply)]; b.disabled = true;
          act('sell_price_apply', { product_id: x.product_id, unit: x.unit, pack: x.pack, price: x.suggested }, 'تم اعتماد سعر البيع').then(function (y) { if (y) go('pricing'); else b.disabled = false; });
        };
      });
      var all = document.getElementById('apply-all');
      if (all) all.onclick = function () {
        if (!window.confirm('اعتماد ' + changes + ' سعر بيع جديد مرة واحدة؟')) return;
        act('sell_price_apply_all', {}, 'تم اعتماد الأسعار').then(reload);
      };
    });
  }

  // ------------------------------------------------------------ settings
  var SETTINGS = [
    ['outbox_require_approval', 'bool', 'رسائل البوت تنتظر موافقتي قبل الإرسال', 'لو قفلتها، المتابعات تتبعت تلقائيًا من غير مراجعة'],
    ['supplier_checkin_hour', 'int', 'ساعة المتابعة اليومية للموردين', 'بتوقيت الرياض، من 5 إلى 22'],
    ['merchant_followup_hours', 'list', 'مواعيد متابعة عرض السعر (بالساعات)', 'مفصولة بفاصلة، مثال: 24, 72, 168'],
    ['alert_threshold_pct', 'num', 'نسبة التغيير اللي تحتاج اعتماد (%)', 'أي تغيير أكبر منها يروح لك قبل ما يتعتمد'],
    ['typo_guard_pct', 'num', 'حد الخطأ المطبعي (%)', 'تغيير أكبر من كده يتوقف كخطأ محتمل'],
    ['manual_review_first_n', 'int', 'أول كم تحديث من أي مورد جديد يراجعه إنسان', ''],
    ['cumulative_window_days', 'int', 'فترة فحص التغيير التراكمي (أيام)', ''],
    ['default_validity_days', 'int', 'صلاحية السعر لو المورد ما حددها (أيام)', '']
  ];
  var WA_SETTINGS = [
    ['outbox_mode', 'mode', 'طريقة الإرسال', 'واتساب = الرسائل تطلع فعلًا للموردين والتجار. معاينة = توصلك على تيليجرام بس'],
    ['romanh_supplier_inbox_id', 'inbox', 'رقم قناة الموردين في رمّانة (inbox id)', 'الرقم اللي الموردين بيبعتوا عليه'],
    ['romanh_merchant_inbox_id', 'inbox', 'رقم قناة التجار في رمّانة (inbox id)', 'سيبه فاضي لحد ما رقم التجار يتضاف'],
    ['human_reply_takeover_hours', 'num', 'لما موظف يرد من رمّانة، البوت يسكت كام ساعة', '0 = البوت ما يسكتش لوحده'],
    ['wa_template_supplier_checkin', 'tpl', 'قالب المتابعة اليومية للموردين', 'بيستخدم لو المورد ما كتبش لنا من أكتر من 24 ساعة'],
    ['wa_template_merchant_followup', 'tpl', 'قالب متابعة عروض الأسعار للتجار', 'لازم يكون متوافق عليه من Meta في رمّانة'],
    ['romanh_webhook_secret', 'secret', 'سر الـ webhook من رمّانة', 'بيظهر مرة واحدة لما تعمل الـ webhook. بعد الحفظ مش بيظهر تاني']
  ];
  function settingRow(x, s) {
    var v = s[x[0]], input;
    if (x[1] === 'bool') input = '<span class="switch"><input type="checkbox" id="s-' + x[0] + '"' + (v === true ? ' checked' : '') + '><i></i></span>';
    else if (x[1] === 'mode') input = '<select id="s-' + x[0] + '" style="max-width:220px"><option value="telegram_preview"' + (v !== 'whatsapp' ? ' selected' : '') + '>معاينة على تيليجرام</option><option value="whatsapp"' + (v === 'whatsapp' ? ' selected' : '') + '>واتساب (إرسال فعلي)</option></select>';
    else if (x[1] === 'secret') input = '<input type="password" id="s-' + x[0] + '" placeholder="' + (v === 'set' ? 'محفوظ · اكتب سر جديد للتغيير' : 'غير مضبوط') + '" autocomplete="off" dir="ltr" style="max-width:220px">';
    else if (x[1] === 'tpl') { v = v || {}; input = '<input type="text" id="s-' + x[0] + '" value="' + esc(v.name || '') + '" placeholder="اسم القالب" dir="ltr" style="max-width:200px"><select id="c-' + x[0] + '" aria-label="نوع القالب"><option value="UTILITY"' + (v.category !== 'MARKETING' ? ' selected' : '') + '>Utility</option><option value="MARKETING"' + (v.category === 'MARKETING' ? ' selected' : '') + '>Marketing</option></select>'; }
    else input = '<input type="' + (x[1] === 'list' ? 'text' : 'number') + '" id="s-' + x[0] + '" value="' + esc(x[1] === 'list' ? (v || []).join(', ') : (v == null ? '' : v)) + '" dir="ltr" style="max-width:220px"' + (x[1] === 'num' ? ' step="0.5"' : (x[1] === 'int' || x[1] === 'inbox') ? ' step="1"' : '') + '>';
    return '<div class="panel-head" style="border-bottom:1px solid var(--line);padding-bottom:12px"><label class="field" for="s-' + x[0] + '" style="flex:1;min-width:220px"><b style="font-weight:600">' + x[2] + '</b><small>' + x[3] + '</small></label><span class="toolbar">' + input + '<button class="btn sm" data-k="' + x[0] + '" data-t="' + x[1] + '">حفظ</button></span></div>';
  }
  function confirmWhatsApp() { return window.confirm('من دلوقتي الرسائل المعتمدة هتتبعت فعلًا على واتساب للموردين والتجار. متأكد؟'); }
  function quoteSettingsHtml(s) {
    return '<section class="panel"><div class="panel-head"><h2>عروض الأسعار</h2><span class="label">بيستخدمها البوت واللوحة وملف الـ PDF</span></div><div class="form">' +
      '<div class="panel-head" style="border-bottom:1px solid var(--line);padding-bottom:12px"><label class="field" style="flex:1;min-width:220px"><b style="font-weight:600">البوت يبعت العروض لوحده</b><small>لو قفلتها، كل عرض يستنى اعتمادك</small></label><span class="switch"><input type="checkbox" id="qs-quote_auto_send"' + (s.quote_auto_send === true ? ' checked' : '') + '><i></i></span></div>' +
      '<div class="panel-head" style="border-bottom:1px solid var(--line);padding-bottom:12px"><label class="field" for="qs-quote_auto_max_total" style="flex:1;min-width:220px"><b style="font-weight:600">أكبر إجمالي يتبعت من غير اعتماد (ريال، شامل الضريبة)</b><small>العروض الأكبر بتوصلك على تيليجرام بزرار اعتماد</small></label><input type="number" id="qs-quote_auto_max_total" min="0" step="500" value="' + esc(s.quote_auto_max_total) + '" dir="ltr" style="max-width:160px"></div>' +
      '<div class="panel-head" style="border-bottom:1px solid var(--line);padding-bottom:12px"><label class="field" for="qs-quote_valid_days" style="flex:1;min-width:220px"><b style="font-weight:600">صلاحية العرض (أيام)</b><small>بعدها السعر يتحدث حسب السوق</small></label><input type="number" id="qs-quote_valid_days" min="1" max="60" step="1" value="' + esc(s.quote_valid_days) + '" dir="ltr" style="max-width:100px"></div>' +
      '<label class="field"><span>طريقة الدفع (بتظهر في الـ PDF)</span><input type="text" id="qs-quote_payment_terms" maxlength="200" value="' + esc(s.quote_payment_terms) + '"></label>' +
      '<label class="field"><span>ملاحظة التوصيل (بتظهر في الـ PDF)</span><input type="text" id="qs-quote_delivery_note" maxlength="200" value="' + esc(s.quote_delivery_note) + '"></label>' +
      '<label class="field"><span>رسالة واتساب مع الـ PDF</span><textarea id="qs-quote_message" rows="4" maxlength="1000">' + esc(s.quote_message) + '</textarea><small>{name} اسم التاجر · {no} رقم العرض (لازم) · {total} الإجمالي · {valid} آخر يوم صلاحية</small></label>' +
      '<div class="toolbar"><button class="btn primary" id="qs-save">حفظ إعدادات العروض</button></div></div></section>';
  }
  function viewSettings(main) {
    Promise.all([api('settings'), api('quote_settings')]).then(function (res) {
      var r = res[0], qs = (res[1] && res[1].ok && res[1].items) || {};
      if (!r.ok) { main.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
      var s = r.items || {};
      var html = head('الإعدادات', 'كل تغيير يتسجل في سجل العمليات باسمك.');
      html += '<section class="panel"><div class="chips"><span class="chip">نموذج قراءة الرسائل: <span class="num">' + esc(s.extraction_model) + '</span></span><span class="chip">وضع الإرسال: ' + (s.outbox_mode === 'whatsapp' ? 'واتساب' : 'معاينة على تيليجرام') + '</span><span class="chip">الملخص الصباحي: <span class="num">' + esc(s.morning_digest_time) + '</span></span></div></section>';
      html += '<section class="panel"><div class="panel-head"><h2>واتساب (رمّانة)</h2><span class="label">حساب رمّانة رقم <span class="num">' + esc(s.romanh_account_id) + '</span></span></div><div class="form">' + WA_SETTINGS.map(function (x) { return settingRow(x, s); }).join('') + '</div></section>';
      html += quoteSettingsHtml(qs);
      html += '<section class="panel"><div class="panel-head"><h2>الأسعار والمتابعة</h2></div><div class="form">' + SETTINGS.map(function (x) { return settingRow(x, s); }).join('') + '</div></section>';
      main.innerHTML = html;
      document.getElementById('qs-save').onclick = function () {
        var g = function (k) { return document.getElementById('qs-' + k); };
        act('quote_settings_save', {
          quote_auto_send: g('quote_auto_send').checked, quote_auto_max_total: Number(g('quote_auto_max_total').value),
          quote_valid_days: Number(g('quote_valid_days').value), quote_payment_terms: g('quote_payment_terms').value.trim(),
          quote_delivery_note: g('quote_delivery_note').value.trim(), quote_message: g('quote_message').value.trim()
        }, 'اتحفظت إعدادات العروض');
      };
      main.querySelectorAll('[data-k]').forEach(function (b) {
        b.onclick = function () {
          var el = document.getElementById('s-' + b.dataset.k), t = b.dataset.t, v;
          if (t === 'bool') v = el.checked;
          else if (t === 'list') v = el.value.split(/[,،\s]+/).filter(Boolean).map(Number);
          else if (t === 'mode') v = el.value;
          else if (t === 'secret') { v = el.value.trim(); if (!v) { toast('اكتب السر الأول', true); return; } }
          else if (t === 'tpl') v = { name: el.value.trim(), category: document.getElementById('c-' + b.dataset.k).value, language: 'ar' };
          else if (t === 'inbox') v = el.value.trim() === '' ? null : Number(el.value);
          else v = Number(el.value);
          if (t === 'mode' && v === 'whatsapp' && !confirmWhatsApp()) return;
          act('setting_save', { key: b.dataset.k, value: v }, 'تم حفظ الإعداد').then(function (x) { if (x && t === 'secret') { el.value = ''; el.placeholder = 'محفوظ · اكتب سر جديد للتغيير'; } });
        };
      });
    });
  }

  // ------------------------------------------------------------ users + audit
  function viewUsers(main) {
    api('users').then(function (r) {
      if (!r.ok) { main.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
      var items = r.items || [];
      var rows = items.map(function (u) {
        return '<tr data-id="' + u.id + '" class="' + (u.active ? '' : 'off') + '"><td class="who"><b>' + esc(u.display_name || u.username) + (u.me ? ' <span class="pill acc">أنت</span>' : '') + '</b><span class="label num">' + esc(u.username) + '</span></td>' +
          '<td>' + (u.role === 'admin' ? '<span class="pill acc">مدير</span>' : '<span class="pill">موظف</span>') + '</td><td>' + (u.active ? '<span class="pill good">مفعّل</span>' : '<span class="pill">موقوف</span>') + '</td>' +
          '<td>' + (u.last_login ? time(u.last_login) : '—') + '</td><td class="actions"><button class="btn sm">تعديل</button></td></tr>';
      }).join('');
      main.innerHTML = head('المستخدمون', 'المدير يتحكم في كل شيء. الموظف يراجع الرسائل ويدخل المحادثات فقط.', '<button class="btn primary" id="add">إضافة مستخدم</button>') +
        '<section class="panel"><div class="table-wrap"><table style="min-width:560px"><thead><tr><th>المستخدم</th><th>الصلاحية</th><th>الحالة</th><th>آخر دخول</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
      document.getElementById('add').onclick = function () { userModal(null); };
      main.querySelectorAll('tbody tr').forEach(function (tr) {
        var u = items.filter(function (i) { return i.id === Number(tr.dataset.id); })[0];
        tr.querySelector('button').onclick = function () { userModal(u); };
      });
    });
  }
  function userModal(u) {
    var isNew = !u; u = u || { role: 'staff', active: true };
    openModal(isNew ? 'إضافة مستخدم' : 'تعديل ' + esc(u.username),
      '<form class="form" id="f"><div class="form-row">' + (isNew ? '<label class="field"><span>اسم المستخدم</span><input type="text" name="username" required dir="ltr" autocomplete="off"><small>حروف إنجليزية صغيرة وأرقام</small></label>' : '') +
      '<label class="field"><span>الاسم الظاهر</span><input type="text" name="display_name" value="' + esc(u.display_name) + '"></label></div>' +
      '<div class="form-row"><label class="field"><span>الصلاحية</span><select name="role"><option value="staff"' + (u.role === 'staff' ? ' selected' : '') + '>موظف</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>مدير</option></select></label>' +
      '<label class="field"><span>' + (isNew ? 'كلمة المرور' : 'كلمة مرور جديدة (اتركها فاضية لو مش هتغيرها)') + '</span><input type="password" name="password" ' + (isNew ? 'required ' : '') + 'minlength="10" autocomplete="new-password" dir="ltr"></label></div>' +
      sw('active', u.active, 'الحساب مفعّل') +
      '<div class="toolbar"><button class="btn primary" type="submit">حفظ</button><button class="btn" type="button" id="cn">إلغاء</button></div></form>',
      function (m) {
        m.querySelector('#cn').onclick = closeModal;
        m.querySelector('#f').onsubmit = function (e) {
          e.preventDefault(); var d = formData(e.target); if (!isNew) d.id = u.id;
          act('user_save', d, 'تم الحفظ').then(function (x) { if (x) { closeModal(); go('users'); } });
        };
      });
  }
  function viewAudit(main) {
    api('audit').then(function (r) {
      if (!r.ok) { main.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
      var rows = (r.items || []).map(function (x) {
        return '<tr><td>' + time(x.at) + '</td><td>' + esc(x.user) + '</td><td>' + esc(ACTION[x.action] || x.action) + '</td><td class="num">' + esc(x.target || '') + '</td></tr>';
      }).join('');
      main.innerHTML = head('سجل العمليات', 'آخر 150 عملية من اللوحة.') +
        '<section class="panel">' + (rows ? '<div class="table-wrap"><table style="min-width:520px"><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>على</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="empty">لا توجد عمليات بعد.</p>') + '</section>';
    });
  }

  // ------------------------------------------------------------ start
  state.token = load('tsm_token');
  if (state.token) {
    api('me').then(function (r) {
      if (r.ok) { state.user = r.user; renderShell(); go('home'); } else showLogin('');
    }).catch(function () {});
  } else {
    showLogin('');
  }
  setInterval(function () {
    if (!state.user || modalRoot.innerHTML) return;
    if (state.view === 'home' || state.view === 'outbox' || state.view === 'prices' || state.view === 'quotes') {
      var active = document.activeElement;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
      go(state.view);
    }
  }, 60000);
})();
