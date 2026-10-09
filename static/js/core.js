/* =====================================================================
   core.js - shared helpers used by every page
     api()      call the backend and get JSON (throws Error with a message)
     icon()     inline an icon from the sprite
     toast()    short message at the bottom of the screen
     modal()    simple dialog
     fmt.*      number / date / money formatting
     traces()   draws the circuit-trace background used in page headers
   It also builds the shared header, footer and help buttons.
   ===================================================================== */

const CFG = window.ECOSCRAP_CONFIG || {};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function icon(name, cls = "") {
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="/img/icons.svg#i-${name}"></use></svg>`;
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  let res;
  try {
    res = await fetch("/api/" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Can't reach the EcoScrap server. Check that it is running.");
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Something went wrong (${res.status}).`);
    err.status = res.status;
    err.field = data.field;
    throw err;
  }
  return data;
}

const fmt = {
  num: (n, d = 0) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }),
  rs: (n) => "₹" + Number(n || 0).toLocaleString("en-IN"),
  kg: (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 }) + " kg",
  date: (iso) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }),
  dateLong: (iso) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
  time: (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }),
  when: (iso) => {
    const d = new Date(iso), mins = (Date.now() - d) / 60000;
    if (mins < 1) return "just now";
    if (mins < 60) return Math.round(mins) + " min ago";
    if (mins < 60 * 24) return Math.round(mins / 60) + " h ago";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + ", " + fmt.time(iso);
  },
  slot: (s) => s.replace(/(\d\d):00/g, (_, h) => { h = +h; return (h % 12 || 12) + (h < 12 ? " am" : " pm"); }).replace("-", " – "),
};

function toast(message, bad = false) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.className = "toast" + (bad ? " bad" : "");
  t.innerHTML = icon(bad ? "triangle-alert" : "circle-check-big") + `<span>${esc(message)}</span>`;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 3400);
}

/* modal(html, onMount) -> returns {close}. Clicking the backdrop or Esc closes it. */
function modal(html, onMount) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { m.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => e.key === "Escape" && close();
  m.addEventListener("click", (e) => e.target === m && close());
  document.addEventListener("keydown", onKey);
  document.body.append(m);
  onMount && onMount(m.firstElementChild, close);
  m.querySelector("input,button,select")?.focus();
  return { close };
}

/* Signed-in sessions, one per role. Kept in sessionStorage, so:
   - closing the tab or browser signs you out
   - each tab can be signed in as a different role (handy for demos)
   The server also clears every session when it restarts. */
const auth = {
  key: (role) => "ecoscrap:auth:" + role,
  get(role) { try { return JSON.parse(sessionStorage.getItem(this.key(role)) || "null"); } catch { return null; } },
  set(role, v) { try { sessionStorage.setItem(this.key(role), JSON.stringify(v)); } catch { /* private mode */ } },
  clear(role) { try { sessionStorage.removeItem(this.key(role)); } catch { /* ignore */ } },
  token(role) { return this.get(role)?.token || null; },
};
async function signOut(role, to = "/") {
  const t = auth.token(role);
  if (t) { try { await api("auth/logout", { method: "POST", token: t }); } catch { /* signed out anyway */ } }
  auth.clear(role);
  try { sessionStorage.removeItem("ecoscrap:last"); } catch { /* ignore */ }
  location.href = to;
}

/* Show / hide button for every password field. */
function addEyes(root = document) {
  $$("input[type=password]:not([data-eye])", root).forEach((inp) => {
    inp.dataset.eye = "1";
    const wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    inp.replaceWith(wrap);
    wrap.append(inp);
    const b = document.createElement("button");
    b.type = "button"; b.className = "pw-eye"; b.setAttribute("aria-label", "Show password");
    b.innerHTML = icon("eye");
    b.addEventListener("click", () => {
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      b.innerHTML = icon(show ? "eye-off" : "eye");
      b.setAttribute("aria-label", show ? "Hide password" : "Show password");
      inp.focus();
    });
    wrap.append(b);
  });
}
/* Send people to the sign-in page, then bring them back here. */
function requireSignIn(role) {
  location.href = `/login.html?role=${role}&next=${encodeURIComponent(location.pathname + location.search)}`;
}

