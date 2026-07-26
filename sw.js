/**
 * FreshShift Service Worker
 * Enables offline functionality and caching
 */

const CACHE_NAME = 'freshshift-v19';
const STATIC_ASSETS = [
    './',
    './index.html',
    './css/styles.css',
    './js/data.js',
    './js/cloud-data.js',
    './js/supabase.js',
    './js/app.js',
    './manifest.json',
    './icons/pwa-icon-192.png',
    './icons/pwa-icon-512.png',
    './icons/pwa-icon-maskable-192.png',
    './icons/pwa-icon-maskable-512.png',
    './icons/apple-touch-icon.png',
    './icons/favicon.ico',
    './icons/favicon-48.png',
    './icons/favicon-32.png',
    './icons/favicon-16.png',
    './icons/freshshift-logo-transparent.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[SW] Static assets cached');
            })
            .catch((error) => {
                console.error('[SW] Failed to cache:', error);
                throw error;
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Service worker activated');
                return self.clients.claim();
            })
    );
});

// Fetch event - prefer the network, then fall back to the cached app.
// This makes normal deployments visible immediately while preserving offline use.
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }
    
    // Skip external requests (like Google Fonts)
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    // Navigation must prefer the network so a newly deployed production build
    // is visible immediately. The cached shell remains the offline fallback.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    if (networkResponse?.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put('./index.html', responseToCache));
                    }
                    return networkResponse;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }
    
    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                if (networkResponse?.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
                }
                return networkResponse;
            })
            .catch(() => caches.match(event.request)
                .then(cachedResponse => cachedResponse || (
                    event.request.headers.get('accept')?.includes('text/html')
                        ? caches.match('./index.html')
                        : undefined
                ))
            )
    );
});

self.addEventListener('push', event => {
    let payload = {};
    try {
        payload = event.data?.json() || {};
    } catch {
        payload = { body: event.data?.text() || 'Neue FreshShift-Mitteilung' };
    }
    const title = payload.title || 'FreshShift';
    event.waitUntil(self.registration.showNotification(title, {
        body: payload.body || 'Neue Mitteilung',
        icon: './icons/pwa-icon-192.png',
        badge: './icons/favicon-48.png',
        tag: payload.tag || 'freshshift-notification',
        renotify: true,
        data: { url: payload.url || '/' }
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            const existing = windowClients.find(client => client.url.startsWith(self.location.origin));
            if (existing) {
                existing.navigate(targetUrl);
                return existing.focus();
            }
            return clients.openWindow(targetUrl);
        })
    );
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
