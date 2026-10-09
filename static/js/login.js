/* One sign-in page for customers, collectors and admin. */

const params = new URLSearchParams(location.search);
const NEXT = { customer: "/account.html", collector: "/collector.html", admin: "/admin.html" };
const goNext = (role) => {
  const n = params.get("next");
  location.href = n && n.startsWith("/") && !n.startsWith("//") ? n : NEXT[role];
};

traces($(".auth-side .traces"), 41, 14);

function pickRole(role) {
  $$(".role").forEach((b) => b.setAttribute("aria-selected", b.dataset.role === role));
  $$(".role-pane").forEach((p) => (p.hidden = p.dataset.pane !== role));
  $(".back").hidden = role !== "customer";
  history.replaceState(null, "", `?role=${role}${params.get("next") ? "&next=" + encodeURIComponent(params.get("next")) : ""}`);
  $(`[data-pane=${role}] input`)?.focus();
}
$(".roles").addEventListener("click", (e) => { const b = e.target.closest("[data-role]"); if (b) pickRole(b.dataset.role); });

/* customer: sign in / create account */
$(".seg-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  $$(".seg-tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
  $("#custLogin").hidden = b.dataset.mode !== "login";
  $("#custSignup").hidden = b.dataset.mode !== "signup";
});
$$("input[name=phone]").forEach((i) => i.addEventListener("input", () => (i.value = i.value.replace(/\D/g, "").slice(0, 10))));
$("#demoFill").addEventListener("click", () => {
  $("#custLogin [name=phone]").value = "9999900001";
  $("#custLogin [name=password]").value = "demo1234";
  $("#custLogin").requestSubmit();
});

async function submitForm(form, path, role, after) {
  const btn = $("button[type=submit]", form);
  const data = Object.fromEntries(new FormData(form));
  btn.disabled = true;
  try {
    const r = await api(path, { method: "POST", body: data });
    after(r);
    goNext(role);
  } catch (err) {
    toast(err.message, true);
    const f = err.field && form.elements[err.field];
    if (f) { f.classList.add("error"); f.focus(); }
    btn.disabled = false;
  }
}

$("#custLogin").addEventListener("submit", (e) => {
  e.preventDefault();
  submitForm(e.target, "auth/login", "customer", (r) => auth.set("customer", { token: r.token, name: r.user.name, phone: r.user.phone }));
});
$("#custSignup").addEventListener("submit", (e) => {
  e.preventDefault();
  submitForm(e.target, "auth/signup", "customer", (r) => auth.set("customer", { token: r.token, name: r.user.name, phone: r.user.phone }));
});
$("#colLogin").addEventListener("submit", (e) => {
  e.preventDefault();
  submitForm(e.target, "collector/login", "collector", (r) => auth.set("collector", { token: r.token, name: r.collector.name }));
});
$("#admLogin").addEventListener("submit", (e) => {
  e.preventDefault();
  submitForm(e.target, "admin/login", "admin", (r) => auth.set("admin", { token: r.token, name: "Admin" }));
});
$$(".auth-form .input").forEach((i) => i.addEventListener("input", () => i.classList.remove("error")));

/* collector: type your ID and your details appear */
let cardTimer = null;
$("#colId").addEventListener("input", (e) => {
  const v = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  e.target.value = v;
  clearTimeout(cardTimer);
  const card = $("#colCard");
  if (!/^[A-Z]{2}-\d{3,}$/.test(v)) { card.hidden = true; return; }
  cardTimer = setTimeout(async () => {
    try {
      const c = await api(`collectors/${encodeURIComponent(v)}/card`);
      card.className = "col-card ok";
      card.innerHTML = `<span class="avatar">${esc(c.name.split(" ").map((p) => p[0]).join(""))}</span><div><b>${esc(c.name)}</b><small>${esc(c.vehicle)} · ${esc(c.hub)} hub · ★ ${c.rating}</small></div>${icon("circle-check-big")}`;
    } catch (err) {
      card.className = "col-card bad";
      card.innerHTML = `${icon("triangle-alert")}<div><b>ID not found</b><small>${esc(err.message)}</small></div>`;
    }
    card.hidden = false;
  }, 250);
});

pickRole(["customer", "collector", "admin"].includes(params.get("role")) ? params.get("role") : "customer");
if (params.get("signup") === "1") $(".seg-tabs [data-mode=signup]").click();
