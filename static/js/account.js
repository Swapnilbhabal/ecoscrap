/* My account: profile, all past pickups (like "Your orders"), certificates, Green Points. */

const TOKEN = auth.token("customer");
if (!TOKEN) requireSignIn("customer");

let ME = null, ORDERS = [], FILTER = "all";
const ACTIVE = ["placed", "assigned", "on_the_way", "arrived"];
const A = (path, opts = {}) => api(path, { ...opts, token: TOKEN }).catch((e) => {
  if (e.status === 401 || e.status === 403) { auth.clear("customer"); requireSignIn("customer"); }
  throw e;
});

/* ---------------- header + stats ---------------- */
function renderHead() {
  const first = ME.name.split(" ")[0];
  $("#acctHead").innerHTML = `
    <div class="acct-id"><span class="acct-big-av">${esc(ME.name.split(" ").map((p) => p[0]).join("").slice(0, 2))}</span>
      <div><h1>Hello, ${esc(first)}</h1><p>${esc(ME.phone.slice(0, 5) + " " + ME.phone.slice(5))}${ME.email ? " · " + esc(ME.email) : ""} · member since ${fmt.dateLong(ME.created_at)}</p></div></div>
    <button class="btn ghost sm" type="button" id="signOutTop">${icon("log-out")}Sign out</button>`;
  $("#signOutTop").addEventListener("click", () => signOut("customer", "/login.html"));
  $("#acctStats").innerHTML = `
    <div><small>Pickups</small><b>${ME.pickups}</b><span>${ME.completed} completed</span></div>
    <div><small>E-waste recycled</small><b>${fmt.num(ME.kg, 1)} kg</b><span>${fmt.num(ME.co2_kg, 1)} kg CO₂e avoided</span></div>
    <div><small>Earned from pickups</small><b>${fmt.rs(ME.paid)}</b><span>paid or donated</span></div>
    <div class="gold"><small>Green Points</small><b>${fmt.num(ME.balance)}</b><span><a class="link" href="#" data-goto="points">Spend points</a></span></div>`;
  const f = $("#profileForm");
  f.name.value = ME.name; f.phone.value = ME.phone; f.email.value = ME.email || "";
}

/* ---------------- orders ---------------- */
const STATUS_LINE = (r) => ({
  placed: `Booked for ${fmt.date(r.pickup_date)}, ${fmt.slot(r.slot)}`,
  assigned: `${esc(r.collector?.name || "Collector")} arrives ${fmt.date(r.pickup_date)}, ${fmt.slot(r.slot)}`,
  on_the_way: `${esc(r.collector?.name || "Collector")} is on the way now`,
  arrived: `${esc(r.collector?.name || "Collector")} is at your door`,
  picked_up: `Picked up · ${fmt.kg(r.verified_kg)} on the way to the recycler`,
  recycled: `Recycled on ${fmt.date((r.events.find((e) => e.status === "recycled") || {}).at || r.created_at)}`,
  cancelled: "Cancelled" + (r.reason ? ` · ${esc(r.reason)}` : ""),
  rejected: "Rejected" + (r.reason ? ` · ${esc(r.reason)}` : ""),
}[r.status]);

function orderCard(r) {
  const trackUrl = `/track.html?id=${r.id}&phone=${encodeURIComponent(ME.phone)}`;
  const again = "/book.html?add=" + r.items.map((i) => `${i.category}:${i.condition}:${i.qty}`).join(",");
  const actions = [];
  if (ACTIVE.includes(r.status)) actions.push(`<a class="btn sm" href="${trackUrl}">${icon("navigation")}Track pickup</a>`);
  if (r.certificate_id) {
    actions.push(`<a class="btn sm" href="/api/certificates/${r.certificate_id}/pdf">${icon("download")}Download certificate (PDF)</a>`);
    actions.push(`<a class="btn sm ghost" href="/certificate.html?id=${r.certificate_id}">${icon("award")}View certificate</a>`);
  }
  if (!ACTIVE.includes(r.status)) actions.push(`<a class="btn sm ghost" href="${trackUrl}">${icon("file-text")}Pickup details</a>`);
  if (["picked_up", "recycled"].includes(r.status) && !r.rating) actions.push(`<a class="btn sm ghost" href="${trackUrl}#rate">${icon("star")}Rate pickup</a>`);
  if (r.status === "picked_up") actions.push(`<span class="muted fine">Certificate is issued when the recycler confirms receipt.</span>`);
  actions.push(`<a class="btn sm ghost" href="${again}">${icon("refresh-cw")}Book again</a>`);
  const total = r.final_payout ?? r.est_payout;
  return `<article class="order st-${r.status}">
    <header class="order-top">
      <div><small>Booked on</small><b>${fmt.dateLong(r.created_at)}</b></div>
      <div><small>${r.final_payout != null ? (r.donate ? "Donated" : "Paid to you") : "Estimated payout"}</small><b>${fmt.rs(total)}</b></div>
      <div><small>Pickup slot</small><b>${fmt.date(r.pickup_date)}, ${fmt.slot(r.slot)}</b></div>
      <div class="order-no"><small>Booking #</small><b class="mono">${esc(r.id)}</b>${r.certificate_id ? `<small class="mono">${esc(r.certificate_id)}</small>` : ""}</div>
    </header>
    <div class="order-body">
      <div class="order-main">
        <h3><span class="status-pill st-${r.status}">${esc(r.status_label)}</span></h3>
        <p class="order-status">${STATUS_LINE(r)}</p>
        <ul class="order-items">${r.items.map((i) => `<li><span class="oi-ico">${icon(i.icon)}</span><span><b>${i.qty} × ${esc(i.name)}</b><small>${esc(i.condition_label)} · ${fmt.rs(i.unit_rate * i.qty)}</small></span></li>`).join("")}</ul>
        ${r.recycler ? `<p class="order-rec">${icon("factory")} ${esc(r.recycler.name)}, ${esc(r.recycler.area)} <span class="mono">${esc(r.recycler.auth)}</span></p>` : ""}
        ${r.verified_kg ? `<p class="order-impact">${fmt.kg(r.verified_kg)} recycled · ${fmt.num(r.co2_kg, 1)} kg CO₂e avoided · <b>+${fmt.num(r.points)} Green Points</b></p>` : ""}
      </div>
      <div class="order-actions">${actions.join("")}</div>
    </div>
  </article>`;
}

