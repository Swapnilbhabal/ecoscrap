/* Green Points: balance, progress to the next reward, catalogue and history. */

let WHO = null;

function lookup(msg) {
  $("#rwLookup").hidden = false;
  $("#rwBoard").hidden = true;
  const last = memory.get();
  if (last) { $("#rwId").value = last.id; $("#rwPhone").value = last.phone; }
  if (msg) toast(msg, true);
}

const CUSTOMER = auth.token("customer");

async function load(id, phone) {
  let d;
  try { d = CUSTOMER ? await api("me/rewards", { token: CUSTOMER }) : await api(`rewards?phone=${phone}&booking_id=${id}`); }
  catch (e) { if (CUSTOMER) { auth.clear("customer"); return location.reload(); } return lookup(e.message); }
  WHO = { id, phone };
  if (id) memory.set({ id, phone });
  render(d);
}

function render(d) {
  $("#rwLookup").hidden = true;
  const board = $("#rwBoard");
  board.hidden = false;
  const next = d.catalog.find((r) => r.points > d.balance);
  const pct = next ? Math.round((d.balance / next.points) * 100) : 100;
  board.innerHTML = `
    <div class="rw-top">
      <div class="rw-balance"><span class="rw-coin" aria-hidden="true"></span>
        <h1>${esc(d.name)}'s Green Points</h1>
        <div class="pts" id="ptsNum">${fmt.num(d.balance)}</div>
        <p>${(() => { const n = d.history.filter((h) => h.delta > 0).length; return n + (n === 1 ? " pickup" : " pickups") + " so far"; })()}</p>
        <div class="rw-next">${next
          ? `<p style="font-size:var(--t-sm)"><b style="color:#fff">${fmt.num(next.points - d.balance)} more</b> for ${esc(next.name)}</p><div class="bar"><i style="width:${pct}%"></i></div>`
          : `<p style="font-size:var(--t-sm);color:#fff">You can claim any reward in the catalogue.</p>`}</div>
      </div>
      <div class="rw-how"><h3>Earn more</h3>
        <ul>
          <li>${icon("scale")}<span>10 points per kg weighed at your door</span></li>
          <li>${icon("circle-check-big")}<span>50 bonus points for each completed pickup</span></li>
          <li>${icon("building-2")}<span>Organise a society or office drive for a bigger haul</span></li>
        </ul>
        <a class="btn sm" href="/book.html" style="margin-top:16px">Book another pickup</a>
      </div>
    </div>
    <h2 style="font-size:var(--t-2xl);margin-top:48px">Spend your points</h2>
    <div class="rw-cat">${d.catalog.map((r) => {
      const ok = d.balance >= r.points;
      return `<div class="rw-item ${ok ? "" : "locked"}">${icon(r.icon)}<b>${esc(r.name)}</b><p class="muted">${esc(r.detail)}</p>
        <span class="cost">${fmt.num(r.points)} pts</span>
        <button class="btn sm ${ok ? "" : "ghost"}" data-r="${r.id}" ${ok ? "" : "disabled"}>${ok ? "Claim" : `${fmt.num(r.points - d.balance)} more needed`}</button></div>`;
    }).join("")}</div>
    <div class="two" style="margin-top:48px">
      <div><h2 style="font-size:var(--t-xl)">Points history</h2><ul class="hist">${d.history.map((h) =>
        `<li><span>${esc(h.reason)}<br><small class="muted">${fmt.when(h.at)}</small></span><span class="${h.delta > 0 ? "plus" : "minus"}">${h.delta > 0 ? "+" : ""}${fmt.num(h.delta)}</span></li>`).join("") || '<li class="muted">No points yet.</li>'}</ul></div>
      <div><h2 style="font-size:var(--t-xl)">Claimed rewards</h2><ul class="hist">${d.claimed.map((c) =>
        `<li><span>${esc(c.name)}<br><small class="muted">${fmt.when(c.at)}</small></span><span class="mono">${esc(c.code)}</span></li>`).join("") || '<li class="muted">Nothing claimed yet.</li>'}</ul></div>
    </div>`;
}

$("#rwBoard").addEventListener("click", (e) => {
  const b = e.target.closest("[data-r]");
  if (!b || b.disabled) return;
  const reward = b.closest(".rw-item").querySelector("b").textContent;
  modal(`<h3>Claim ${esc(reward)}?</h3><p class="muted">Points are deducted now. You'll get a code to show the collector on your next pickup.</p>
    <div style="display:flex;gap:10px;margin-top:18px"><button class="btn" id="yes">Claim reward</button><button class="btn ghost" id="no">Not now</button></div>`,
  (box, close) => {
    $("#no", box).onclick = close;
    $("#yes", box).onclick = async () => {
      try {
        const r = CUSTOMER
          ? await api("me/redeem", { method: "POST", token: CUSTOMER, body: { reward_id: b.dataset.r } })
          : await api("rewards/redeem", { method: "POST", body: { phone: WHO.phone, booking_id: WHO.id, reward_id: b.dataset.r } });
        close();
        modal(`<h3>Reward claimed</h3><p>Your code for <b>${esc(r.reward.name)}</b></p><p class="mono" style="font-size:2rem;color:var(--ink);margin:10px 0">${esc(r.code)}</p><p class="muted">${fmt.num(r.balance)} points left.</p><button class="btn" style="margin-top:14px" id="ok">Done</button>`,
          (bx, cl) => { $("#ok", bx).onclick = () => { cl(); load(WHO.id, WHO.phone); }; });
      } catch (err) { toast(err.message, true); }
    };
  });
});

$("#rwForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#rwId").value.trim().toUpperCase(), phone = $("#rwPhone").value.replace(/\D/g, "");
  if (!/^ES-[A-Z0-9]{6}$/.test(id)) return toast("Booking IDs look like ES-AB12CD.", true);
  if (!/^[6-9]\d{9}$/.test(phone)) return toast("Enter the 10-digit mobile number you booked with.", true);
  load(id, phone);
});

(function init() {
  const q = new URLSearchParams(location.search);
  if (CUSTOMER) load(null, null);
  else if (q.get("id") && q.get("phone")) load(q.get("id").toUpperCase(), q.get("phone"));
  else lookup();
})();
