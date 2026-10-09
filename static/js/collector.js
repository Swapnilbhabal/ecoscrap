/* Collector app: today's jobs, live trip (GPS or demo), OTP handover, weighing, recycler drop. */

let TOKEN = null, ME = null, CAT = null, JOBS = [];
const watchers = {};   // request id -> geolocation watch id (live GPS)
const maps = {};       // request id -> { map, rider, home, line }
let poll = null;

$("#brand").innerHTML = `${LOGO}<span>EcoScrap <small style="font-weight:500;color:var(--solder);font-family:var(--f-text);font-size:.8rem">Collector</small></span>`;

/* Sign-in happens on the shared page /login.html?role=collector */
const session = {
  get() { return auth.get("collector"); },
  set(v) { v ? auth.set("collector", v) : auth.clear("collector"); },
};
function showSignin() { requireSignIn("collector"); }

$("#outBtn").addEventListener("click", () => {
  Object.values(watchers).forEach((w) => navigator.geolocation?.clearWatch(w));
  clearInterval(poll);
  signOut("collector", "/login.html?role=collector");
});
$("#refreshBtn").addEventListener("click", () => load());

/* ---------------- jobs ---------------- */
async function start() {
  $("#main").hidden = false;
  $("#outBtn").hidden = $("#refreshBtn").hidden = false;
  await load();
  clearInterval(poll);
  poll = setInterval(refreshLive, 3000);
}

async function load() {
  let d;
  try { d = await api("collector/jobs", { token: TOKEN }); }
  catch (e) { if (e.status === 401) { session.set(null); return showSignin(); } return toast(e.message, true); }
  ME = d.collector; JOBS = d.jobs;
  $("#whoMini").innerHTML = `<b>${esc(ME.name)}</b>${esc(ME.vehicle)}`;
  $("#colStats").innerHTML = `<div><b>${JOBS.length}</b><small>open jobs</small></div><div><b>${d.done}</b><small>completed</small></div><div><b>${fmt.num(d.kg, 1)}</b><small>kg collected</small></div>`;
  renderJobs();
}

function itemsText(j) {
  return j.items.map((i) => `<div>${i.qty} × <b>${esc(i.name)}</b> <span class="muted">· ${esc(i.condition_label)}</span></div>`).join("");
}

function renderJobs() {
  Object.values(maps).forEach((m) => { if (m.rider) cancelAnimationFrame(m.rider._glide); m.map.remove(); });
  for (const k in maps) delete maps[k];
  if (!JOBS.length) {
    $("#jobs").innerHTML = `<div class="empty">${icon("circle-check-big")}<p>No open pickups. New bookings near your hub appear here automatically.</p></div>`;
    return;
  }
  $("#jobs").innerHTML = JOBS.map((j) => {
    const active = ["on_the_way", "arrived"].includes(j.status);
    const dist = haversine([ME.lat, ME.lng], [j.lat, j.lng]) / 1000;
    let actions = "";
    if (j.status === "assigned") {
      actions = `<a class="btn ghost sm" href="tel:${esc(j.phone)}">${icon("phone")}Call</a>
        <a class="btn ghost sm" href="${gmapsDir(j.lat, j.lng)}" target="_blank" rel="noopener">${icon("navigation")}Navigate</a>
        <button class="btn full" data-start="${j.id}">${icon("play")}Start trip</button>`;
    } else if (j.status === "on_the_way") {
      actions = `<a class="btn ghost sm" href="${gmapsDir(j.lat, j.lng)}" target="_blank" rel="noopener">${icon("navigation")}Navigate</a>
        <a class="btn ghost sm" href="tel:${esc(j.phone)}">${icon("phone")}Call</a>
        <button class="btn full" data-arrived="${j.id}">${icon("house")}I've arrived</button>`;
    } else if (j.status === "picked_up") {
      actions = `<button class="btn full gold" data-recycled="${j.id}">${icon("factory")}Delivered to ${esc(j.recycler?.name || "recycler")}</button>`;
    }
    return `<article class="job ${active ? "active" : ""}" data-id="${j.id}">
      <div class="job-top"><span class="status-pill st-${j.status}">${esc(j.status_label)}</span><span class="mono" style="font-size:12px;color:var(--gold)">${esc(j.id)}</span></div>
      <h3>${esc(j.name)}</h3>
      <p class="addr">${esc(j.address)}${j.landmark ? `, near ${esc(j.landmark)}` : ""}, ${esc(j.pincode)}</p>
      <div class="meta"><span>${icon("calendar")}${fmt.date(j.pickup_date)}, ${fmt.slot(j.slot)}</span><span>${icon("route")}${fmt.num(dist, 1)} km from hub</span><span>${icon("badge-indian-rupee")}${fmt.rs(j.final_payout ?? j.est_payout)}${j.donate ? " (donate)" : ""}</span>${j.wipe ? `<span>${icon("lock")}Data wipe</span>` : ""}</div>
      <div class="items">${itemsText(j)}</div>
      ${active ? `<div class="map mini-map" id="m-${j.id}"></div><div class="trip-info" id="ti-${j.id}"></div>` : ""}
      ${j.status === "arrived" || j.status === "on_the_way" ? handoverForm(j) : ""}
      ${actions ? `<div class="job-actions">${actions}</div>` : ""}
    </article>`;
  }).join("");
  JOBS.filter((j) => ["on_the_way", "arrived"].includes(j.status)).forEach(setupMap);
  wireHandover();
  refreshLive();
}

