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
    network: 'تعذر الاتصال بالخادم', server: 'حدث خطأ في الخادم'
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
  var KIND = { supplier_checkin: 'متابعة يومية', merchant_quote_24h: 'متابعة عرض · 24 ساعة', merchant_quote_72h: 'متابعة عرض · 3 أيام', merchant_quote_168h: 'متابعة عرض · 7 أيام', manual: 'رسالة يدوية', auto_reply: 'رد تلقائي' };
  var OUT = { pending_approval: ['بانتظار موافقتك', 'acc'], queued: ['جاهزة للإرسال', 'good'], previewed: ['معاينة على تيليجرام', ''], sending: ['جارٍ الإرسال', ''], sent: ['أُرسلت', 'good'], failed: ['فشلت', 'bad'], skipped: ['لم تُرسل', 'warn'], cancelled: ['ملغاة', ''] };
  var SKIP = { human_takeover: 'المحادثة مع موظف', contact_paused: 'جهة الاتصال موقوفة', followups_off: 'المتابعة مقفولة', demo_contact: 'رقم تجريبي' };
  var FAIL = { needs_template: 'خارج نافذة الـ 24 ساعة ومفيش قالب معتمد لهذا النوع', no_inbox: 'رقم واتساب الخط ده مش متحدد في الإعدادات' };
  var TRUST = { new: ['جديد', 'warn'], trusted: ['موثوق', 'good'], blocked: ['محظور', 'bad'] };
  var MSTATUS = { lead: ['محتمل', 'warn'], active: ['نشط', 'good'], inactive: ['غير نشط', ''], blocked: ['محظور', 'bad'] };
  var ACTION = { setup: 'إنشاء المدير', login: 'تسجيل دخول', login_failed: 'محاولة دخول خاطئة', supplier_save: 'تعديل مورد', merchant_save: 'تعديل تاجر',
    takeover_start: 'إيقاف البوت ودخول موظف', takeover_end: 'إرجاع المحادثة للبوت', send_message: 'رسالة يدوية', outbox_approve: 'اعتماد رسالة',
    outbox_cancel: 'إلغاء رسالة', outbox_approve_all: 'اعتماد كل الرسائل', price_approve: 'اعتماد سعر', price_reject: 'رفض سعر',
    setting_save: 'تغيير إعداد', outbox_retry: 'إعادة محاولة إرسال', user_save: 'تعديل مستخدم', change_password: 'تغيير كلمة المرور' };
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
    ['home', 'الرئيسية'], ['outbox', 'الرسائل الصادرة'], ['suppliers', 'الموردون'], ['merchants', 'التجار'],
    ['prices', 'اعتماد الأسعار'], ['settings', 'الإعدادات', true], ['users', 'المستخدمون', true], ['audit', 'سجل العمليات', true]
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
      if (v[0] === 'prices' && state.counts.prices_pending) b = '<span class="badge num">' + state.counts.prices_pending + '</span>';
      return '<button data-view="' + v[0] + '" class="' + (state.view === v[0] ? 'on' : '') + '"><span>' + v[1] + '</span>' + b + '</button>';
    }).join('');
    nav.querySelectorAll('button').forEach(function (b) { b.onclick = function () { go(b.dataset.view); }; });
  }
  function go(view) {
    state.view = view; renderNav();
    var main = document.getElementById('main');
    main.innerHTML = '<p class="muted">جارٍ التحميل…</p>';
    ({ home: viewHome, outbox: viewOutbox, suppliers: viewSuppliers, merchants: viewMerchants, prices: viewPrices,
       settings: viewSettings, users: viewUsers, audit: viewAudit }[view] || viewHome)(main);
  }
  function refreshCounts(r) {
    if (!r || !r.counts) return;
    state.counts = { outbox_pending: r.counts.outbox_pending, prices_pending: (r.data && r.data.kpi && r.data.kpi.pending) || 0 };
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
  function viewSettings(main) {
    api('settings').then(function (r) {
      if (!r.ok) { main.innerHTML = '<p class="empty">' + esc(errText(r)) + '</p>'; return; }
      var s = r.items || {};
      var html = head('الإعدادات', 'كل تغيير يتسجل في سجل العمليات باسمك.');
      html += '<section class="panel"><div class="chips"><span class="chip">نموذج قراءة الرسائل: <span class="num">' + esc(s.extraction_model) + '</span></span><span class="chip">وضع الإرسال: ' + (s.outbox_mode === 'whatsapp' ? 'واتساب' : 'معاينة على تيليجرام') + '</span><span class="chip">الملخص الصباحي: <span class="num">' + esc(s.morning_digest_time) + '</span></span></div></section>';
      html += '<section class="panel"><div class="panel-head"><h2>واتساب (رمّانة)</h2><span class="label">حساب رمّانة رقم <span class="num">' + esc(s.romanh_account_id) + '</span></span></div><div class="form">' + WA_SETTINGS.map(function (x) { return settingRow(x, s); }).join('') + '</div></section>';
      html += '<section class="panel"><div class="panel-head"><h2>الأسعار والمتابعة</h2></div><div class="form">' + SETTINGS.map(function (x) { return settingRow(x, s); }).join('') + '</div></section>';
      main.innerHTML = html;
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
    if (state.view === 'home' || state.view === 'outbox' || state.view === 'prices') {
      var active = document.activeElement;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
      go(state.view);
    }
  }, 60000);
})();
