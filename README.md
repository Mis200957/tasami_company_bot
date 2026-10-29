# لوحة تحكم تسامي

صفحة ثابتة (HTML/CSS/JS) تتكلم مع n8n على `config.js`.

## النشر على GitHub Pages
1. أنشئ repo جديد (مثلًا `tasami-panel`) وارفع الملفات دي كلها في الجذر.
2. Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / root → Save.
3. Settings → Pages → Custom domain: `tasami.kube-ops.com` → Save، وبعد ما يتفعّل علّم على Enforce HTTPS.
4. في DNS الدومين: سجل CNAME باسم `tasami` يشاور على `USERNAME.github.io`.

لو عايز دومين فرعي غير `tasami`، غيّر السطر الوحيد في ملف `CNAME`.