/* ---------------- start trip ---------------- */
$("#jobs").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.start) chooseMode(b.dataset.start);
  if (b.dataset.arrived) {
    try { await api(`collector/jobs/${b.dataset.arrived}/arrived`, { method: "POST", token: TOKEN }); stopGps(b.dataset.arrived); toast("Marked as arrived. Ask for the handover code."); load(); }
    catch (err) { toast(err.message, true); }
  }
  if (b.dataset.recycled) {
    try { await api(`collector/jobs/${b.dataset.recycled}/recycled`, { method: "POST", token: TOKEN }); toast("Delivered. Certificate issued to the customer."); load(); }
    catch (err) { toast(err.message, true); }
  }
});

function chooseMode(id) {
  modal(`<h3>Start the trip</h3><p class="muted" style="margin-bottom:14px">The customer sees you move on their map.</p>
    <div class="mode-pick">
      <button type="button" data-mode="gps">${icon("locate")}<span><b>Live GPS</b><small>Shares this phone's real location every few seconds. Needs location permission and HTTPS.</small></span></button>
      <button type="button" data-mode="sim">${icon("route")}<span><b>Demo simulation</b><small>The server drives a sped-up trip along the road. Use this for classroom demos.</small></span></button>
    </div>`, (box, close) => {
    box.addEventListener("click", async (e) => {
      const m = e.target.closest("[data-mode]");
      if (!m) return;
      close();
      if (m.dataset.mode === "sim") return startTrip(id, "sim");
      if (!navigator.geolocation) return toast("This browser can't share location. Use demo simulation.", true);
      navigator.geolocation.getCurrentPosition(
        (p) => startTrip(id, "gps", p.coords.latitude, p.coords.longitude),
        () => toast("Location permission was not given. Use demo simulation or allow location.", true),
        { enableHighAccuracy: true, timeout: 10000 });
    });
  });
}

async function startTrip(id, mode, lat, lng) {
  try {
    await api(`collector/jobs/${id}/start`, { method: "POST", token: TOKEN, body: { mode, lat, lng } });
    if (mode === "gps") startGps(id);
    toast(mode === "gps" ? "Trip started. Sharing your live location." : "Demo trip started.");
    load();
  } catch (err) { toast(err.message, true); }
}

function startGps(id) {
  let lastSent = 0;
  watchers[id] = navigator.geolocation.watchPosition(async (p) => {
    if (Date.now() - lastSent < 5000) return;
    lastSent = Date.now();
    try { await api(`collector/jobs/${id}/ping`, { method: "POST", token: TOKEN, body: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }); }
    catch { /* keep trying */ }
  }, () => toast("Lost GPS signal.", true), { enableHighAccuracy: true, maximumAge: 3000 });
}
function stopGps(id) { if (watchers[id] != null) { navigator.geolocation.clearWatch(watchers[id]); delete watchers[id]; } }

/* ---------------- mini maps ---------------- */
function setupMap(j) {
  const el = $("#m-" + j.id);
  const map = makeMap(el, { center: [j.lat, j.lng], zoom: 14, dark: true, scroll: false });
  if (!map) return;
  const home = L.marker([j.lat, j.lng], { icon: pins.home() }).addTo(map);
  maps[j.id] = { map, home, rider: null, line: null, fitted: false, job: j };
}

