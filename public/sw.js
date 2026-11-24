// Minimal service worker so SplitMate can be installed (Add to Home screen) and receive shared SMS.
// It doesn't cache anything: the app always loads fresh.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
