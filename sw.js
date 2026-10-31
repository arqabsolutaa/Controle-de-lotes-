const VERSAO = 'lotes-2.0.3';
const BASICOS = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo.png', 'fundo.jpg', 'fontes/lavish.otf'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(BASICOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.hostname.endsWith('script.google.com') || u.hostname.endsWith('googleusercontent.com')) return;
  e.respondWith(
    fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(VERSAO).then(ch => ch.put(r, c)); } return res; })
      .catch(() => caches.match(r).then(m => m || caches.match('index.html')))
  );
});
