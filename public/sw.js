// v2: v1 API javoblarini ham keshlab qo'yardi (tizimdan chiqqandan keyin ham qolardi) — nomi almashgani uchun o'chadi
const CACHE_NAME = "erp-assets-v2";
// v2: kesh kaliti biznes bo'yicha (bir nechta biznes bitta brauzerda) — eski kalitlar o'chadi
const AGENT_API_CACHE = "agent-api-v2";
const OFFLINE_URL = "/offline.html";

const urlsToCache = [
  OFFLINE_URL,
  "/icon/icon-192.png",
  "/icon/icon-512.png",
  "/icon/icon-maskable-192.png",
  "/icon/icon-maskable-512.png",
];

// Sotuv agenti o'qish ma'lumotlari (profil, siyosat, bugungi marshrut, do'konlar, katalog, qarzdorlar, aksiyalar,
// bosh sahifa, buyurtmalar, ochiq tashrif, yangi mijozlar): tarmoq birinchi, internet bo'lmasa oxirgi nusxa.
// Yozish so'rovlari (buyurtma yuborish, lokatsiya, tashrif) hech qachon keshlanmaydi va navbatga qo'yilmaydi —
// geofence va kredit serverda, internet bilan tekshiriladi. Supervayzer ma'lumotlari va rasm havolalari keshlanmaydi.
// Ish sessiyasi holati keshdan ko'rsatilmaydi (ish boshlangan/tugaganini faqat server biladi); rasmlar keshlanmaydi
const AGENT_READ = /^\/api\/sales-agent\/(me|policy|today|stores|catalog|debtors|promotions|dashboard|orders|visits\/current|prospects|customers|reports)(\/|$)/;
// Yetkazuvchi agent: profil, siyosat, bosh sahifa, yetkazmalar (tafsiloti bilan), mijozlar, qarz/to'lovlar, hisobotlar.
// Amallar (qabul, yetib kelish, to'lov, tasdiqlash) keshlanmaydi — ilova ularni qurilmadagi navbatga qo'yadi va server qayta tekshiradi.
const DELIVERY_READ = /^\/api\/delivery\/(policy$|agent\/(me|dashboard|tasks|customers|debts|reports)(\/|$))/;
const NOT_CACHED = /\/(image|url|photo|content)$|\/proofs\//;

// Install — cache offline page and icons
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(urlsToCache.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

// Activate — clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME && name !== AGENT_API_CACHE) return caches.delete(name);
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Tizimdan chiqishda agent ma'lumotlari keshi tozalanadi (keyingi foydalanuvchiga qolmasin)
self.addEventListener("message", (event) => {
  if (event.data?.type === "clear-agent-cache") event.waitUntil(caches.delete(AGENT_API_CACHE));
});

// Tab biznesi (sarlavha yoki parametr) — bir biznesning oflayn ma'lumoti boshqasiga berilmasin
function companyOf(request) {
  return request.headers.get("x-bum-company") || new URL(request.url).searchParams.get("bumCompany") || "";
}

function cacheKey(request) {
  const url = new URL(request.url);
  url.searchParams.delete("bumCompany");
  url.searchParams.set("__company", companyOf(request));
  return url.toString();
}

async function cachedFallback(request) {
  const cache = await caches.open(AGENT_API_CACHE);
  const exact = await cache.match(cacheKey(request));
  if (exact) return exact;
  // Shu yo'l va shu biznesning boshqa parametrli nusxasi (masalan, boshqa joydan masofa bilan)
  const path = new URL(request.url).pathname;
  const company = companyOf(request);
  for (const key of await cache.keys()) {
    const url = new URL(key.url);
    if (url.pathname === path && url.searchParams.get("__company") === company) return cache.match(key);
  }
  return undefined;
}

function agentRead(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(AGENT_API_CACHE).then((cache) => cache.put(cacheKey(request), clone));
      }
      return response;
    })
    .catch(() =>
      cachedFallback(request)
        .then(
          (cached) =>
            cached ??
            new Response(JSON.stringify({ code: "NETWORK", message: "Internet yo'q" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            }),
        ),
    );
}

// Fetch — network-first, offline fallback for navigation
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  // Never intercept cross-origin requests
  if (url.origin !== self.location.origin) return;

  // Never intercept auth paths
  if (url.pathname.startsWith("/auth")) return;

  // API: faqat agent o'qish ma'lumotlari oflayn uchun keshlanadi, qolgani — to'g'ridan-to'g'ri tarmoq
  if (url.pathname.startsWith("/api/")) {
    if ((AGENT_READ.test(url.pathname) || DELIVERY_READ.test(url.pathname)) && !NOT_CACHED.test(url.pathname)) {
      event.respondWith(agentRead(event.request));
    }
    return;
  }

  // Navigation requests: network-first, fall back to offline.html
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches
          .match(OFFLINE_URL)
          .then((cached) => cached ?? new Response("Offline", { status: 503 })),
      ),
    );
    return;
  }

  // Static assets: network-first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response.ok) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

// Push notifications
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const isAppInFocus = clientList.some((client) => client.focused);
      if (!isAppInFocus) {
        return self.registration.showNotification(data.title, data.options);
      }
    }),
  );
});

// Notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    }),
  );
});
