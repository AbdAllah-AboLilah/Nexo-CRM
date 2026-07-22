document.addEventListener('DOMContentLoaded', () => {
    
    // 1. منطقية التنقل بين الشاشات (Routing Logic)
    const navLinks = document.querySelectorAll('#navLinks li');
    const screens = document.querySelectorAll('.screen');
    const pageTitle = document.getElementById('pageTitle');

    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            // إزالة التفعيل من كل القوائم
            navLinks.forEach(item => item.classList.remove('active'));
            this.classList.add('active');

            // تغيير العنوان العلوي
            pageTitle.innerText = this.innerText;

            // إخفاء كل الشاشات وإظهار الشاشة المطلوبة
            const targetId = this.getAttribute('data-target');
            screens.forEach(screen => {
                screen.style.display = 'none';
            });
            
            // لو الشاشة المطلوبة لسه متبرمجتش، بنعرض الرئيسية مؤقتاً (للحماية من الأخطاء)
            const targetScreen = document.getElementById(targetId);
            if(targetScreen) {
                targetScreen.style.display = 'block';
            } else {
                document.getElementById('dashboard-screen').style.display = 'block';
            }

            // قفل القائمة في الموبايل بعد الاختيار
            if(window.innerWidth <= 768) {
                sidebar.classList.remove('open');
            }
        });
    });

    // 2. القائمة الجانبية للموبايل
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });

    // 3. التعرف على الشاشة (Desktop vs Mobile)
    const desktopIcon = document.getElementById('desktopIcon');
    const mobileIcon = document.getElementById('mobileIcon');

    function checkDevice() {
        if (window.innerWidth <= 768) {
            mobileIcon.classList.add('active');
            desktopIcon.classList.remove('active');
        } else {
            desktopIcon.classList.add('active');
            mobileIcon.classList.remove('active');
        }
    }
    checkDevice();
    window.addEventListener('resize', checkDevice);

    // 4. فحص حالة الإنترنت اللحظية
    const networkDot = document.getElementById('networkDot');
    const networkText = document.getElementById('networkText');

    function updateOnlineStatus() {
        if (navigator.onLine) {
            networkDot.style.backgroundColor = 'var(--success)';
            networkText.innerText = 'متصل';
            networkText.style.color = 'var(--success)';
        } else {
            networkDot.style.backgroundColor = 'var(--danger)';
            networkText.innerText = 'أوفلاين';
            networkText.style.color = 'var(--danger)';
        }
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

});

// 5. دالة الروابط الذكية عند النشر (Smart Deep-Links Filter)
function publishPost() {
    const isSmartLinksChecked = document.getElementById('smartLinksCheck').checked;
    const isTelegramChecked = document.getElementById('plat-tg').checked;
    
    let generatedLinks = "\n\nللتواصل: ";
    
    if (isSmartLinksChecked) {
        // الفلترة الذكية
        generatedLinks += "[واتساب]";
        if (!isTelegramChecked) {
            // لو البوست مش رايح تليجرام، ضيف لينك تليجرام في البوست
            generatedLinks += " - [تليجرام]";
        }
        alert("تم تجهيز البوست بالفلترة الذكية!\n" + generatedLinks);
    } else {
        alert("تم تجهيز البوست بدون فلترة ذكية.");
    }
    
    // مكان كود الربط بـ Firebase لاحقاً
    console.log("Firebase API Publish Triggered...");
}