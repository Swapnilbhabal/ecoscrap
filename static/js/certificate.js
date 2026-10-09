/* Recycling certificate: printable, with a QR code that links back to this verification page. */

function qrSvg(text) {
  if (typeof qrcode === "undefined") return "";
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

const SEAL = `<svg class="cert-seal" viewBox="0 0 120 120" aria-hidden="true">
  <defs><path id="sealPath" d="M60 60 m-44 0 a44 44 0 1 1 88 0 a44 44 0 1 1 -88 0"/></defs>
  <circle cx="60" cy="60" r="56" fill="none" stroke="#0e3b2e" stroke-width="2"/>
  <circle cx="60" cy="60" r="33" fill="#0e3b2e"/>
  <text font-family="JB Mono, monospace" font-size="9.2" letter-spacing="2.2" fill="#0e3b2e"><textPath href="#sealPath">RECYCLED RESPONSIBLY · ECOSCRAP · MUMBAI ·</textPath></text>
  <path d="M48 66a12 12 0 1 1 21-8" stroke="#d2793a" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M71.5 52 69 58l-6-1.6" stroke="#d2793a" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="48" cy="66" r="3.5" fill="#e9b949"/></svg>`;

async function show(id) {
  const box = $("#cert");
  let c;
  try { c = await api("certificates/" + encodeURIComponent(id)); }
  catch (e) {
    box.hidden = true;
    $("#certLookup").hidden = false;
    $("#certId").value = id;
    return toast(e.message, true);
  }
  const verifyUrl = `${location.origin}/certificate.html?id=${c.certificate_id}`;
  document.title = `Certificate ${c.certificate_id} – EcoScrap`;
  $("#tools").hidden = false;
  $("#pdfBtn").href = `/api/certificates/${encodeURIComponent(c.certificate_id)}/pdf`;
  box.innerHTML = `
    <svg class="cert-traces" aria-hidden="true"></svg>
    ${c.is_demo ? '<div class="cert-demo" aria-hidden="true">DEMO</div>' : ""}
    <header class="cert-head">
      <span class="brand">${LOGO}<span>EcoScrap</span></span>
      <div class="cert-id">Certificate no.<b class="mono">${esc(c.certificate_id)}</b>Booking ${esc(c.booking_id)}</div>
    </header>
    <h1>Certificate of responsible e-waste recycling</h1>
    <p class="to">This certifies that <b>${esc(c.name)}</b> handed over the electronics below for recycling on <strong style="color:var(--ink)">${c.recycled_at ? fmt.dateLong(c.recycled_at) : "—"}</strong>, and that they were received by an authorised recycler.</p>
    <div class="cert-figs">
      <div><small>Verified weight</small><b>${fmt.kg(c.verified_kg)}</b></div>
      <div><small>CO₂e avoided (estimate)</small><b>${fmt.num(c.co2_kg, 1)} kg</b></div>
      <div><small>Like not driving a car for</small><b>${fmt.num(c.car_km)} km</b></div>
      <div><small>Green Points earned</small><b>${fmt.num(c.points)}</b></div>
    </div>
    <div class="cert-body">
      <div><h4>Items recycled</h4><table>${c.items.map((it) => `<tr><td>${it.qty} × ${esc(it.name)}</td><td>${esc(it.condition_label)}</td></tr>`).join("")}</table>
        <p style="margin-top:12px;font-size:var(--t-sm)">${c.wipe ? "A data-wipe request was recorded with this pickup." : "No data-wipe request was recorded."}</p></div>
      <div class="cert-rec"><h4>Received by</h4><b>${esc(c.recycler.name)}</b><span>${esc(c.recycler.type)}, ${esc(c.recycler.area)}</span><br>
        <span class="mono">MPCB authorisation ${esc(c.recycler.auth)}</span><br><small>Valid to ${fmt.dateLong(c.recycler.valid_to)}</small>
        <h4 style="margin-top:16px">Collected by</h4><b>${esc(c.collector?.name || "")}</b><span>EcoScrap pickup partner, ${esc(c.collector?.hub || "")} hub</span></div>
    </div>
    <footer class="cert-foot">
      <div class="cert-qr"><div class="qr">${qrSvg(verifyUrl)}</div><span>Scan to verify this certificate online.<br><span class="mono" style="font-size:10px;word-break:break-all">${esc(verifyUrl)}</span></span></div>
      ${SEAL}
    </footer>`;
  traces($(".cert-traces", box), 23, 12);
}

$("#printBtn").addEventListener("click", () => window.print());
$("#shareBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); toast("Verify link copied."); } catch { toast(location.href); }
});
$("#certForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#certId").value.trim().toUpperCase();
  if (!id) return;
  history.replaceState(null, "", "?id=" + id);
  $("#certLookup").hidden = true; $("#cert").hidden = false;
  show(id);
});

const certParam = new URLSearchParams(location.search).get("id");
if (certParam) show(certParam);
else { $("#cert").hidden = true; $("#certLookup").hidden = false; }
