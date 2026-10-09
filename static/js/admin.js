/* Admin dashboard: KPIs and charts, all requests, live map of trips, contact messages. */

let TOKEN = null, VIEW = "overview", SUMMARY = null, ROWS = [], FILTER = "all", Q = "", liveMap = null, liveLayer = null, liveTimer = null;
const STATUS_COLOR = { placed: "#f0b429", assigned: "#f0b429", on_the_way: "#7be0a5", arrived: "#7be0a5", picked_up: "#e8955a", recycled: "#7cc4ff", cancelled: "#e5533d", rejected: "#b8402e" };
const STATUS_NAME = { placed: "Placed", assigned: "Assigned", on_the_way: "On the way", arrived: "Arrived", picked_up: "Picked up", recycled: "Recycled", cancelled: "Cancelled", rejected: "Rejected" };

$("#brand").innerHTML = `${LOGO}<span>EcoScrap <small style="font-weight:500;color:var(--solder);font-family:var(--f-text);font-size:.8rem">Admin</small></span>`;
/* Sign-in happens on the shared page /login.html?role=admin */
const store = {
  get() { return auth.token("admin"); },
  set(v) { v ? auth.set("admin", { token: v, name: "Admin" }) : auth.clear("admin"); },
};
const A = (path, opts = {}) => api(path, { ...opts, token: TOKEN }).catch((e) => {
  if (e.status === 401 || e.status === 403) { store.set(null); signin(); }
  throw e;
});

/* ---------------- sign in ---------------- */
function signin() { clearInterval(liveTimer); requireSignIn("admin"); }
$("#outBtn").addEventListener("click", () => signOut("admin", "/login.html?role=admin"));

function open() {
  $("#adm").hidden = false; $("#outBtn").hidden = false;
  $("#whoMini").innerHTML = "<b>Operations</b>Signed in as admin";
  show(VIEW);
  refreshBadges();
}

$(".adm-side").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b) show(b.dataset.view);
});

function show(view) {
  VIEW = view;
  $$(".adm-side [data-view]").forEach((b) => b.setAttribute("aria-current", b.dataset.view === view));
  clearInterval(liveTimer);
  if (liveMap) { liveMap.remove(); liveMap = null; }
  closeDrawer();
  ({ overview, requests, live, messages })[view]();
}

async function refreshBadges() {
  try {
    const [rows, msgs] = await Promise.all([A("admin/requests?status=active"), A("admin/messages")]);
    const a = $("#activeCount"), m = $("#msgCount");
    a.hidden = !rows.length; a.textContent = rows.length;
    const open = msgs.filter((x) => !x.handled).length;
    m.hidden = !open; m.textContent = open;
  } catch { /* ignore */ }
}

