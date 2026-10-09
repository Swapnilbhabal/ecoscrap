/* Booking wizard: items -> address -> time -> confirm. */

const state = {
  step: 1,
  lines: [],        // {category, condition, qty}
  photos: [],       // data URLs (compressed)
  pin: null,        // [lat, lng]
  date: null, slot: null,
};
let CAT = null, RECYCLERS = [], map = null, marker = null;

const NEXT_LABEL = { 1: "Continue to address", 2: "Continue to time", 3: "Continue to confirm", 4: "Confirm pickup" };

/* ---------------- step 1: items ---------------- */
function renderCats() {
  $("#catGrid").innerHTML = Object.entries(CAT.categories).map(([key, c]) => {
    const n = state.lines.filter((l) => l.category === key).reduce((a, l) => a + l.qty, 0);
    return `<button type="button" class="cat-card ${n ? "has" : ""}" data-add="${key}">
      ${icon(c.icon)}<b>${esc(c.name)}</b><small>${esc(c.examples)}</small>
      <span class="from">up to ${fmt.rs(c.rates.working)}</span>${n ? `<span class="count">${n}</span>` : ""}</button>`;
  }).join("");
}

function renderLines() {
  const box = $("#lines");
  if (!state.lines.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="label">Your items</div>` + state.lines.map((l, i) => {
    const c = CAT.categories[l.category];
    return `<div class="line" data-i="${i}">
      <span class="line-ico">${icon(c.icon)}</span>
      <div class="line-name"><b>${esc(c.name)}</b><small>${fmt.rs(c.rates[l.condition])} each</small></div>
      <div class="seg" role="group" aria-label="Condition">${Object.entries(CAT.conditions).map(([k, lab]) =>
        `<button type="button" data-cond="${k}" aria-pressed="${l.condition === k}">${esc(lab.split(" / ")[0])}</button>`).join("")}</div>
      <div class="stepper light-stepper"><button type="button" data-q="-1" aria-label="One less">−</button><output>${l.qty}</output><button type="button" data-q="1" aria-label="One more">+</button></div>
      <button type="button" class="line-x" data-remove aria-label="Remove ${esc(c.name)}">${icon("trash-2")}</button>
    </div>`;
  }).join("");
}

function addLine(category, condition = "not_working", qty = 1) {
  const same = state.lines.find((l) => l.category === category && l.condition === condition);
  if (same) same.qty = Math.min(20, same.qty + qty);
  else if (state.lines.length < 12) state.lines.push({ category, condition, qty });
  refresh();
}

$("#catGrid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-add]");
  if (b) addLine(b.dataset.add);
});

$("#lines").addEventListener("click", (e) => {
  const row = e.target.closest(".line");
  if (!row) return;
  const l = state.lines[+row.dataset.i];
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.cond) l.condition = b.dataset.cond;
  if (b.dataset.q) l.qty = Math.max(0, Math.min(20, l.qty + +b.dataset.q));
  if (b.hasAttribute("data-remove") || l.qty === 0) state.lines.splice(+row.dataset.i, 1);
  refresh();
});

/* Photos are shrunk in the browser (max 1280 px, JPEG) before upload. */
function compress(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.78));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error("That file isn't an image we can read."));
    img.src = URL.createObjectURL(file);
  });
}

$("#photoInput").addEventListener("change", async (e) => {
  for (const f of [...e.target.files].slice(0, 3 - state.photos.length)) {
    try { state.photos.push(await compress(f)); } catch (err) { toast(err.message, true); }
  }
  e.target.value = "";
  renderThumbs();
});

function renderThumbs() {
  $("#thumbs").innerHTML = state.photos.map((p, i) =>
    `<div class="thumb"><img src="${p}" alt="Item photo ${i + 1}"><button type="button" data-p="${i}" aria-label="Remove photo">${icon("x")}</button></div>`).join("");
}
$("#thumbs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-p]");
  if (b) { state.photos.splice(+b.dataset.p, 1); renderThumbs(); }
});

/* ---------------- step 2: map + address ---------------- */
function setPin(latlng, fly = false) {
  state.pin = [+latlng[0].toFixed(6), +latlng[1].toFixed(6)];
  if (!map) return;
  if (!marker) {
    marker = L.marker(state.pin, { draggable: true, icon: pins.drop(), autoPan: true }).addTo(map);
    marker.on("dragend", () => { const p = marker.getLatLng(); setPin([p.lat, p.lng]); });
  } else marker.setLatLng(state.pin);
  if (fly) map.flyTo(state.pin, 16, { duration: 0.8 });
  const near = nearestRecycler();
  $("#mapHint").innerHTML = `${icon("circle-check-big")} Pin placed${near ? ` · nearest authorised recycler is ${esc(near.r.name)}, ${(near.d / 1000).toFixed(1)} km away` : ""}`;
  $("#mapHint").classList.add("ok");
  renderEstimate();
}

function nearestRecycler() {
  if (!state.pin || !RECYCLERS.length) return null;
  return RECYCLERS.map((r) => ({ r, d: haversine(state.pin, [r.lat, r.lng]) })).sort((a, b) => a.d - b.d)[0];
}

function initMap() {
  if (map) { setTimeout(() => map.invalidateSize(), 50); return; }
  map = makeMap($("#pickMap"), { zoom: 11 });
  if (!map) return;
  RECYCLERS.forEach((r) => L.marker([r.lat, r.lng], { icon: pins.rec(), interactive: false }).addTo(map));
  map.on("click", (e) => setPin([e.latlng.lat, e.latlng.lng]));
  if (state.pin) setPin(state.pin);
}

$("#locateBtn").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("Your browser can't share location. Tap the map instead.", true);
  const b = $("#locateBtn");
  b.disabled = true; b.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(
    (p) => { setPin([p.coords.latitude, p.coords.longitude], true); b.disabled = false; b.textContent = "Use my location"; },
    () => { toast("Location permission was not given. Tap the map instead.", true); b.disabled = false; b.textContent = "Use my location"; },
    { enableHighAccuracy: true, timeout: 10000 });
});

/* ---------------- step 3: date + slot ---------------- */
function renderTime() {
  $("#dayChips").innerHTML = CAT.dates.map((d) => {
    const dt = new Date(d + "T00:00:00");
    return `<button type="button" class="chip day" data-date="${d}" aria-pressed="${state.date === d}">
      <small>${dt.toLocaleDateString("en-IN", { weekday: "short" })}</small><b>${dt.getDate()}</b><small>${dt.toLocaleDateString("en-IN", { month: "short" })}</small></button>`;
  }).join("");
  $("#slotChips").innerHTML = CAT.slots.map((s) =>
    `<button type="button" class="chip" data-slot="${s}" aria-pressed="${state.slot === s}">${icon("clock")}${fmt.slot(s)}</button>`).join("");
}
$("#dayChips").addEventListener("click", (e) => { const b = e.target.closest("[data-date]"); if (b) { state.date = b.dataset.date; renderTime(); } });
$("#slotChips").addEventListener("click", (e) => { const b = e.target.closest("[data-slot]"); if (b) { state.slot = b.dataset.slot; renderTime(); } });

/* ---------------- estimate sidebar ---------------- */
function totals() {
  let rs = 0, kg = 0, co2 = 0;
  state.lines.forEach((l) => {
    const c = CAT.categories[l.category];
    rs += c.rates[l.condition] * l.qty; kg += c.kg * l.qty; co2 += c.kg * l.qty * c.co2_factor;
  });
  const pts = state.lines.length ? Math.round(kg * CAT.points.per_kg) + CAT.points.per_pickup : 0;
  return { rs, kg, co2, pts };
}

function renderEstimate() {
  const t = totals();
  $("#estRs").textContent = fmt.rs(t.rs);
  $("#estKg").textContent = fmt.num(t.kg, 1) + " kg";
  $("#estPts").textContent = "+" + fmt.num(t.pts);
  $("#estCo2").textContent = fmt.num(t.co2, 1) + " kg";
  $("#estLines").innerHTML = state.lines.length ? state.lines.map((l) => {
    const c = CAT.categories[l.category];
    return `<li><span>${l.qty} × ${esc(c.name)} <small>${esc(CAT.conditions[l.condition].split(" / ")[0].toLowerCase())}</small></span><b>${fmt.rs(c.rates[l.condition] * l.qty)}</b></li>`;
  }).join("") : '<li class="muted">No items yet</li>';
  const near = nearestRecycler();
  const dest = $("#estDest");
  dest.hidden = !near;
  if (near) dest.innerHTML = `${icon("factory")}<span>Goes to <b>${esc(near.r.name)}</b><br><small class="mono">${esc(near.r.auth)}</small></span>`;
}

function refresh() { renderCats(); renderLines(); renderEstimate(); }

/* ---------------- review (step 4) ---------------- */
function renderReview() {
  const t = totals();
  const near = nearestRecycler();
  $("#review").innerHTML = `<div class="label">Check before you confirm</div>
    <dl>
      <div><dt>Items</dt><dd>${state.lines.map((l) => `${l.qty} × ${esc(CAT.categories[l.category].name)}`).join(", ")}</dd></div>
      <div><dt>Address</dt><dd>${esc($("#address").value)}${$("#landmark").value ? ", near " + esc($("#landmark").value) : ""}, ${esc($("#pincode").value)}</dd></div>
      <div><dt>When</dt><dd>${fmt.date(state.date)}, ${fmt.slot(state.slot)}</dd></div>
      <div><dt>Payout</dt><dd>${fmt.rs(t.rs)}${$("#donate").checked ? " (donated)" : ""}</dd></div>
      ${near ? `<div><dt>Recycler</dt><dd>${esc(near.r.name)}, ${esc(near.r.area)}</dd></div>` : ""}
    </dl>`;
}

/* ---------------- validation per step ---------------- */
function mark(id, ok) { $("#" + id).classList.toggle("error", !ok); return ok; }

function validate(step) {
  if (step === 1 && !state.lines.length) return "Add at least one item.";
  if (step === 2) {
    if (!state.pin) return "Tap the map to place your pickup pin.";
    if (!mark("address", $("#address").value.trim().length >= 8)) return "Enter your flat, building and street.";
    if (!mark("pincode", /^4\d{5}$/.test($("#pincode").value))) return "Enter a 6-digit pincode starting with 4.";
  }
  if (step === 3) {
    if (!state.date) return "Choose a pickup day.";
    if (!state.slot) return "Choose a time slot.";
  }
  if (step === 4) {
    if (!mark("name", /^[A-Za-z][A-Za-z .'-]{1,59}$/.test($("#name").value.trim()))) return "Enter your full name using letters.";
    if (!mark("phone", /^[6-9]\d{9}$/.test($("#phone").value))) return "Enter a 10-digit mobile number.";
    const em = $("#email").value.trim();
    if (!mark("email", !em || /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(em))) return "Enter a valid email or leave it empty.";
  }
  return null;
}

function go(step) {
  state.step = step;
  $$(".pane").forEach((p) => (p.hidden = +p.dataset.step !== step));
  $$("#progress li").forEach((li) => {
    li.classList.toggle("on", +li.dataset.s === step);
    li.classList.toggle("done", +li.dataset.s < step);
  });
  $("#backBtn").hidden = step === 1;
  $("#nextBtn").textContent = NEXT_LABEL[step];
  if (step === 2) initMap();
  if (step === 3) renderTime();
  if (step === 4) renderReview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#backBtn").addEventListener("click", () => go(state.step - 1));
$("#nextBtn").addEventListener("click", async () => {
  const problem = validate(state.step);
  if (problem) return toast(problem, true);
  if (state.step < 4) return go(state.step + 1);
  await submit();
});
$("#phone").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10)));
$("#pincode").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6)));

/* ---------------- submit ---------------- */
async function submit() {
  const btn = $("#nextBtn");
  btn.disabled = true; btn.textContent = "Booking…";
  const body = {
    name: $("#name").value.trim(), phone: $("#phone").value, email: $("#email").value.trim() || null,
    address: $("#address").value.trim(), landmark: $("#landmark").value.trim() || null, pincode: $("#pincode").value,
    lat: state.pin[0], lng: state.pin[1], pickup_date: state.date, slot: state.slot,
    wipe: $("#wipe").checked, donate: $("#donate").checked, notes: $("#notes").value.trim() || null,
    photos: state.photos, items: state.lines,
  };
  try {
    const r = await api("requests", { method: "POST", body, token: auth.token("customer") });
    memory.set({ id: r.id, phone: body.phone });
    showDone(r, body.phone);
  } catch (err) {
    toast(err.message, true);
    const field = (err.field || "").split(".")[0];
    const stepOf = { items: 1, address: 2, pincode: 2, landmark: 2, lat: 2, lng: 2, pickup_date: 3, slot: 3, name: 4, phone: 4, email: 4 };
    if (stepOf[field] && stepOf[field] !== 4) go(stepOf[field]);
    if (field && $("#" + field)) $("#" + field).classList.add("error");
    btn.disabled = false; btn.textContent = NEXT_LABEL[4];
  }
}

function showDone(r, phone) {
  $("#bookGrid").hidden = true;
  const done = $("#done");
  done.hidden = false;
  const trackUrl = `/track.html?id=${r.id}&phone=${phone}`;
  done.innerHTML = `
    <div class="done-mark" aria-hidden="true"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="36"/><path d="M24 41l11 11 21-23"/></svg></div>
    <h1>Pickup booked</h1>
    <p class="done-lead">${esc(r.collector?.name || "A collector")} will come on <b>${fmt.date(r.pickup_date)}</b> between <b>${fmt.slot(r.slot)}</b>.</p>
    <div class="done-codes">
      <div><small>Booking ID</small><b class="mono" id="bid">${esc(r.id)}</b><button class="btn sm ghost" id="copyId" type="button">${icon("file-text")}Copy</button></div>
      <div><small>Handover code</small><b class="mono">${esc(r.otp)}</b><span class="muted">Share only when the collector is at your door</span></div>
      <div><small>You'll get</small><b>${fmt.rs(r.est_payout)}</b><span class="muted">${r.donate ? "Donated to a tree drive" : "Paid at pickup"}</span></div>
    </div>
    <div class="done-actions"><a class="btn lg" href="${trackUrl}">${icon("navigation")}Track live</a>${auth.get("customer") ? `<a class="btn lg ghost" href="/account.html">${icon("user")}My account</a>` : `<a class="btn lg ghost" href="/login.html?role=customer&signup=1&next=/account.html">${icon("user")}Create an account to save this</a>`}</div>
    <div class="done-check">
      <h3>Before the collector arrives</h3>
      <ul>
        <li>${icon("check")}Back up photos and contacts</li>
        <li>${icon("check")}Log out of Google / Apple ID and banking apps</li>
        <li>${icon("check")}Remove the SIM and memory card</li>
        <li>${icon("check")}Factory-reset phones and laptops</li>
        <li>${icon("check")}Keep chargers and cables with the device</li>
      </ul>
    </div>`;
  $("#copyId").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(r.id); toast("Booking ID copied."); } catch { toast("Booking ID: " + r.id); }
  });
  window.scrollTo({ top: 0 });
}

/* ---------------- start ---------------- */
(async function init() {
  try {
    [CAT, { recyclers: RECYCLERS }] = await Promise.all([api("catalog"), api("recyclers")]);
  } catch (e) { return toast(e.message, true); }
  const add = new URLSearchParams(location.search).get("add");
  if (add) add.split(",").forEach((part) => {
    const [c, cond, q] = part.split(":");
    if (CAT.categories[c] && CAT.conditions[cond]) addLine(c, cond, Math.max(1, Math.min(20, +q || 1)));
  });
  // signed-in customers: details come from the account
  const u = auth.get("customer");
  const note = document.createElement("p");
  note.className = "acct-note";
  if (u) {
    $("#name").value = u.name; $("#phone").value = u.phone; $("#phone").readOnly = true;
    note.innerHTML = `${icon("user")}<span>Booking as <b>${esc(u.name)}</b>. This pickup and its certificate will appear in <a class="link" href="/account.html">My account</a>.</span>`;
  } else {
    note.innerHTML = `${icon("user")}<span>Have an account? <a class="link" href="/login.html?next=/book.html">Sign in</a> so this pickup and its certificate are saved in your history. You can also book as a guest.</span>`;
  }
  $(".pane[data-step='4'] .pane-sub").after(note);
  state.date = CAT.dates[0];
  refresh();
})();
