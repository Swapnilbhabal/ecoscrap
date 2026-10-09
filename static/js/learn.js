/* Learn page: video control, animated numbers, two live canvas scenes, phone checklist demo, CO2 slider. */

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- hero video ---------- */
const video = $("#heroVideo"), vBtn = $("#videoToggle");
function setVideo(play) {
  if (!video) return;
  play ? video.play().catch(() => {}) : video.pause();
  vBtn.textContent = play ? "Pause animation" : "Play animation";
  vBtn.setAttribute("aria-pressed", String(!play));
}
if (reduce) setVideo(false);
vBtn?.addEventListener("click", () => setVideo(video.paused));

/* ---------- run something once when it scrolls into view ---------- */
function onView(el, fn, threshold = 0.35) {
  if (!el) return;
  const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { io.disconnect(); fn(); } }, { threshold });
  io.observe(el);
}

/* per-day counter + bars */
onView($(".per-day"), () => {
  const el = $("[data-count]"), target = +el.dataset.count;
  if (reduce) { el.textContent = fmt.num(target); return; }
  const t0 = performance.now();
  const tick = (now) => { const p = Math.min(1, (now - t0) / 1500); el.textContent = fmt.num(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
onView($(".bars"), () => $(".bars").classList.add("in"));
$("#truckTrack").innerHTML = Array.from({ length: 36 }, () => icon("truck")).join("");

/* ---------- canvas helpers ---------- */
function loop(canvas, draw) {
  if (!canvas) return;
  const g = canvas.getContext("2d");
  let on = false, t0 = performance.now();
  const frame = (now) => { if (!on) return; draw(g, (now - t0) / 1000); requestAnimationFrame(frame); };
  if (reduce) { draw(g, 4); return; }
  new IntersectionObserver((e) => {
    const vis = e[0].isIntersecting;
    if (vis && !on) { on = true; requestAnimationFrame(frame); } else if (!vis) on = false;
  }).observe(canvas);
}
const rand = (a, b) => a + Math.random() * (b - a);
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

/* ---------- scene 1: informal yard (open burning) ---------- */
(function sceneBad() {
  const W = 640, H = 380;
  const pile = Array.from({ length: 46 }, (_, i) => ({ x: 170 + rand(0, 300), y: 300 - rand(0, 70) * Math.sin(((i % 23) / 23) * Math.PI), w: rand(20, 46), h: rand(10, 26), a: rand(-0.8, 0.8), c: ["#2a2f2c", "#1f2422", "#3a3f3a", "#2b6b8a", "#4a3a2a"][i % 5] }));
  const fire = [], smoke = [], embers = [];
  let last = 0;
  loop($("#sceneBad"), (g, t) => {
    const dt = Math.min(0.05, t - last); last = t;
    // dusky sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#5b4f45"); sky.addColorStop(0.55, "#8a6a4a"); sky.addColorStop(1, "#3a3129");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // distant shacks
    g.fillStyle = "#3d342c";
    [[20, 230, 90, 60], [100, 245, 70, 45], [480, 235, 80, 55], [560, 250, 90, 40]].forEach(([x, y, w, h]) => { g.fillRect(x, y, w, h); g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x + w / 2, y - 18); g.lineTo(x + w + 6, y); g.fill(); });
    // ground
    g.fillStyle = "#2a231d"; g.fillRect(0, 290, W, H - 290);
    g.fillStyle = "rgba(0,0,0,.25)"; for (let i = 0; i < 30; i++) g.fillRect((i * 97) % W, 300 + ((i * 53) % 70), 30, 3);
    // pile of devices
    pile.forEach((p) => { g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); });
    // spawn
    for (let i = 0; i < 6; i++) fire.push({ x: rand(250, 390), y: 280, vx: rand(-12, 12), vy: rand(-70, -30), life: 1, s: rand(10, 22) });
    if (Math.random() < 0.6) smoke.push({ x: rand(270, 370), y: 230, vx: rand(4, 18), vy: rand(-34, -20), life: 1, s: rand(18, 30) });
    if (Math.random() < 0.3) embers.push({ x: rand(270, 370), y: 260, vx: rand(-20, 20), vy: rand(-90, -50), life: 1 });
    // smoke (behind fire)
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i]; s.x += s.vx * dt; s.y += s.vy * dt; s.s += 22 * dt; s.life -= dt * 0.18;
      if (s.life <= 0) { smoke.splice(i, 1); continue; }
      g.fillStyle = `rgba(28,26,24,${0.5 * s.life})`; g.beginPath(); g.arc(s.x, s.y, s.s, 0, 7); g.fill();
    }
    // fire
    g.globalCompositeOperation = "lighter";
    for (let i = fire.length - 1; i >= 0; i--) {
      const f = fire[i]; f.x += f.vx * dt; f.y += f.vy * dt; f.life -= dt * 1.6; f.s *= 0.985;
      if (f.life <= 0) { fire.splice(i, 1); continue; }
      const gr = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.s);
      gr.addColorStop(0, `rgba(255,220,120,${0.55 * f.life})`); gr.addColorStop(0.5, `rgba(240,110,30,${0.35 * f.life})`); gr.addColorStop(1, "rgba(200,40,0,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(f.x, f.y, f.s, 0, 7); g.fill();
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i]; e.x += e.vx * dt; e.y += e.vy * dt; e.life -= dt * 0.7;
      if (e.life <= 0) { embers.splice(i, 1); continue; }
      g.fillStyle = `rgba(255,180,60,${e.life})`; g.fillRect(e.x, e.y, 2, 2);
    }
    g.globalCompositeOperation = "source-over";
    // label
    g.fillStyle = "rgba(0,0,0,.45)"; rr(g, 16, 16, 196, 30, 15); g.fill();
    g.fillStyle = "#ffd9bf"; g.font = "600 14px Instrument, sans-serif"; g.fillText("Open burning for copper", 30, 36);
  });
})();

