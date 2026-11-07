ELECTRO Sandy V17 - Android APK build project

محتويات هذه الحزمة:
- مشروع Android بسيط يفتح واجهة V17 داخل WebView.
- اختيار الصور من الجهاز مدعوم عبر نافذة اختيار الملفات.
- ملف GitHub Actions لبناء APK تلقائياً.
- أرشيف ELECTRO_Sandy_V17_Development.zip الذي يحتوي على index.html.

طريقة الرفع إلى مستودع GitHub:
1) فك ضغط هذه الحزمة على جهازك.
2) افتح مستودع electro-sandy-android في GitHub.
3) Add file > Upload files.
4) ارفع كل محتويات المجلد (بما فيها المجلد المخفي .github). تأكد أن workflow موجود في .github/workflows/android.yml وأن ملف ZIP في جذر المستودع.
5) Commit changes.
6) افتح Actions ثم Build ELECTRO Sandy APK ثم Run workflow.
7) بعد نجاح البناء، افتح تشغيل workflow وحمّل Artifact باسم ELECTRO-Sandy-V17-debug-APK.

ملاحظات:
- الناتج APK تجريبي debug غير موقّع للنشر في Google Play.
- بيانات النسخة الحالية تبقى محلية على الجهاز؛ لم يتم ربط Supabase أو مزامنة الأجهزة بعد.
- النسخة النهائية تحتاج اختبار الطباعة والتخزين واختيار الصور على الجهاز المستهدف.
