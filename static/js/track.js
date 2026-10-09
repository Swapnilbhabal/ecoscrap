/* Live tracking: the customer's view of one pickup, refreshed every few seconds. */

const ORDER = ["placed", "assigned", "on_the_way", "arrived", "picked_up", "recycled"];
const STEP_TEXT = {
  placed: "Request placed", assigned: "Collector assigned", on_the_way: "On the way",
  arrived: "Arrived at your door", picked_up: "Picked up and weighed", recycled: "Recycled, certificate issued",
};
let ID = null, PHONE = null, REQ = null, CAT = null;
let map = null, homeM = null, riderM = null, recM = null, routeL = null, fitted = false, timer = null;

/* ---------------- lookup ---------------- */
function showLookup(msg) {
  $("#lookup").hidden = false;
  $("#board").hidden = true;
  const last = memory.get();
  if (last) { $("#lkId").value = last.id; $("#lkPhone").value = last.phone; }
  if (msg) toast(msg, true);
}

$("#lookupForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#lkId").value.trim().toUpperCase(), phone = $("#lkPhone").value.replace(/\D/g, "");
  if (!/^ES-[A-Z0-9]{6}$/.test(id)) return toast("Booking IDs look like ES-AB12CD.", true);
  if (!/^[6-9]\d{9}$/.test(phone)) return toast("Enter the 10-digit mobile number you booked with.", true);
  history.replaceState(null, "", `?id=${id}&phone=${phone}`);
  open(id, phone);
});

async function open(id, phone) {
  ID = id; PHONE = phone;
  try {
    REQ = await api(`requests/${id}?phone=${phone}`);
  } catch (e) { return showLookup(e.message); }
  memory.set({ id, phone });
  $("#lookup").hidden = true;
  $("#board").hidden = false;
  renderBoard();
  await tick();
}

/* ---------------- map ---------------- */
function ensureMap() {
  if (map) return;
  map = makeMap($("#trkMap"), { center: [REQ.lat, REQ.lng], zoom: 14 });
  if (!map) return;
  homeM = L.marker([REQ.lat, REQ.lng], { icon: pins.home() }).addTo(map).bindPopup("Your pickup address");
  if (REQ.recycler) recM = L.marker([REQ.recycler.lat, REQ.recycler.lng], { icon: pins.rec() }).addTo(map)
    .bindPopup(`<b>${esc(REQ.recycler.name)}</b><br>Authorised recycler for this pickup`);
}

function drawLive(live) {
  ensureMap();
  if (!map) return;
  if (live.collector) {
    const at = [live.collector.lat, live.collector.lng];
    if (!riderM) riderM = L.marker(at, { icon: pins.rider(REQ.collector?.vehicle), zIndexOffset: 1000 }).addTo(map);
    else glide(riderM, at, 2200);
    if (!routeL) routeL = L.polyline(live.remaining_path, { color: "#d2793a", weight: 5, opacity: .9, dashArray: "1 10", lineCap: "round" }).addTo(map);
    else routeL.setLatLngs(live.remaining_path);
    if (!fitted) { map.fitBounds(L.latLngBounds([at, [REQ.lat, REQ.lng]]), { padding: [60, 60] }); fitted = true; }
  } else {
    if (riderM) { map.removeLayer(riderM); riderM = null; }
    if (routeL) { map.removeLayer(routeL); routeL = null; }
    if (!fitted) { map.setView([REQ.lat, REQ.lng], 14); fitted = true; }
  }
}

/* ---------------- status card over the map ---------------- */
function ring(fraction, big, small) {
  const C = 2 * Math.PI * 30;
  return `<div class="trk-eta"><svg viewBox="0 0 70 70"><circle class="bg" cx="35" cy="35" r="30"/><circle class="fg" cx="35" cy="35" r="30" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.max(0, Math.min(1, fraction)))}"/></svg><b>${big}<small>${small}</small></b></div>`;
}

