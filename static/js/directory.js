/* "Recycle everything else" directory with material filters and search. */

const MAT_COLOR = { plastic: "#2f7a9c", dry: "#8a6510", textile: "#9c3f6b", organic: "#4f7a2f", paper: "#6b5a3e", electronics: "#a85a24" };
let DATA = null, MAT = "all", QUERY = "";

function render() {
  const list = DATA.entries.filter((o) =>
    (MAT === "all" || o.materials.includes(MAT)) &&
    (!QUERY || (o.name + " " + o.city + " " + o.what + " " + (o.address || "")).toLowerCase().includes(QUERY)));
  $("#dirGrid").innerHTML = list.map((o) => `<article class="org">
      <div class="org-top"><div><h3>${esc(o.name)}</h3><span class="city">${icon("map-pin")}${esc(o.city)}</span></div>
        <span class="org-mono" style="background:${MAT_COLOR[o.materials[0]]}" aria-hidden="true">${esc(o.name[0])}</span></div>
      <div class="tags">${o.materials.map((m) => `<span class="tag">${esc(DATA.materials[m])}</span>`).join("")}</div>
      <p>${esc(o.what)}</p>
      <p class="how"><b>How to send:</b> ${esc(o.how)}</p>
      ${o.address ? `<p class="addr">${icon("map-pin")}<span><b>Send to:</b> ${esc(o.address)}</span></p>` : ""}
      <div class="org-actions">
        ${o.url ? `<a class="btn sm dark" href="${o.url}" target="_blank" rel="noopener">${icon("external-link")}Official website</a>` : ""}
        ${o.phone ? `<a class="btn sm ${o.url ? "ghost" : "dark"}" href="tel:+91${o.phone}">${icon("phone")}Call ${esc(o.phone.replace(/(\d{5})(\d{5})/, "$1 $2"))}</a>` : ""}
      </div>
      ${!o.url ? `<p class="fine"></p>` : ""}
    </article>`).join("") || `<div class="empty">${icon("search")}<p>No organisation matches. Try another material or clear the search.</p></div>`;
}

function renderChips() {
  const opts = [["all", "All"], ...Object.entries(DATA.materials)];
  $("#matChips").innerHTML = opts.map(([k, l]) => `<button class="chip" data-m="${k}" aria-pressed="${MAT === k}">${esc(l)}</button>`).join("");
}

$("#matChips").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (b) { MAT = b.dataset.m; renderChips(); render(); } });
$("#dirSearch").addEventListener("input", (e) => { QUERY = e.target.value.trim().toLowerCase(); render(); });

api("directory").then((d) => { DATA = d; renderChips(); render(); }).catch((e) => toast(e.message, true));