async function refreshLive() {
  for (const id of Object.keys(maps)) {
    const m = maps[id];
    let lv;
    try { lv = await api(`requests/${id}/live?phone=${m.job.phone}`); } catch { continue; }
    if (maps[id] !== m) continue;  // the list was re-drawn while we waited
    if (lv.collector) {
      const at = [lv.collector.lat, lv.collector.lng];
      if (!m.rider) m.rider = L.marker(at, { icon: pins.rider(ME?.vehicle) }).addTo(m.map); else glide(m.rider, at, 2600);
      if (!m.line) m.line = L.polyline(lv.remaining_path, { color: "#d2793a", weight: 4, dashArray: "1 8", lineCap: "round" }).addTo(m.map);
      else m.line.setLatLngs(lv.remaining_path);
      if (!m.fitted) { m.map.fitBounds(L.latLngBounds([at, [m.job.lat, m.job.lng]]), { padding: [30, 30] }); m.fitted = true; }
    }
    const ti = $("#ti-" + id);
    if (ti) ti.innerHTML = lv.status === "arrived"
      ? `<span>${icon("house")} You're at the address</span><span class="tag live">Arrived</span>`
      : `<span>${lv.mode === "gps" ? "Live GPS" : "Demo trip"} · ${fmt.num((lv.distance_m || 0) / 1000, 1)} km left</span><b>${lv.eta_min ?? "–"} min</b>`;
    if (lv.status !== m.job.status) { m.job.status = lv.status; if (lv.status === "arrived") { stopGps(id); toast("You've arrived. Weigh the items and ask for the code."); load(); } }
  }
}

/* ---------------- handover ---------------- */
function handoverForm(j) {
  const conds = Object.entries(CAT.conditions);
  return `<form class="handover" data-h="${j.id}" novalidate>
    <div><div class="label">1. Check each item</div>
      ${j.items.map((it, i) => `<div class="ver-line" data-i="${i}" data-cat="${it.category}">
        <span>${esc(it.name)}</span>
        <select class="select" data-k="condition">${conds.map(([k, l]) => `<option value="${k}" ${k === it.condition ? "selected" : ""}>${esc(l.split(" / ")[0])}</option>`).join("")}</select>
        <input class="input" data-k="qty" type="number" min="1" max="20" value="${it.qty}" aria-label="Quantity"></div>`).join("")}</div>
    <label class="field"><span>2. Total weight on the scale (kg)</span><input class="input" name="kg" type="number" step="0.05" min="0.05" placeholder="e.g. ${fmt.num(j.est_kg, 1)}"></label>
    <div class="payout-line"><span>Pay the customer</span><b data-pay>${fmt.rs(j.est_payout)}</b></div>
    <div><div class="label" style="margin-bottom:8px">3. Customer's handover code</div>
      <div class="otp-in">${[0, 1, 2, 3].map((i) => `<input inputmode="numeric" maxlength="1" aria-label="Digit ${i + 1}" data-o="${i}">`).join("")}</div></div>
    <button class="btn block" type="submit">${icon("check")}Confirm handover</button>
  </form>`;
}

function readLines(form) {
  return $$(".ver-line", form).map((row) => ({
    category: row.dataset.cat,
    condition: $("[data-k=condition]", row).value,
    qty: Math.max(1, Math.min(20, parseInt($("[data-k=qty]", row).value, 10) || 1)),
  }));
}

function wireHandover() {
  $$(".handover").forEach((form) => {
    const updatePay = () => {
      const total = readLines(form).reduce((a, l) => a + CAT.categories[l.category].rates[l.condition] * l.qty, 0);
      $("[data-pay]", form).textContent = fmt.rs(total);
    };
    form.addEventListener("input", (e) => {
      if (e.target.dataset.o !== undefined) {
        e.target.value = e.target.value.replace(/\D/g, "").slice(0, 1);
        if (e.target.value) e.target.nextElementSibling?.focus();
      }
      updatePay();
    });
    form.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && e.target.dataset.o !== undefined && !e.target.value) e.target.previousElementSibling?.focus();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = form.dataset.h;
      const otp = $$("[data-o]", form).map((i) => i.value).join("");
      const kg = parseFloat(form.kg.value);
      if (!(kg > 0)) return toast("Enter the weight shown on the scale.", true);
      if (!/^\d{4}$/.test(otp)) return toast("Enter the customer's 4-digit code.", true);
      try {
        const r = await api(`collector/jobs/${id}/handover`, { method: "POST", token: TOKEN, body: { otp, verified_kg: kg, items: readLines(form) } });
        stopGps(id);
        modal(`<h3>Handover complete</h3><p>Pay <b>${esc(r.name)}</b></p><p style="font-family:var(--f-display);font-size:2.6rem;color:var(--ink)">${fmt.rs(r.final_payout)}</p>
          <p class="muted">${r.donate ? "The customer chose to donate this amount." : "Pay by UPI or cash now."} ${fmt.num(r.points)} Green Points were added to their account.</p>
          <button class="btn" style="margin-top:16px" id="ok">Done</button>`, (box, close) => { $("#ok", box).onclick = close; });
        load();
      } catch (err) { toast(err.message, true); }
    });
  });
}

/* ---------------- start ---------------- */
(async function init() {
  try { CAT = await api("catalog"); } catch (e) { return toast(e.message, true); }
  const s = session.get();
  if (s?.token) { TOKEN = s.token; start(); } else showSignin();
})();