/* ---------------- overview ---------------- */
function barChart(days) {
  const W = 640, H = 210, padL = 28, padB = 24, max = Math.max(4, ...days.map((d) => d.count));
  const nice = Math.ceil(max / 2) * 2, bw = (W - padL) / days.length;
  const y = (v) => H - padB - (v / nice) * (H - padB - 12);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Requests per day, last 14 days">`;
  [0, nice / 2, nice].forEach((v) => { s += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(199,210,204,.12)"/><text x="0" y="${y(v) + 4}">${v}</text>`; });
  days.forEach((d, i) => {
    const x = padL + i * bw + bw * 0.18, w = bw * 0.64, top = y(d.count), last = i === days.length - 1;
    s += `<rect x="${x}" y="${top}" width="${w}" height="${Math.max(0, H - padB - top)}" rx="4" fill="${last ? "#e9b949" : "#d2793a"}"><title>${d.date}: ${d.count}</title></rect>`;
    if (d.count) s += `<text x="${x + w / 2}" y="${top - 5}" text-anchor="middle" style="fill:#fff;font-weight:600">${d.count}</text>`;
    if (i % 2 === 1 || last) s += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</text>`;
  });
  return s + "</svg>";
}

async function overview() {
  const v = $("#view");
  v.innerHTML = `<h1>Overview</h1><p>Loading…</p>`;
  try { SUMMARY = await A("admin/summary"); } catch (e) { return toast(e.message, true); }
  const k = SUMMARY.kpi;
  const kgMax = Math.max(1, ...SUMMARY.kg_by_category.map((c) => c.kg));
  const recMax = Math.max(1, ...SUMMARY.by_recycler.map((r) => r.count));
  const total = Object.values(SUMMARY.status).reduce((a, b) => a + b, 0) || 1;
  v.innerHTML = `
    <h1>Overview</h1>
    <p>${k.demo ? `${k.demo} of ${k.requests} bookings are demo data created for the project.` : "All figures are live bookings."}</p>
    <div class="kpis">
      <div class="kpi"><small>Total requests</small><b>${fmt.num(k.requests)}</b><span>${k.active} active now</span></div>
      <div class="kpi"><small>Pickups completed</small><b>${fmt.num(k.done)}</b><span>${k.cancel_rate}% cancelled or rejected</span></div>
      <div class="kpi"><small>E-waste recovered</small><b>${fmt.num(k.kg, 1)} kg</b><span>${fmt.num(k.co2, 1)} kg CO₂e avoided (est.)</span></div>
      <div class="kpi"><small>Paid to customers</small><b>${fmt.rs(k.paid)}</b><span>Avg rating ★ ${k.rating || "–"}</span></div>
    </div>
    <div class="charts">
      <div class="chart-card"><h3>New requests per day</h3><p class="sub">Last 14 days · today in gold</p>${barChart(SUMMARY.per_day)}</div>
      <div class="chart-card"><h3>Request status</h3><p class="sub">${total} requests</p>
        <div class="stack">${Object.entries(SUMMARY.status).map(([s, n]) => `<i style="width:${(n / total) * 100}%;background:${STATUS_COLOR[s]}" title="${STATUS_NAME[s]}: ${n}"></i>`).join("")}</div>
        <div class="legend">${Object.entries(SUMMARY.status).map(([s, n]) => `<span><i style="background:${STATUS_COLOR[s]}"></i>${STATUS_NAME[s]} ${n}</span>`).join("")}</div>
        <h3 style="margin-top:24px">Deliveries by recycler</h3><p class="sub">Completed pickups</p>
        ${SUMMARY.by_recycler.map((r) => `<div class="hbar"><span>${esc(r.name)}</span><span class="track"><i style="width:${(r.count / recMax) * 100}%;background:#e9b949"></i></span><b>${r.count}</b></div>`).join("") || '<p class="muted">None yet</p>'}
      </div>
      <div class="chart-card" style="grid-column:1/-1"><h3>Estimated weight recovered by category</h3><p class="sub">kg, completed pickups</p>
        ${SUMMARY.kg_by_category.map((c) => `<div class="hbar"><span>${esc(c.name)}</span><span class="track"><i style="width:${(c.kg / kgMax) * 100}%"></i></span><b>${fmt.num(c.kg, 1)}</b></div>`).join("")}
      </div>
    </div>`;
}

/* ---------------- requests ---------------- */
async function requests() {
  const v = $("#view");
  const filters = [["all", "All"], ["active", "Active"], ["assigned", "Assigned"], ["on_the_way", "On the way"], ["picked_up", "Picked up"], ["recycled", "Recycled"], ["cancelled", "Cancelled"]];
  v.innerHTML = `<h1>Requests</h1>
    <div class="toolbar"><div class="chips" id="flt">${filters.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${FILTER === k}">${l}</button>`).join("")}</div>
    <input class="input" id="q" placeholder="Search ID, name, phone, pincode" value="${esc(Q)}"></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Booking</th><th>Customer</th><th>Pickup</th><th>Items</th><th>Payout</th><th>Collector</th><th>Status</th></tr></thead><tbody id="rows"><tr><td colspan="7">Loading…</td></tr></tbody></table></div>`;
  $("#flt").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) { FILTER = b.dataset.f; requests(); } });
  let t;
  $("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { Q = e.target.value.trim(); loadRows(); }, 250); });
  loadRows();
}

async function loadRows() {
  try { ROWS = await A(`admin/requests?status=${FILTER}${Q ? "&q=" + encodeURIComponent(Q) : ""}`); } catch (e) { return toast(e.message, true); }
  $("#rows").innerHTML = ROWS.map((r) => `<tr data-id="${r.id}">
    <td><span class="mono">${esc(r.id)}</span><br><small class="muted">${fmt.when(r.created_at)}</small>${r.is_demo ? ' <span class="tag" style="font-size:10px">demo</span>' : ""}</td>
    <td><b>${esc(r.name)}</b><br><small>${esc(r.phone)} · ${esc(r.pincode)}</small></td>
    <td>${fmt.date(r.pickup_date)}<br><small>${fmt.slot(r.slot)}</small></td>
    <td>${r.items.map((i) => `${i.qty}× ${esc(i.name)}`).join("<br>")}</td>
    <td>${fmt.rs(r.final_payout ?? r.est_payout)}${r.verified_kg ? `<br><small>${fmt.kg(r.verified_kg)}</small>` : ""}</td>
    <td>${esc(r.collector?.name || "—")}</td>
    <td><span class="status-pill st-${r.status}">${esc(STATUS_NAME[r.status])}</span></td></tr>`).join("")
    || `<tr><td colspan="7"><div class="empty">No requests match.</div></td></tr>`;
}

$("#view").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (tr) openDrawer(ROWS.find((r) => r.id === tr.dataset.id));
});

/* ---------------- drawer ---------------- */
function closeDrawer() { $("#drawer").classList.remove("open"); }
function openDrawer(r) {
  if (!r) return;
  const d = $("#drawer");
  const canAssign = ["placed", "assigned"].includes(r.status);
  d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <span class="status-pill st-${r.status}">${esc(r.status_label)}</span><button class="icon-btn" id="dClose" aria-label="Close">${icon("x")}</button></div>
    <h2 style="margin-top:12px">${esc(r.name)}</h2><p class="mono" style="color:var(--gold);font-size:13px">${esc(r.id)}</p>
    <dl>
      <div><dt>Phone</dt><dd>${esc(r.phone)}</dd></div>
      <div><dt>Address</dt><dd>${esc(r.address)}${r.landmark ? `, near ${esc(r.landmark)}` : ""}, ${esc(r.pincode)}</dd></div>
      <div><dt>Pickup</dt><dd>${fmt.date(r.pickup_date)}, ${fmt.slot(r.slot)}</dd></div>
      <div><dt>Items</dt><dd>${r.items.map((i) => `${i.qty} × ${esc(i.name)} (${esc(i.condition_label)})`).join("<br>")}</dd></div>
      <div><dt>Payout</dt><dd>${fmt.rs(r.final_payout ?? r.est_payout)} ${r.final_payout != null ? "paid" : "estimated"}${r.donate ? " · donate" : ""}</dd></div>
      ${r.verified_kg ? `<div><dt>Verified</dt><dd>${fmt.kg(r.verified_kg)} · ${fmt.num(r.co2_kg, 1)} kg CO₂e · ${r.points} pts</dd></div>` : ""}
      <div><dt>Recycler</dt><dd>${esc(r.recycler?.name || "—")}</dd></div>
      ${r.rating ? `<div><dt>Rating</dt><dd>${"★".repeat(r.rating)} ${r.feedback ? "“" + esc(r.feedback) + "”" : ""}</dd></div>` : ""}
      ${r.reason ? `<div><dt>Reason</dt><dd>${esc(r.reason)}</dd></div>` : ""}
    </dl>
    ${r.photos?.length ? `<div class="sec"><h4>Photos</h4><div class="photos-row">${r.photos.map((p) => `<a href="${p}" target="_blank"><img src="${p}" alt="Item photo"></a>`).join("")}</div></div>` : ""}
    ${canAssign ? `<div class="sec"><h4>Assign collector</h4><div style="display:flex;gap:8px"><select class="select" id="dCol">${(SUMMARY?.collectors || []).map((c) => `<option value="${c.id}" ${c.id === r.collector?.id ? "selected" : ""}>${esc(c.name)} · ${esc(c.hub)}</option>`).join("")}</select><button class="btn sm" id="dAssign">Assign</button></div></div>
      <div class="sec"><h4>Reject request</h4><div style="display:flex;gap:8px"><input class="input" id="dReason" placeholder="Reason shown to the customer"><button class="btn sm danger" id="dReject">Reject</button></div></div>` : ""}
    ${r.status === "picked_up" ? `<div class="sec"><button class="btn gold block" id="dRecycled">${icon("factory")}Mark received by recycler</button></div>` : ""}
    <div class="sec"><h4>Timeline</h4><ul class="mini-tl">${r.events.map((e) => `<li><small>${fmt.when(e.at)}</small><span><b style="color:#fff">${esc(STATUS_NAME[e.status] || e.status)}</b>${e.note ? `<br><small>${esc(e.note)}</small>` : ""}</span></li>`).join("")}</ul></div>
    <div class="sec"><a class="btn ghost sm" target="_blank" href="/track.html?id=${r.id}&phone=${r.phone}">${icon("external-link")}Open customer view</a>
      ${r.certificate_id ? `<a class="btn ghost sm" target="_blank" href="/certificate.html?id=${r.certificate_id}">${icon("award")}Certificate</a>` : ""}</div>`;
  d.classList.add("open");
  $("#dClose").onclick = closeDrawer;
  const after = async (msg) => { toast(msg); closeDrawer(); await loadRows(); refreshBadges(); };
  $("#dAssign")?.addEventListener("click", async () => {
    try { await A(`admin/requests/${r.id}/assign`, { method: "POST", body: { collector_id: $("#dCol").value } }); after("Collector assigned."); } catch (e) { toast(e.message, true); }
  });
  $("#dReject")?.addEventListener("click", async () => {
    try { await A(`admin/requests/${r.id}/reject`, { method: "POST", body: { reason: $("#dReason").value } }); after("Request rejected."); } catch (e) { toast(e.message, true); }
  });
  $("#dRecycled")?.addEventListener("click", async () => {
    try { await A(`admin/requests/${r.id}/recycled`, { method: "POST" }); after("Marked as recycled. Certificate issued."); } catch (e) { toast(e.message, true); }
  });
}
document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());

/* ---------------- live map ---------------- */
async function live() {
  $("#view").innerHTML = `<h1>Live map</h1><p id="liveSub">Collectors on a trip, their hubs and the authorised recyclers.</p>
    <div class="live-wrap" style="margin-top:16px"><div class="map dark" id="liveMap"></div></div>`;
  if (!SUMMARY) { try { SUMMARY = await A("admin/summary"); } catch { /* map still works */ } }
  liveMap = makeMap($("#liveMap"), { zoom: 11, dark: true });
  if (!liveMap) return;
  const { recyclers } = await api("recyclers");
  recyclers.forEach((r) => L.marker([r.lat, r.lng], { icon: pins.rec() }).addTo(liveMap).bindPopup(`<b>${esc(r.name)}</b><br>${esc(r.area)}`));
  (SUMMARY?.collectors || []).forEach((c) => L.circleMarker([c.lat, c.lng], { radius: 7, color: "#e9b949", weight: 2, fillColor: "#0e3b2e", fillOpacity: 1 }).addTo(liveMap).bindPopup(`<b>${esc(c.name)}</b><br>${esc(c.hub)} hub`));
  liveLayer = L.layerGroup().addTo(liveMap);
  const riders = {};
  const tick = async () => {
    let trips;
    try { trips = await A("admin/live"); } catch { return; }
    $("#liveSub").textContent = trips.length ? `${trips.length} collector${trips.length > 1 ? "s" : ""} on a trip right now.` : "No collector is on a trip right now. Start one from the collector app.";
    const seen = new Set();
    trips.forEach((t) => {
      if (!t.collector) return;
      seen.add(t.id);
      const at = [t.collector.lat, t.collector.lng];
      if (!riders[t.id]) {
        riders[t.id] = {
          m: L.marker(at, { icon: pins.rider() }).addTo(liveLayer).bindPopup(""),
          home: L.marker([t.customer.lat, t.customer.lng], { icon: pins.home() }).addTo(liveLayer),
          line: L.polyline(t.remaining_path, { color: "#d2793a", weight: 4, dashArray: "1 8" }).addTo(liveLayer),
        };
      } else { glide(riders[t.id].m, at, 2600); riders[t.id].line.setLatLngs(t.remaining_path); }
      riders[t.id].m.setPopupContent(`<b>${esc(t.collector_name || t.id)}</b><br>${esc(t.id)} · ${t.eta_min ?? 0} min away`);
    });
    Object.keys(riders).forEach((id) => { if (!seen.has(id)) { Object.values(riders[id]).forEach((l) => liveLayer.removeLayer(l)); delete riders[id]; } });
  };
  await tick();
  liveTimer = setInterval(tick, 3000);
}

/* ---------------- messages ---------------- */
async function messages() {
  const v = $("#view");
  let list;
  try { list = await A("admin/messages"); } catch (e) { return toast(e.message, true); }
  const topic = { pickup: "Pickup", business: "Bulk collection", partner: "Recycler partner", other: "Other" };
  v.innerHTML = `<h1>Messages</h1><p>Sent from the contact form on the website.</p><div style="margin-top:18px">${list.map((m) => `
    <div class="msg ${m.handled ? "done" : ""}"><div class="msg-top"><span><b>${esc(m.name)}</b> · ${esc(m.contact)} · <span class="tag copper">${topic[m.topic]}</span></span><span>${fmt.when(m.at)}</span></div>
    <p>${esc(m.message)}</p>${m.handled ? "" : `<button class="btn sm ghost" style="margin-top:10px" data-done="${m.id}">Mark as handled</button>`}</div>`).join("")
    || `<div class="empty">${icon("mail")}<p>No messages yet.</p></div>`}</div>`;
  v.onclick = async (e) => {
    const b = e.target.closest("[data-done]");
    if (!b) return;
    await A(`admin/messages/${b.dataset.done}/handled`, { method: "POST" });
    messages(); refreshBadges();
  };
}

/* ---------------- reset demo ---------------- */
$("#resetBtn").addEventListener("click", () => modal(`<h3>Reset demo data?</h3><p class="muted">This deletes every booking, point and message, then reloads the original demo bookings. Use it before a presentation.</p>
  <div style="display:flex;gap:10px;margin-top:18px"><button class="btn danger" id="y">Reset everything</button><button class="btn ghost" id="n">Cancel</button></div>`,
(box, close) => {
  $("#n", box).onclick = close;
  $("#y", box).onclick = async () => {
    try { await A("admin/reset-demo", { method: "POST" }); close(); toast("Demo data restored."); SUMMARY = null; show("overview"); refreshBadges(); }
    catch (e) { toast(e.message, true); }
  };
}));

(function init() {
  TOKEN = store.get();
  if (TOKEN) open(); else signin();
})();