/* Remember the last booking only for this browser tab, so Track / Rewards can prefill.
   It is never kept after the tab closes, so the next person on this device sees nothing. */
const memory = {
  get() { try { return JSON.parse(sessionStorage.getItem("ecoscrap:last") || "null"); } catch { return null; } },
  set(v) { try { sessionStorage.setItem("ecoscrap:last", JSON.stringify(v)); } catch { /* private mode */ } },
};
try { localStorage.removeItem("ecoscrap:last"); } catch { /* clean up what older versions saved */ }

/* ---------- circuit traces (decorative background for page headers) ---------- */
function traces(svg, seed = 7, density = 16) {
  if (!svg) return;
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const W = 1200, H = 420, step = 24;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  let out = "";
  for (let i = 0; i < density; i++) {
    let x = Math.round((rnd() * W) / step) * step, y = Math.round((rnd() * H) / step) * step;
    let d = `M${x} ${y}`;
    const segs = 3 + Math.floor(rnd() * 4);
    let dir = Math.floor(rnd() * 4);
    for (let k = 0; k < segs; k++) {
      const len = step * (2 + Math.floor(rnd() * 7));
      const diag = rnd() < 0.35;
      const dx = [1, 0, -1, 0][dir], dy = [0, 1, 0, -1][dir];
      if (diag) { x += dx * len * 0.6 + dy * len * 0.6; y += dy * len * 0.6 + dx * len * 0.6; }
      else { x += dx * len; y += dy * len; }
      d += ` L${x} ${y}`;
      dir = (dir + (rnd() < 0.5 ? 1 : 3)) % 4;
    }
    const len = 900;
    out += `<path d="${d}" fill="none" stroke="url(#tg)" stroke-width="2" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="${len}"><animate attributeName="stroke-dashoffset" to="0" dur="${2 + rnd() * 2}s" begin="${rnd() * 0.8}s" fill="freeze"/></path>`;
    out += `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#e9b949" stroke-width="2" opacity=".7"/>`;
  }
  svg.innerHTML = `<defs><linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#d2793a" stop-opacity=".15"/><stop offset="1" stop-color="#d2793a" stop-opacity=".7"/></linearGradient></defs>${out}`;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) svg.querySelectorAll("path").forEach((p) => p.setAttribute("stroke-dashoffset", 0));
}

const LOGO = `<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="11" fill="#165040"/><path d="M12.5 26.5A9 9 0 1 1 28.4 19" stroke="#d2793a" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M29.2 13.6 28.4 19l-5.3-1" stroke="#d2793a" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12.5" cy="26.5" r="3.2" fill="#e9b949"/><path d="M12.5 29.7V35" stroke="#e9b949" stroke-width="2" stroke-linecap="round"/></svg>`;