/* ---------- scene 2: authorised dismantler (sorting line) ---------- */
(function sceneGood() {
  const W = 640, H = 380;
  const BINS = [
    { x: 380, label: "Metals", c: "#d2793a" }, { x: 452, label: "Glass", c: "#7cc4ff" },
    { x: 524, label: "Plastic", c: "#9aa8a2" }, { x: 596, label: "Battery", c: "#e9b949" },
  ];
  const KINDS = [
    { w: 22, h: 40, c: "#18241f", bin: 0 }, { w: 54, h: 8, c: "#b9c4c0", bin: 0 }, { w: 30, h: 22, c: "#bfe7ff", bin: 1 },
    { w: 34, h: 20, c: "#c7d2cc", bin: 2 }, { w: 18, h: 26, c: "#e9b949", bin: 3 }, { w: 40, h: 26, c: "#0f4a37", bin: 0 },
  ];
  const items = [];
  let spawn = 0, last = 0, kg = 0;
  loop($("#sceneGood"), (g, t) => {
    const dt = Math.min(0.05, t - last); last = t;
    // clean interior
    g.fillStyle = "#e9f1ec"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#dbe6df"; for (let x = 0; x < W; x += 80) g.fillRect(x, 0, 2, 200);
    g.fillStyle = "#cfdcd4"; g.fillRect(0, 200, W, 4);
    // windows with daylight
    g.fillStyle = "#cfe7f5"; [60, 200, 340, 480].forEach((x) => { rr(g, x, 34, 90, 60, 6); g.fill(); });
    // conveyor
    const beltY = 220;
    g.fillStyle = "#24473a"; rr(g, 20, beltY, 330, 18, 9); g.fill();
    g.fillStyle = "#2f5a49"; const off = (t * 60) % 24;
    for (let x = 20 - 24 + off; x < 350; x += 24) g.fillRect(Math.max(20, x), beltY + 3, 10, 12);
    g.fillStyle = "#0e3b2e"; [32, 338].forEach((x) => { g.beginPath(); g.arc(x, beltY + 9, 11, 0, 7); g.fill(); });
    g.fillRect(60, beltY + 18, 8, 80); g.fillRect(300, beltY + 18, 8, 80);
    // sorter head
    g.fillStyle = "#0e3b2e"; rr(g, 330, 150, 60, 30, 6); g.fill();
    g.fillStyle = "#7be0a5"; g.beginPath(); g.arc(380, 165, 4 + Math.sin(t * 6) * 1.5, 0, 7); g.fill();
    // bins
    BINS.forEach((b) => {
      g.fillStyle = b.c; rr(g, b.x - 30, 290, 60, 56, 6); g.fill();
      g.fillStyle = "rgba(0,0,0,.15)"; g.fillRect(b.x - 30, 290, 60, 8);
      g.fillStyle = "#10201a"; g.font = "600 12px Instrument, sans-serif"; g.textAlign = "center"; g.fillText(b.label, b.x, 364); g.textAlign = "left";
    });
    // items
    spawn -= dt;
    if (spawn <= 0) { const k = KINDS[Math.floor(Math.random() * KINDS.length)]; items.push({ ...k, x: 10, y: beltY - k.h / 2, phase: "belt", t: 0 }); spawn = 0.9; }
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.phase === "belt") {
        it.x += 60 * dt;
        if (it.x >= 350) { it.phase = "fly"; it.t = 0; it.sx = it.x; it.sy = it.y; it.tx = BINS[it.bin].x; }
      } else {
        it.t += dt * 1.4;
        const p = Math.min(1, it.t);
        it.x = it.sx + (it.tx - it.sx) * p;
        it.y = it.sy + (300 - it.sy) * p - Math.sin(p * Math.PI) * 50;
        if (p >= 1) { items.splice(i, 1); kg += 0.4; continue; }
      }
      g.save(); g.translate(it.x, it.y); g.fillStyle = it.c; rr(g, -it.w / 2, -it.h / 2, it.w, it.h, 3); g.fill(); g.restore();
    }
    // weighing display
    g.fillStyle = "#0e3b2e"; rr(g, W - 186, 16, 170, 52, 10); g.fill();
    g.fillStyle = "#c7d2cc"; g.font = "500 11px Instrument, sans-serif"; g.fillText("Recorded today", W - 172, 36);
    g.fillStyle = "#7be0a5"; g.font = "600 20px 'JB Mono', monospace"; g.fillText(kg.toFixed(1).padStart(6, " ") + " kg", W - 172, 58);
    g.fillStyle = "rgba(14,59,46,.85)"; rr(g, 16, 16, 196, 30, 15); g.fill();
    g.fillStyle = "#e9f1ec"; g.font = "600 14px Instrument, sans-serif"; g.fillText("Sorted, weighed, recorded", 30, 36);
  });
})();

