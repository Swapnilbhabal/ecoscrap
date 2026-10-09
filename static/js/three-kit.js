/* =====================================================================
   three-kit.js - shared 3D building blocks (three.js)
   Devices are built from simple shapes plus textures drawn on a canvas,
   so there are no heavy 3D model files to download.
   ===================================================================== */
import * as THREE from "three";
import { RoundedBoxGeometry } from "/vendor/addons/RoundedBoxGeometry.js";
import { RoomEnvironment } from "/vendor/addons/RoomEnvironment.js";

export { THREE };

export function supportsWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch { return false; }
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  return r;
}

export function environment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return tex;
}

/* Resize renderer + camera to the canvas' CSS size. */
export function fit(renderer, camera, canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return false;
  const need = canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio());
  if (need) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  return true;
}

/* Only animate while the canvas is on screen and the tab is visible. */
export function whenVisible(el, onChange) {
  let visible = false;
  const io = new IntersectionObserver((e) => { visible = e[0].isIntersecting; onChange(visible && !document.hidden); }, { rootMargin: "100px" });
  io.observe(el);
  document.addEventListener("visibilitychange", () => onChange(visible && !document.hidden));
}

/* ------------------------------------------------------------------ */
/* Materials                                                            */
/* ------------------------------------------------------------------ */
export const M = {
  body: () => new THREE.MeshPhysicalMaterial({ color: 0x18241f, metalness: 0.75, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15 }),
  alu: () => new THREE.MeshStandardMaterial({ color: 0xb9c4c0, metalness: 1, roughness: 0.32 }),
  copper: () => new THREE.MeshStandardMaterial({ color: 0xd2793a, metalness: 1, roughness: 0.26, emissive: 0x3a1806, emissiveIntensity: 0.4 }),
  gold: () => new THREE.MeshStandardMaterial({ color: 0xe9b949, metalness: 1, roughness: 0.22 }),
  black: () => new THREE.MeshStandardMaterial({ color: 0x0c0f0e, metalness: 0.3, roughness: 0.5 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0xbfe7ff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.28, clearcoat: 1, side: THREE.DoubleSide }),
  plastic: (c = 0xe8ece9) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.05, roughness: 0.55 }),
};

/* ------------------------------------------------------------------ */
/* Canvas textures                                                      */
/* ------------------------------------------------------------------ */
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

const FONT = '"Instrument", system-ui, sans-serif';
const DISPLAY = '"Bricolage", system-ui, sans-serif';

/* Phone screen: the EcoScrap live-tracking screen. */
export function screenTexture() {
  return canvasTex(512, 1056, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0e3b2e"); bg.addColorStop(1, "#061a13");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // map area
    g.fillStyle = "#14382c"; rr(g, 24, 120, w - 48, 560, 34); g.fill();
    g.save(); rr(g, 24, 120, w - 48, 560, 34); g.clip();
    g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 2;
    for (let x = 24; x < w; x += 42) { g.beginPath(); g.moveTo(x, 120); g.lineTo(x + 60, 680); g.stroke(); }
    for (let y = 120; y < 680; y += 42) { g.beginPath(); g.moveTo(24, y); g.lineTo(w, y - 20); g.stroke(); }
    g.strokeStyle = "rgba(255,255,255,.16)"; g.lineWidth = 16; g.lineCap = "round";
    g.beginPath(); g.moveTo(70, 640); g.bezierCurveTo(140, 480, 260, 560, 300, 380); g.bezierCurveTo(330, 260, 420, 260, 430, 190); g.stroke();
    g.strokeStyle = "#d2793a"; g.lineWidth = 9;
    g.beginPath(); g.moveTo(70, 640); g.bezierCurveTo(140, 480, 260, 560, 300, 380); g.stroke();
    g.restore();
    g.fillStyle = "#d2793a"; g.beginPath(); g.arc(300, 380, 20, 0, 7); g.fill();
    g.strokeStyle = "#fff"; g.lineWidth = 6; g.stroke();
    g.fillStyle = "#e9b949"; g.beginPath(); g.arc(430, 190, 16, 0, 7); g.fill();
    // status bar + title
    g.fillStyle = "rgba(255,255,255,.7)"; g.font = `600 26px ${FONT}`; g.fillText("9:41", 40, 60);
    g.fillRect(w - 92, 42, 50, 20);
    g.fillStyle = "#fff"; g.font = `700 40px ${DISPLAY}`; g.fillText("EcoScrap", 40, 104);
    // bottom card
    g.fillStyle = "#fbfcfa"; rr(g, 24, 712, w - 48, 300, 34); g.fill();
    g.fillStyle = "#10201a"; g.font = `700 52px ${DISPLAY}`; g.fillText("4 min away", 56, 790);
    g.fillStyle = "#6b7f76"; g.font = `500 26px ${FONT}`; g.fillText("Rahul is on an e-bike", 56, 834);
    g.fillStyle = "#e1eae3"; rr(g, 56, 870, w - 112, 14, 7); g.fill();
    g.fillStyle = "#d2793a"; rr(g, 56, 870, (w - 112) * 0.68, 14, 7); g.fill();
    g.fillStyle = "#0e3b2e"; rr(g, 56, 912, w - 112, 70, 35); g.fill();
    g.fillStyle = "#fff"; g.font = `600 28px ${FONT}`; g.fillText("Handover code  4 8 2 7", 92, 957);
  });
}

