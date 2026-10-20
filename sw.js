// Minimal service worker — installability only.
// This app requires live connectivity, so we deliberately do NOT cache
// API responses or app data. Only static shell files are cached so the
// browser will recognize the app as installable.
const CACHE_NAME = 'sms-shell-v25';
const SHELL_FILES = [
  'login.html', 'install.html', 'dashboard.html', 'superadmin.html', 'manifest.json', 'sync.js',
  'settings.html', 'settings-lib.js', 'csv-lib.js', 'results-lib.js', 'report-lib.js',
  'students.html', 'staff.html', 'parents.html', 'assignments.html', 'promote.html',
  'scores.html', 'results.html', 'idcards.html', 'timetable.html',
  'announcements.html', 'clearance.html', 'cbt-manage.html',
  'cbt-exam.html', 'result-check.html', 'pay-fees.html', 'payments.html',
  'portal.html', 'portal-nav.js', 'finance.html',
  'index.html', 'pricing.html', 'demo.html', 'signup.html', 'branding-lib.js',
  'communicate.html', 'messages.html', 'manual.html', 'upgrade.html', 'logout-lib.js',
  'assignment-manage.html', 'assignment-check.html',
  'users.html', 'backup.html', 'attendance.html', 'demo-mode.js', 'pw-toggle.js', 'print-lib.js', 'img-lib.js', 'config.js', 'pdf-download.js', 'admission-list.html', 'guide.html', 'charts-lib.js', 'dashboard-metrics.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for everything — never serve stale data offline.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