/* ---------- phone checklist demo ---------- */
(function phoneDemo() {
  const steps = $$("#pmScreen .pm-step"), items = $$("#pmSteps li");
  if (!steps.length) return;
  let k = 0, timer = null;
  const show = (i) => {
    steps.forEach((s, j) => s.classList.toggle("on", j === i));
    items.forEach((s, j) => s.classList.toggle("on", j === i));
  };
  const start = () => { if (reduce || timer) return; timer = setInterval(() => { k = (k + 1) % steps.length; show(k); }, 3200); };
  items.forEach((li, i) => li.addEventListener("click", () => { k = i; show(i); clearInterval(timer); timer = null; start(); }));
  onView($(".phone-mock"), start, 0.2);
})();

/* ---------- CO2 slider + factor table ---------- */
api("catalog").then((c) => {
  $("#factorTable tbody").innerHTML = Object.values(c.categories).map((it) =>
    `<tr><td>${esc(it.name)}</td><td>${fmt.num(it.kg, 1)} kg</td><td>${fmt.num(it.co2_factor, 1)} kg CO₂e / kg</td></tr>`).join("");
  const f = c.categories.laptop.co2_factor, slider = $("#co2Kg");
  const out = () => {
    const kg = +slider.value, co2 = kg * f;
    $("#co2Out").innerHTML = `<b>${fmt.num(kg, 1)} kg</b> × ${f} = <b>${fmt.num(co2, 1)} kg CO₂e</b> avoided, about <b>${fmt.num(co2 / c.car_kg_co2_per_km)} km</b> of car driving.`;
  };
  slider.addEventListener("input", out); out();
}).catch(() => {});