/* Circuit board with copper traces, gold pads and silkscreen labels. */
export function pcbTexture(w = 1024, h = 1024, seed = 3) {
  return canvasTex(w, h, (g) => {
    let s = seed; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    g.fillStyle = "#0f4a37"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(210,121,58,.9)"; g.lineCap = "round"; g.lineJoin = "round";
    for (let i = 0; i < 70; i++) {
      g.lineWidth = 3 + rnd() * 5;
      let x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        const len = 40 + rnd() * 180, dir = Math.floor(rnd() * 4);
        if (rnd() < .4) { x += (dir % 2 ? 1 : -1) * len * .7; y += (dir < 2 ? 1 : -1) * len * .7; }
        else if (dir % 2) x += (dir === 1 ? 1 : -1) * len; else y += (dir === 0 ? 1 : -1) * len;
        g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = "#e9b949"; g.beginPath(); g.arc(x, y, 6 + rnd() * 5, 0, 7); g.fill();
    }
    g.fillStyle = "rgba(255,255,255,.75)"; g.font = `600 22px ui-monospace, monospace`;
    ["U1", "C12", "R7", "L3", "ES-01", "Q4", "J2"].forEach((t) => g.fillText(t, rnd() * (w - 80), 30 + rnd() * (h - 40)));
  });
}

export function batteryTexture() {
  return canvasTex(512, 768, (g, w, h) => {
    g.fillStyle = "#1b2420"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#e9b949"; g.fillRect(0, 0, w, 30);
    g.fillStyle = "#fff"; g.font = `700 64px ${DISPLAY}`; g.fillText("Li-ion", 40, 160);
    g.font = `500 30px ${FONT}`; g.fillStyle = "#c7d2cc";
    g.fillText("4500 mAh · 3.85 V", 40, 210);
    g.fillText("Do not crush or burn", 40, 260);
    g.strokeStyle = "#7be0a5"; g.lineWidth = 10;
    g.beginPath(); g.arc(w / 2, 470, 110, 0.3, 5.8); g.stroke();
    g.fillStyle = "#7be0a5"; g.beginPath(); g.moveTo(w / 2 + 120, 420); g.lineTo(w / 2 + 70, 480); g.lineTo(w / 2 + 160, 485); g.fill();
    g.fillStyle = "#6b7f76"; g.font = `500 24px ${FONT}`; g.fillText("Recycle at an authorised facility", 40, h - 60);
  });
}

export function laptopTexture() {
  return canvasTex(1024, 640, (g, w, h) => {
    g.fillStyle = "#0a2a1f"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#fff"; g.font = `700 54px ${DISPLAY}`; g.fillText("Rate card", 60, 100);
    const rows = [["Mobile phone", "₹350"], ["Laptop / desktop", "₹1,500"], ["Tablet", "₹600"], ["TV / monitor", "₹500"], ["Printer", "₹250"]];
    rows.forEach(([a, b], i) => {
      const y = 180 + i * 84;
      g.fillStyle = i % 2 ? "rgba(255,255,255,.03)" : "rgba(255,255,255,.07)"; g.fillRect(50, y - 50, w - 100, 74);
      g.fillStyle = "#c7d2cc"; g.font = `500 34px ${FONT}`; g.fillText(a, 80, y);
      g.fillStyle = "#e8955a"; g.font = `700 38px ${DISPLAY}`; g.fillText(b, w - 260, y);
    });
  });
}

