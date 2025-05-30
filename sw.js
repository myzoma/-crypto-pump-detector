{
    "name": "كاشف ضخ العملات الرقمية المتقدم",
    "short_name": "كاشف العملات",
    "description": "تحليل ذكي للعملات الرقمية مع توصيات مخصصة",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#1a1a2e",
    "theme_color": "#4CAF50",
    "orientation": "portrait-primary",
    "icons": [
        {
            "src": "icon-192x192.png",
            "sizes": "192x192",
            "type": "image/png"
        },
        {
            "src": "icon-512x512.png",
            "sizes": "512x512",
            "type": "image/png"
        }
    ],
    "categories": ["finance", "business", "productivity"],
    "lang": "ar",
    "dir": "rtl"
}
const CACHE_NAME = 'crypto-pump-detector-v2.0';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/styles-enhanced.css',
    '/crypto-pump-detector-enhanced.js',
    '/manifest.json',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700&display=swap'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // إرجاع الملف من الكاش إذا وُجد
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