function renderStatus(live) {
  const c = REQ.collector, first = c ? c.name.split(" ")[0] : "The collector";
  const box = $("#trkStatus");
  let html;
  switch (REQ.status) {
    case "placed":
    case "assigned":
      html = `${ring(0.08, icon("calendar"), "")}<div><h2>${esc(first)} is assigned</h2><p>Arriving ${fmt.date(REQ.pickup_date)}, ${fmt.slot(REQ.slot)}. The map goes live when the trip starts.</p></div>`;
      break;
    case "on_the_way":
      html = `${ring(live.progress ?? 0.5, live.eta_min ?? "–", "min")}<div><h2>${esc(first)} is ${live.eta_min <= 1 ? "almost there" : `${live.eta_min} min away`}</h2><p>${fmt.num((live.distance_m || 0) / 1000, 1)} km away · ${esc(c?.vehicle || "")}</p></div><span class="tag live">Live</span>`;
      break;
    case "arrived":
      html = `${ring(1, icon("house"), "")}<div><h2>${esc(first)} is at your door</h2><p>Share your handover code <b class="mono">${esc(REQ.otp)}</b> after the items are weighed.</p></div><span class="tag live">Here</span>`;
      break;
    case "picked_up":
      html = `${ring(1, icon("check"), "")}<div><h2>Picked up · ${fmt.rs(REQ.final_payout)} ${REQ.donate ? "donated" : "paid"}</h2><p>${fmt.kg(REQ.verified_kg)} on the way to ${esc(REQ.recycler?.name || "the recycler")}.</p></div>`;
      break;
    case "recycled":
      html = `${ring(1, icon("recycle"), "")}<div><h2>Recycled. Certificate ready.</h2><p>${esc(REQ.recycler?.name)} confirmed receipt of ${fmt.kg(REQ.verified_kg)}.</p></div>`;
      break;
    default:
      html = `${ring(0, icon("ban"), "")}<div><h2>Pickup ${REQ.status}</h2><p>${esc(REQ.reason || "")}</p></div>`;
  }
  box.innerHTML = html;
  const mode = $("#trkMode");
  mode.innerHTML = live.mode === "sim" && ["on_the_way", "arrived"].includes(REQ.status)
    ? `<span class="tag" style="background:#fff;color:var(--ink-2)">${icon("route")}Demo trip, sped up${live.route_source === "approx" ? " · approximate route" : ""}</span>`
    : live.mode === "gps" && ["on_the_way", "arrived"].includes(REQ.status) ? `<span class="tag live" style="background:#fff">Live GPS</span>` : "";
}