function renderOrders() {
  const groups = { all: ORDERS, active: ORDERS.filter((r) => ACTIVE.includes(r.status)),
    done: ORDERS.filter((r) => ["picked_up", "recycled"].includes(r.status)), cancelled: ORDERS.filter((r) => ["cancelled", "rejected"].includes(r.status)) };
  const labels = { all: "All", active: "Active", done: "Completed", cancelled: "Cancelled" };
  $("#orderFilter").innerHTML = Object.keys(groups).map((k) => `<button class="chip" data-f="${k}" aria-pressed="${FILTER === k}">${labels[k]} <span class="cnt">${groups[k].length}</span></button>`).join("");
  const list = groups[FILTER];
  $("#orders").innerHTML = list.length ? list.map(orderCard).join("")
    : `<div class="empty panel">${icon("package")}<p>${FILTER === "all" ? "You haven't booked a pickup yet." : "Nothing here."}</p><a class="btn" href="/book.html" style="margin-top:12px">Book your first pickup</a></div>`;
}
$("#orderFilter").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) { FILTER = b.dataset.f; renderOrders(); } });

/* ---------------- points ---------------- */
async function renderPoints() {
  const d = await A("me/rewards");
  const next = d.catalog.find((r) => r.points > d.balance);
  $("#pointsPane").innerHTML = `
    <div class="pts-top"><div><small>Balance</small><b>${fmt.num(d.balance)}</b>${next ? `<p>${fmt.num(next.points - d.balance)} more for ${esc(next.name)}</p><div class="bar"><i style="width:${Math.round((d.balance / next.points) * 100)}%"></i></div>` : "<p>You can claim any reward.</p>"}</div>
      <a class="btn gold" href="/rewards.html">Open rewards catalogue</a></div>
    <h3 style="margin:28px 0 8px">Points history</h3>
    <ul class="hist">${d.history.map((h) => `<li><span>${esc(h.reason)}<br><small class="muted">${fmt.when(h.at)}</small></span><span class="${h.delta > 0 ? "plus" : "minus"}">${h.delta > 0 ? "+" : ""}${fmt.num(h.delta)}</span></li>`).join("") || '<li class="muted">No points yet.</li>'}</ul>
    ${d.claimed.length ? `<h3 style="margin:28px 0 8px">Claimed rewards</h3><ul class="hist">${d.claimed.map((c) => `<li><span>${esc(c.name)}<br><small class="muted">${fmt.when(c.at)}</small></span><span class="mono">${esc(c.code)}</span></li>`).join("")}</ul>` : ""}`;
}

/* ---------------- tabs ---------------- */
function showTab(t) {
  $$(".acct-tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === t));
  $$("[data-tab-pane]").forEach((p) => (p.hidden = p.dataset.tabPane !== t));
  if (t === "points") renderPoints().catch((e) => toast(e.message, true));
  history.replaceState(null, "", "#" + t);
}
$(".acct-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); });
document.addEventListener("click", (e) => { const a = e.target.closest("[data-goto]"); if (a) { e.preventDefault(); showTab(a.dataset.goto); } });

/* ---------------- profile ---------------- */
$("#profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    ME = { ...ME, ...(await A("me", { method: "PATCH", body: { name: f.name.value, email: f.email.value.trim() || null } })) };
    auth.set("customer", { ...auth.get("customer"), name: ME.name });
    renderHead(); toast("Details saved.");
  } catch (err) { toast(err.message, true); }
});
$("#pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  try { await A("me/password", { method: "POST", body: { old: f.old.value, new: f.new.value } }); f.reset(); toast("Password updated."); }
  catch (err) { toast(err.message, true); }
});
$("#signOut").addEventListener("click", () => signOut("customer", "/login.html"));


/* ---------------- start ---------------- */
(async function init() {
  if (!TOKEN) return;
  try {
    const [me, list] = await Promise.all([A("me"), A("me/requests")]);
    ME = me; ORDERS = list.requests;
    renderHead(); renderOrders();
    const tab = location.hash.slice(1);
    if (["points", "profile"].includes(tab)) showTab(tab);
  } catch (e) { toast(e.message, true); }
})();
