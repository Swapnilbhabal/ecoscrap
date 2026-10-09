/* map-kit.js - Leaflet helpers shared by booking, tracking, collector and admin pages. */

const MUMBAI = [19.076, 72.8777];

/* Create a map. If OpenStreetMap tiles can't load (no internet), the grid background still shows. */
function makeMap(el, { center = MUMBAI, zoom = 12, dark = false, scroll = true } = {}) {
  if (typeof L === "undefined") { el.innerHTML = '<p class="empty">Map unavailable</p>'; return null; }
  if (dark) el.classList.add("dark");
  const map = L.map(el, { zoomControl: true, scrollWheelZoom: scroll, attributionControl: true }).setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
  setTimeout(() => map.invalidateSize(), 200);
  return map;
}

const pins = {
  home: () => L.divIcon({ className: "", html: `<span class="pin home">${icon("house")}</span>`, iconSize: [40, 40], iconAnchor: [20, 20] }),
  rec: () => L.divIcon({ className: "", html: `<span class="pin rec">${icon("factory")}</span>`, iconSize: [32, 32], iconAnchor: [16, 16] }),
  rider: (vehicle = "") => L.divIcon({ className: "", html: `<span class="pin rider">${icon(/tempo/i.test(vehicle) ? "truck" : "bike")}</span>`, iconSize: [46, 46], iconAnchor: [23, 23] }),
  drop: () => L.divIcon({ className: "", html: `<span class="pin drop">${icon("map-pin")}</span>`, iconSize: [44, 44], iconAnchor: [22, 40] }),
};

/* Smoothly move a marker to a new position (used for the live collector). */
function glide(marker, to, ms = 1800) {
  const from = marker.getLatLng();
  const start = performance.now();
  cancelAnimationFrame(marker._glide);
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    marker.setLatLng([from.lat + (to[0] - from.lat) * t, from.lng + (to[1] - from.lng) * t]);
    if (t < 1) marker._glide = requestAnimationFrame(step);
  };
  marker._glide = requestAnimationFrame(step);
}

function haversine(a, b) {
  const R = 6371000, toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b[0] - a[0]), dLng = toR(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function gmapsDir(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}