/* ---------- shared chrome ---------- */
(function chrome() {
  const body = document.body;
  if (body.dataset.chrome === "none") return;
  const pages = [
    ["/", "Home"], ["/book.html", "Book pickup"], ["/track.html", "Track"], ["/rates.html", "Rates"],
    ["/learn.html", "Learn"], ["/directory.html", "Recycle more"], ["/rewards.html", "Green Points"],
  ];
  const here = location.pathname === "/index.html" ? "/" : location.pathname;
  const head = document.createElement("header");
  head.className = "site-head" + (body.dataset.head === "solid" ? " always" : "");
  head.innerHTML = `<div class="wrap">
      <a class="brand" href="/">${LOGO}<span>EcoScrap</span></a>
      <nav class="nav" id="nav" aria-label="Main">${pages.map(([h, t]) => `<a href="${h}" ${h === here ? 'aria-current="page"' : ""}>${t}</a>`).join("")}</nav>
      ${(() => { const u = auth.get("customer"); return u
        ? `<div class="acct-menu"><button class="acct-btn" type="button" aria-haspopup="true" aria-expanded="false" ${here === "/account.html" ? 'aria-current="page"' : ""}><span class="acct-av">${esc((u.name || "?").split(" ").map((p) => p[0]).join("").slice(0, 2))}</span><span class="acct-lbl">${esc(u.name.split(" ")[0])}</span>${icon("chevron-down")}</button>
            <div class="acct-pop" hidden><p><b>${esc(u.name)}</b><small>${esc(u.phone)}</small></p><a href="/account.html">${icon("package")}My pickups</a><a href="/account.html#points">${icon("gift")}Green Points</a><a href="/account.html#profile">${icon("user")}Profile</a><button type="button" data-signout>${icon("log-out")}Sign out</button></div></div>`
        : `<a class="acct-btn" href="/login.html" ${here === "/login.html" ? 'aria-current="page"' : ""}>${icon("user")}<span class="acct-lbl">Sign in</span></a>`; })()}
      <a class="btn sm head-cta" href="/book.html">Book a pickup</a>
      <button class="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="nav">${icon("menu")}</button>
    </div>`;
  body.prepend(head);
  const nav = $("#nav", head), btn = $(".menu-btn", head);
  btn.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", open);
    btn.innerHTML = icon(open ? "x" : "menu");
  });
  const menuBtn = $(".acct-menu .acct-btn", head), pop = $(".acct-pop", head);
  if (menuBtn) {
    menuBtn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; menuBtn.setAttribute("aria-expanded", String(!pop.hidden)); });
    document.addEventListener("click", (e) => { if (!e.target.closest(".acct-menu")) { pop.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); } });
    $("[data-signout]", pop).addEventListener("click", () => signOut("customer", "/login.html"));
  }
  const onScroll = () => head.classList.toggle("solid", scrollY > 30);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (body.dataset.foot !== "none") {
    const contact = [
      CFG.phone && `<a href="tel:${CFG.phone.replace(/\s/g, "")}">${icon("phone")} ${esc(CFG.phone)}</a>`,
      CFG.whatsapp && `<a href="https://wa.me/${CFG.whatsapp}" target="_blank" rel="noopener">${icon("message-circle")} WhatsApp us</a>`,
      CFG.email && `<a href="mailto:${CFG.email}">${icon("mail")} ${esc(CFG.email)}</a>`,
      `<a href="/#contact">${icon("send")} Send us a message</a>`,
    ].filter(Boolean).join("");
    const foot = document.createElement("footer");
    foot.className = "site-foot";
    foot.innerHTML = `<div class="wrap">
      <div class="foot-grid">
        <div><a class="brand" href="/">${LOGO}<span>EcoScrap</span></a>
          <p style="margin-top:14px;max-width:34ch">Free doorstep e-waste pickup across Mumbai, Thane and Navi Mumbai. Every pickup goes to an MPCB-authorised recycler.</p>
          <p style="margin-top:12px">Mon–Sat, 9 am – 8 pm</p></div>
        <div><h4>Customers</h4><a href="/book.html">Book a pickup</a><a href="/track.html">Track a pickup</a><a href="/rates.html">Rate card</a><a href="/rewards.html">Green Points</a></div>
        <div><h4>Learn</h4><a href="/learn.html">Why e-waste matters</a><a href="/learn.html#rules">E-Waste Rules 2022</a><a href="/directory.html">Recycle everything else</a><a href="/#recyclers">Our recyclers</a></div>
        <div><h4>Contact</h4>${contact}<h4 style="margin-top:18px">Sign in</h4><a href="/login.html?role=customer">Customer account</a><a href="/login.html?role=collector">Collector app</a><a href="/login.html?role=admin">Admin dashboard</a></div>
      </div>
      <div class="foot-note"><span>${esc(CFG.team || "EcoScrap")} · ${esc(CFG.subject || "")} project</span><span>Recycler list: Maharashtra Pollution Control Board. Demo bookings are marked as demo.</span></div>
    </div>`;
    body.append(foot);
  }

  if (CFG.whatsapp || CFG.phone) {
    const fab = document.createElement("div");
    fab.className = "fab";
    fab.innerHTML = (CFG.whatsapp ? `<a class="wa" href="https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent("Hi EcoScrap, I want to book an e-waste pickup.")}" target="_blank" rel="noopener" aria-label="WhatsApp us">${icon("message-circle")}</a>` : "")
      + (CFG.phone ? `<a class="call" href="tel:${CFG.phone.replace(/\s/g, "")}" aria-label="Call us">${icon("phone")}</a>` : "");
    body.append(fab);
  }
  traces($(".page-head .traces"), body.dataset.seed ? +body.dataset.seed : 11);
})();

addEyes();