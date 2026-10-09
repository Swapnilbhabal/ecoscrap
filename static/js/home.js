/* Home page: live numbers, rate calculator, recycler map, rewards, contact form. */

let CATALOG = null;

/* Count a number up from 0 when it scrolls into view. */
function countUp(el, target, format) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = format(target); return; }
  const start = performance.now(), dur = 1400;
  const tick = (now) => {
    const p = Math.min(1, (now - start) / dur), eased = 1 - Math.pow(1 - p, 4);
    el.textContent = format(target * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function loadStats() {
  const box = $("#stats");
  try {
    const s = await api("stats");
    const cells = [
      [s.kg, (v) => fmt.num(v) + " kg", "e-waste recovered"],
      [s.pickups_done, (v) => fmt.num(v), "pickups completed"],
      [s.co2_kg, (v) => fmt.num(v) + " kg", `CO₂e avoided, about ${fmt.num(s.car_km)} km of car driving`],
      [s.avg_rating || 0, (v) => v.toFixed(1) + " ★", "average customer rating"],
    ];
    box.innerHTML = cells.map(([, , label]) => `<div class="num"><b>0</b><span>${label}</span></div>`).join("");
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      $$(".num b", box).forEach((b, i) => countUp(b, Number(cells[i][0]), cells[i][1]));
    });
    io.observe(box);
  } catch {
    box.innerHTML = '<p class="muted" style="padding:24px 0">Live numbers are unavailable right now.</p>';
  }
}

/* ---------------- rate calculator ---------------- */
const calc = { cat: "phone", cond: "not_working", qty: 1 };

function renderCalc() {
  const cats = CATALOG.categories;
  $("#calcCats").innerHTML = Object.entries(cats).map(([key, c]) =>
    `<button type="button" class="cat-btn" data-cat="${key}" aria-pressed="${key === calc.cat}">${icon(c.icon)}<span>${esc(c.name.split(" / ")[0].replace(" & ", " & "))}</span></button>`).join("");
  $("#calcCond").innerHTML = Object.entries(CATALOG.conditions).map(([key, label]) =>
    `<button type="button" class="chip" data-cond="${key}" aria-pressed="${key === calc.cond}">${esc(label.split(" / ")[0])}</button>`).join("");
  $("#calcQty").textContent = calc.qty;
  const c = cats[calc.cat];
  const rs = c.rates[calc.cond] * calc.qty;
  const kg = c.kg * calc.qty;
  const pts = Math.round(kg * CATALOG.points.per_kg) + CATALOG.points.per_pickup;
  $("#calcRs").textContent = fmt.rs(rs);
  $("#calcPts").textContent = "+" + fmt.num(pts);
  $("#calcCo2").textContent = fmt.num(kg * c.co2_factor, 1) + " kg";
  $("#calcBook").href = `/book.html?add=${calc.cat}:${calc.cond}:${calc.qty}`;
}

function wireCalc() {
  $("#calc").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.cat) calc.cat = b.dataset.cat;
    if (b.dataset.cond) calc.cond = b.dataset.cond;
    if (b.dataset.q) calc.qty = Math.min(20, Math.max(1, calc.qty + Number(b.dataset.q)));
    renderCalc();
  });
}

/* ---------------- recyclers ---------------- */
async function loadRecyclers() {
  const { recyclers, source } = await api("recyclers");
  $("#recSource").href = source;
  const list = $("#recList");
  list.innerHTML = recyclers.map((r) => `<li data-id="${r.id}" tabindex="0">
      <span class="pin rec">${icon("factory")}</span>
      <b>${esc(r.name)}</b><small>${esc(r.type)} · ${esc(r.area)} · ${fmt.num(r.capacity_tpa)} tonnes/year</small>
      <span class="mono">${esc(r.auth)}</span></li>`).join("");
  if (typeof L === "undefined") return;
  const map = L.map("recMap", { scrollWheelZoom: false, zoomControl: true }).setView([19.11, 72.93], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
  const markers = {};
  recyclers.forEach((r) => {
    markers[r.id] = L.marker([r.lat, r.lng], {
      icon: L.divIcon({ className: "", html: `<span class="pin rec">${icon("factory")}</span>`, iconSize: [32, 32], iconAnchor: [16, 16] }),
    }).addTo(map).bindPopup(`<b>${esc(r.name)}</b><br>${esc(r.address)}<br><small>Valid to ${fmt.dateLong(r.valid_to)}</small>`);
  });
  map.fitBounds(L.latLngBounds(recyclers.map((r) => [r.lat, r.lng])), { padding: [30, 30] });
  const focus = (li) => {
    $$("li", list).forEach((x) => x.classList.toggle("on", x === li));
    const m = markers[li.dataset.id];
    map.flyTo(m.getLatLng(), 13, { duration: .8 });
    m.openPopup();
  };
  list.addEventListener("click", (e) => { const li = e.target.closest("li"); li && focus(li); });
  list.addEventListener("keydown", (e) => { if (e.key === "Enter") { const li = e.target.closest("li"); li && focus(li); } });
}

function renderRewards() {
  $("#rewardRow").innerHTML = CATALOG.rewards.map((r) =>
    `<div class="reward">${icon(r.icon)}<b>${esc(r.name)}</b><span>${fmt.num(r.points)} pts</span></div>`).join("");
}

/* ---------------- contact ---------------- */
function wireContact() {
  const ways = [
    CFG.phone && `<a href="tel:${CFG.phone.replace(/\s/g, "")}">${icon("phone")}${esc(CFG.phone)}</a>`,
    CFG.whatsapp && `<a href="https://wa.me/${CFG.whatsapp}" target="_blank" rel="noopener">${icon("message-circle")}WhatsApp us</a>`,
    CFG.email && `<a href="mailto:${CFG.email}">${icon("mail")}${esc(CFG.email)}</a>`,
    `<div>${icon("clock")}Monday to Saturday, 9 am – 8 pm</div>`,
    `<div>${icon("map-pin")}Mumbai, Thane and Navi Mumbai</div>`,
  ];
  $("#contactWays").innerHTML = ways.filter(Boolean).join("");
  const form = $("#contactForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    try {
      await api("contact", { method: "POST", body: data });
      form.reset();
      toast("Message sent. We'll reply within one working day.");
    } catch (err) {
      toast(err.message, true);
    } finally { btn.disabled = false; }
  });
}

(async function init() {
  loadStats();
  wireContact();
  try {
    CATALOG = await api("catalog");
    renderCalc(); wireCalc(); renderRewards();
  } catch (e) { toast(e.message, true); }
  loadRecyclers().catch(() => {});
})();
