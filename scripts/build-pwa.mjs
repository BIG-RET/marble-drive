// Builds pwa/ (GitHub Pages-ready, relative URLs) from the single-file marble.html.
import fs from 'node:fs'
const out = 'pwa'
const VERSION = 'marble-drive-' + new Date().toISOString().replace(/\D/g, '').slice(0, 12)
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out + '/icons', { recursive: true })
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'])
  fs.copyFileSync('pwa-assets/' + f, out + '/icons/' + f)
let html = fs.readFileSync('marble.html', 'utf8')
html = html.replace(/<link rel="icon"[^>]*>/, '<link rel="icon" type="image/png" href="./icons/icon-192.png" />')
html = html.replace(/<title>[^<]*<\/title>/, `<title>Marble Drive</title>
    <link rel="manifest" href="./manifest.webmanifest" />
    <link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Marble Drive" />
    <meta name="theme-color" content="#12151c" />
    <script>if (window.isSecureContext && 'serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))</script>`)
if (!html.includes('viewport-fit=cover')) throw new Error('viewport-fit=cover missing')
fs.writeFileSync(out + '/index.html', html)
fs.writeFileSync(out + '/manifest.webmanifest', JSON.stringify({
  name: 'Marble Drive – smooth driving trainer', short_name: 'Marble Drive', id: './',
  start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  theme_color: '#12151c', background_color: '#12151c',
  icons: [
    { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: './icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2))
fs.writeFileSync(out + '/sw.js', `const VERSION = '${VERSION}'
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png']
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())) })
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) { const cp = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)) }
    return res
  }).catch(() => (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))))
})
`)
fs.writeFileSync(out + '/.nojekyll', '')
console.log('pwa/ built, cache', VERSION)