/* ---------------- side cards ---------------- */
function renderBoard() {
  $("#bId").textContent = REQ.id;
  $("#bTitle").textContent = REQ.status === "recycled" ? "Recycled. Thank you." : `Pickup on ${fmt.date(REQ.pickup_date)}`;
  $("#bTags").innerHTML = `<span class="status-pill st-${REQ.status}">${esc(REQ.status_label)}</span>${REQ.is_demo ? '<span class="tag">Demo data</span>' : ""}`;

  const cards = [];
  if (REQ.otp) {
    cards.push(`<div class="trk-card"><h3>Your handover code</h3>
      <div class="otp-big" aria-label="Code ${REQ.otp.split("").join(" ")}">${REQ.otp.split("").map((d) => `<span>${d}</span>`).join("")}</div>
      <p class="muted" style="font-size:var(--t-sm)">Give this code only when the collector is at your door and has weighed your items. It closes the pickup.</p></div>`);
  }
  if (REQ.status === "recycled") {
    cards.push(`<div class="trk-card cert-cta"><h3>Your recycling certificate</h3>
      <p><span class="big">${fmt.kg(REQ.verified_kg)}</span> recycled · ${fmt.num(REQ.co2_kg, 1)} kg CO₂e avoided, about ${fmt.num(REQ.car_km)} km of car driving.</p>
      <p style="margin:6px 0 16px"><b style="color:var(--gold)">+${fmt.num(REQ.points)} Green Points</b> added</p>
      <div class="trk-actions"><a class="btn" href="/certificate.html?id=${REQ.certificate_id}">${icon("award")}View certificate</a><a class="btn ghost" style="color:#fff" href="/rewards.html?id=${REQ.id}&phone=${PHONE}">Spend points</a></div></div>`);
  } else if (REQ.status === "picked_up") {
    cards.push(`<div class="trk-card"><h3>Green Points earned</h3><p><b style="font-family:var(--f-display);font-size:1.8rem;color:#8a6510">+${fmt.num(REQ.points)}</b></p><p class="muted" style="font-size:var(--t-sm)">Your certificate is issued when ${esc(REQ.recycler?.name || "the recycler")} confirms receipt.</p></div>`);
  }
  if (REQ.collector) {
    const c = REQ.collector;
    cards.push(`<div class="trk-card"><h3>Your collector</h3><div class="who">
      <span class="avatar">${esc(c.name.split(" ").map((p) => p[0]).join(""))}</span>
      <div><b>${esc(c.name)}</b><small>${esc(c.vehicle)} · ${esc(c.hub)} hub · ★ ${c.rating}</small></div>
      <span class="tag ok">Verified</span></div>
      ${REQ.recycler ? `<p style="margin-top:14px;font-size:var(--t-sm)">${icon("factory")} Delivers to <b style="color:var(--ink)">${esc(REQ.recycler.name)}</b>, ${esc(REQ.recycler.area)}<br><small class="mono" style="color:var(--copper-lo)">${esc(REQ.recycler.auth)}</small></p>` : ""}</div>`);
  }
  // timeline
  const reached = {};
  REQ.events.forEach((e) => { reached[e.status] = e; });
  const nowIdx = ORDER.indexOf(REQ.status);
  const tl = ["cancelled", "rejected"].includes(REQ.status)
    ? REQ.events.map((e) => `<li class="done"><b>${esc(STEP_TEXT[e.status] || e.status)}</b><small>${fmt.when(e.at)}${e.note ? " · " + esc(e.note) : ""}</small></li>`).join("")
    : ORDER.map((s, i) => {
      const e = reached[s];
      const cls = i < nowIdx ? "done" : i === nowIdx ? "done now" : "";
      return `<li class="${cls}"><b>${STEP_TEXT[s]}</b>${e ? `<small>${fmt.when(e.at)}${e.note ? " · " + esc(e.note) : ""}</small>` : ""}</li>`;
    }).join("");
  cards.push(`<div class="trk-card"><h3>Progress</h3><ol class="timeline">${tl}</ol></div>`);

  const total = REQ.final_payout ?? REQ.est_payout;
  cards.push(`<div class="trk-card"><h3>Items</h3><ul class="items-list">${REQ.items.map((it) =>
    `<li>${icon(it.icon)}<span><b>${it.qty} × ${esc(it.name)}</b><br><small class="muted">${esc(it.condition_label)}</small></span><span>${fmt.rs(it.unit_rate * it.qty)}</span></li>`).join("")}</ul>
    <div class="sum-row"><span>${REQ.final_payout != null ? "Paid" : "Estimated payout"}${REQ.donate ? " (donated)" : ""}</span><span>${fmt.rs(total)}</span></div>
    ${REQ.verified_kg ? `<div class="sum-row" style="border:0;margin:0;padding-top:6px;font-weight:500"><span>Verified weight</span><span>${fmt.kg(REQ.verified_kg)}</span></div>` : ""}
    <p class="muted" style="font-size:12px;margin-top:10px">${REQ.wipe ? "Data-wipe request recorded. " : ""}${esc(REQ.address)}</p></div>`);

  if (REQ.can_change) {
    cards.push(`<div class="trk-card"><h3>Need to change something?</h3><div class="trk-actions">
      <button class="btn ghost sm" id="reschBtn" type="button">${icon("calendar")}Reschedule</button>
      <button class="btn danger sm" id="cancelBtn" type="button">${icon("x")}Cancel pickup</button></div></div>`);
  }
  if (["picked_up", "recycled"].includes(REQ.status)) {
    cards.push(REQ.rating
      ? `<div class="trk-card"><h3>Your rating</h3><p style="color:var(--gold);font-size:1.5rem">${"★".repeat(REQ.rating)}<span style="color:var(--mask-2)">${"★".repeat(5 - REQ.rating)}</span></p>${REQ.feedback ? `<p class="muted">“${esc(REQ.feedback)}”</p>` : ""}</div>`
      : `<div class="trk-card"><h3>How was the pickup?</h3><div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} star">★</button>`).join("")}</div>
        <textarea class="textarea" id="fb" placeholder="Anything we should know? (optional)" style="margin-top:10px;min-height:70px"></textarea>
        <button class="btn sm" id="rateBtn" type="button" style="margin-top:10px" disabled>Send rating</button></div>`);
  }
  $("#trkSide").innerHTML = cards.join("");
  wireCards();
}

function wireCards() {
  $("#cancelBtn")?.addEventListener("click", () => modal(`<h3>Cancel this pickup?</h3>
      <p class="muted" style="margin-bottom:14px">${esc(REQ.collector?.name || "The collector")} will be told not to come.</p>
      <label class="field"><span>Reason</span><select class="select" id="cReason">
        <option>Changed my mind</option><option>Sold or gave it to someone</option><option>Booked the wrong date</option><option>Other</option></select></label>
      <div class="trk-actions" style="margin-top:18px"><button class="btn danger" id="cYes">Cancel pickup</button><button class="btn ghost" id="cNo">Keep it</button></div>`,
  (box, close) => {
    $("#cNo", box).onclick = close;
    $("#cYes", box).onclick = async () => {
      try { REQ = await api(`requests/${ID}/cancel`, { method: "POST", body: { phone: PHONE, reason: $("#cReason", box).value } }); close(); toast("Pickup cancelled."); renderBoard(); tick(); }
      catch (e) { toast(e.message, true); }
    };
  }));

  $("#reschBtn")?.addEventListener("click", () => {
    let d = REQ.pickup_date, s = REQ.slot;
    modal(`<h3>Choose a new time</h3><div class="label" style="margin:12px 0 8px">Day</div><div class="chips" id="rD"></div>
      <div class="label" style="margin:16px 0 8px">Slot</div><div class="chips" id="rS"></div>
      <div class="trk-actions" style="margin-top:20px"><button class="btn" id="rYes">Save new time</button></div>`, (box, close) => {
      const draw = () => {
        $("#rD", box).innerHTML = CAT.dates.map((x) => `<button class="chip" data-d="${x}" aria-pressed="${x === d}">${fmt.date(x)}</button>`).join("");
        $("#rS", box).innerHTML = CAT.slots.map((x) => `<button class="chip" data-s="${x}" aria-pressed="${x === s}">${fmt.slot(x)}</button>`).join("");
      };
      draw();
      box.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; if (b.dataset.d) { d = b.dataset.d; draw(); } if (b.dataset.s) { s = b.dataset.s; draw(); } });
      $("#rYes", box).onclick = async () => {
        try { REQ = await api(`requests/${ID}/reschedule`, { method: "POST", body: { phone: PHONE, pickup_date: d, slot: s } }); close(); toast("Pickup rescheduled."); renderBoard(); tick(); }
        catch (e) { toast(e.message, true); }
      };
    });
  });

  let stars = 0;
  $("#stars")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-star]"); if (!b) return;
    stars = +b.dataset.star;
    $$("#stars button").forEach((x, i) => x.classList.toggle("on", i < stars));
    $("#rateBtn").disabled = false;
  });
  $("#rateBtn")?.addEventListener("click", async () => {
    try {
      await api(`requests/${ID}/rate`, { method: "POST", body: { phone: PHONE, stars, feedback: $("#fb").value.trim() || null } });
      REQ.rating = stars; REQ.feedback = $("#fb").value.trim();
      toast("Thanks for rating your pickup."); renderBoard();
    } catch (e) { toast(e.message, true); }
  });
}

/* ---------------- polling loop ---------------- */
async function tick() {
  clearTimeout(timer);
  let live;
  try { live = await api(`requests/${ID}/live?phone=${PHONE}`); } catch { timer = setTimeout(tick, 8000); return; }
  if (live.status !== REQ.status) {
    REQ = await api(`requests/${ID}?phone=${PHONE}`);
    renderBoard();
    if (live.status === "arrived") toast("Your collector has arrived.");
  }
  renderStatus(live);
  drawLive(live);
  const active = ["on_the_way", "arrived"].includes(live.status);
  timer = setTimeout(tick, active ? 2500 : 12000);
}

(async function init() {
  try { CAT = await api("catalog"); } catch { /* reschedule just won't have dates */ }
  const q = new URLSearchParams(location.search);
  const id = (q.get("id") || "").toUpperCase(), phone = q.get("phone") || "";
  if (id && phone) open(id, phone); else showLookup();
  if (auth.get("customer")) {
    const n = document.createElement("p");
    n.className = "acct-note"; n.style.margin = "16px 0 0";
    n.innerHTML = `${icon("user")}<span>All your pickups and certificates are in <a class="link" href="/account.html">My account</a>.</span>`;
    ($("#board").hidden ? $("#lookupForm") : $(".trk-head")).after(n);
  }
})();