/* Soft round sprite for particles. */
export function dotTexture() {
  return canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(.35, "rgba(255,255,255,.6)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  });
}

/* ------------------------------------------------------------------ */
/* Device models                                                        */
/* ------------------------------------------------------------------ */
export function phone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.78, 1.6, 0.09, 4, 0.11), M.body());
  const scr = screenTexture();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.71, 1.5),
    new THREE.MeshStandardMaterial({ map: scr, emissive: 0xffffff, emissiveMap: scr, emissiveIntensity: 0.85, roughness: 0.2 }));
  screen.position.z = 0.0465;
  const bump = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.3, 0.03, 3, 0.06), M.body());
  bump.position.set(-0.17, 0.56, -0.055);
  g.add(body, screen, bump);
  [[-0.24, 0.62], [-0.1, 0.62], [-0.17, 0.49]].forEach(([x, y]) => {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 24), M.black());
    lens.rotation.x = Math.PI / 2; lens.position.set(x, y, -0.075); g.add(lens);
  });
  return g;
}

export function laptop() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new RoundedBoxGeometry(2, 0.07, 1.36, 3, 0.04), M.alu());
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.62), M.black());
  keys.rotation.x = -Math.PI / 2; keys.position.set(0, 0.0365, -0.12);
  const hinge = new THREE.Group(); hinge.position.set(0, 0.035, -0.66);
  const lid = new THREE.Mesh(new RoundedBoxGeometry(2, 1.3, 0.05, 3, 0.04), M.alu());
  lid.position.y = 0.65;
  const tex = laptopTexture();
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 1.16),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.7 }));
  scr.position.set(0, 0.65, 0.026);
  hinge.add(lid, scr); hinge.rotation.x = -0.32;
  g.add(base, keys, hinge);
  return g;
}

export function battery() {
  const g = new THREE.Group();
  const tex = batteryTexture();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.66, 40),
    [new THREE.MeshStandardMaterial({ map: tex, metalness: 0.3, roughness: 0.4 }), M.alu(), M.alu()]);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 24), M.copper());
  cap.position.y = 0.36;
  g.add(body, cap);
  return g;
}

export function chip() {
  const g = new THREE.Group();
  const board = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.05, 0.8, 2, 0.02),
    [M.plastic(0x0f4a37), M.plastic(0x0f4a37), new THREE.MeshStandardMaterial({ map: pcbTexture(512, 512, 9), roughness: 0.45, metalness: 0.2 }), M.plastic(0x0f4a37), M.plastic(0x0f4a37), M.plastic(0x0f4a37)]);
  g.add(board);
  [[-0.2, 0.05, 0.36, 0.36], [0.28, -0.18, 0.22, 0.18], [0.3, 0.2, 0.16, 0.24]].forEach(([x, z, w, d]) => {
    const ic = new THREE.Mesh(new RoundedBoxGeometry(w, 0.06, d, 2, 0.01), M.black());
    ic.position.set(x, 0.055, z); g.add(ic);
    for (let i = 0; i < 5; i++) {
      const pinM = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.05), M.gold());
      pinM.position.set(x - w / 2 + (i + 0.5) * (w / 5), 0.03, z + d / 2 + 0.02); g.add(pinM);
    }
  });
  return g;
}

export function charger() {
  const g = new THREE.Group();
  const brick = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.36, 0.3, 4, 0.06), M.plastic(0xeef3ee));
  g.add(brick);
  [-0.07, 0.07].forEach((x) => {
    const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 12), M.copper());
    prong.position.set(x, 0.26, 0); g.add(prong);
  });
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.18, 0), new THREE.Vector3(0.1, -0.5, 0.2), new THREE.Vector3(-0.3, -0.7, 0.1),
    new THREE.Vector3(-0.4, -0.4, -0.2), new THREE.Vector3(-0.1, -0.3, -0.35), new THREE.Vector3(0.3, -0.62, -0.2)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.022, 10), M.plastic(0xeef3ee)));
  return g;
}

export { RoundedBoxGeometry };
