// Service worker: a app abre depressa e recebe as atualizações quando há rede.
// Os dados (Supabase) vêm sempre da rede e nunca ficam guardados aqui.
// Ao publicar alterações aos ficheiros, aumente o número da versão.
const CACHE = 'wordle-league-v2';
const SHELL = [
  './', './index.html', './login.html', './leaderboard.html', './profile.html', './regras.html', './admin.html',
  './ranking.html', './config.js', './manifest.webmanifest', './css/style.css', './css/ranking.css',
  './js/vendor/supabase.js', './js/api.js', './js/common.js', './js/normalize.js', './js/words-file.js',
  './js/game.js', './js/login.js', './js/leaderboard.js', './js/profile.js', './js/regras.js', './js/admin.js',
  './js/ranking.js', './img/default-logo.svg', './icons/apple-touch-icon.png', './icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase e outros: sempre da rede

  // Ficheiros da app: rede primeiro (para receber atualizações); cache se estiver offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
