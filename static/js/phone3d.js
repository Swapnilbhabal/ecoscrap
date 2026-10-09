/* =====================================================================
   phone3d.js - "What's inside the phone in your drawer"
   A phone made of six layers. Scrolling through the section pulls the
   layers apart (an exploded view) and labels each material.
   ===================================================================== */
import { THREE, supportsWebGL, reducedMotion, makeRenderer, environment, fit, whenVisible,
  M, RoundedBoxGeometry, screenTexture, pcbTexture, batteryTexture } from "./three-kit.js";

const section = document.getElementById("inside");
const canvas = document.getElementById("phone3d");


const LAYERS = [
  { key: "glass", name: "Cover glass", what: "Toughened glass + indium tin oxide touch layer" },
  { key: "display", name: "OLED display", what: "Indium, rare earths, organic layers" },
  { key: "frame", name: "Frame", what: "Aluminium, melted down and reused" },
  { key: "board", name: "Mainboard + cameras", what: "Copper, gold, silver, palladium, lead solder" },
  { key: "battery", name: "Battery", what: "Lithium, cobalt, nickel. Fire risk if crushed" },
  { key: "back", name: "Back cover", what: "Glass or plastic with flame retardants" },
];

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

function buildPhone() {
  const W = 1.5, H = 3.1;
  const phone = new THREE.Group();
  const layers = [];

  // 0 cover glass
  const glass = new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.03, 4, 0.2), M.glass());
  // 1 display
  const scr = screenTexture();
  const display = new THREE.Group();
  display.add(new THREE.Mesh(new RoundedBoxGeometry(W - 0.06, H - 0.06, 0.03, 4, 0.18), M.black()));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.14, H - 0.14),
    new THREE.MeshStandardMaterial({ map: scr, emissive: 0xffffff, emissiveMap: scr, emissiveIntensity: 0.9 }));
  face.position.z = 0.017; display.add(face);
  // 2 frame (rounded rectangle with a hole)
  const outer = roundedRectShape(W, H, 0.22);
  outer.holes.push(roundedRectShape(W - 0.16, H - 0.16, 0.16));
  const frameGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 3, curveSegments: 18 });
  frameGeo.translate(0, 0, -0.06);
  const frame = new THREE.Mesh(frameGeo, M.alu());
  // 3 mainboard (top part) with chips and cameras
  const board = new THREE.Group();
  const pcb = pcbTexture(512, 512, 5);
  const boardMesh = new THREE.Mesh(new RoundedBoxGeometry(W - 0.22, 1.25, 0.03, 2, 0.05),
    [M.plastic(0x0f4a37), M.plastic(0x0f4a37), M.plastic(0x0f4a37), M.plastic(0x0f4a37),
      new THREE.MeshStandardMaterial({ map: pcb, roughness: 0.45, metalness: 0.2 }), M.plastic(0x0f4a37)]);
  boardMesh.position.y = 0.82; board.add(boardMesh);
  [[0.2, 0.95, 0.42, 0.42], [0.35, 0.45, 0.3, 0.22], [-0.05, 0.42, 0.2, 0.2]].forEach(([x, y, w, h]) => {
    const ic = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.05, 2, 0.015), M.black());
    ic.position.set(x, y, 0.035); board.add(ic);
  });
  const shield = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.04, 2, 0.02), M.alu());
  shield.position.set(0.25, 1.3, 0.035); board.add(shield);
  [[-0.38, 1.18], [-0.38, 0.86], [-0.12, 1.02]].forEach(([x, y]) => {
    const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 32), M.black());
    cam.rotation.x = Math.PI / 2; cam.position.set(x, y, -0.04); board.add(cam);
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 8, 32), M.gold());
    ringM.position.set(x, y, -0.09); board.add(ringM);
  });
  // 4 battery (lower part)
  const bt = batteryTexture();
  const battery = new THREE.Mesh(new RoundedBoxGeometry(W - 0.3, 1.55, 0.09, 3, 0.05),
    [M.alu(), M.alu(), M.alu(), M.alu(), new THREE.MeshStandardMaterial({ map: bt, roughness: 0.4, metalness: 0.2 }), M.alu()]);
  battery.position.y = -0.55;
  // 5 back cover with camera bump
  const back = new THREE.Group();
  back.add(new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.04, 4, 0.2), M.body()));
  const bump = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.62, 0.05, 3, 0.12), M.body());
  bump.position.set(-0.32, 1.06, -0.04); back.add(bump);

  [glass, display, frame, board, battery, back].forEach((obj, i) => {
    const holder = new THREE.Group();
    holder.add(obj);
    // closed stack positions along z (front of phone faces +z)
    holder.userData.z0 = [0.09, 0.06, 0, -0.02, -0.03, -0.09][i];
    holder.userData.spread = [2.1, 1.25, 0.45, -0.35, -1.15, -2.0][i];
    holder.position.z = holder.userData.z0;
    // anchor for the label: right edge of the layer
    holder.userData.anchor = new THREE.Vector3(W / 2, [1.1, 0.4, -1.2, 1.0, -0.5, -0.9][i], 0);
    phone.add(holder);
    layers.push(holder);
  });
  return { phone, layers };
}

function start() {
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  scene.environment = environment(renderer);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 13);
  const key = new THREE.DirectionalLight(0xfff0e0, 2); key.position.set(3, 6, 8);
  const rim = new THREE.DirectionalLight(0x7be0a5, 1.2); rim.position.set(-5, -3, -6);
  scene.add(key, rim, new THREE.AmbientLight(0x446655, 0.5));

  const { phone, layers } = buildPhone();
  const pivot = new THREE.Group();
  pivot.add(phone);
  scene.add(pivot);

  /* labels */
  const labelBox = document.getElementById("phoneLabels");
  labelBox.innerHTML = LAYERS.map((l) => `<div class="plabel" data-k="${l.key}"><i></i><div><b>${l.name}</b><span>${l.what}</span></div></div>`).join("");
  const labelEls = [...labelBox.children];
  const steps = [...document.querySelectorAll("#insideSteps li")];
  const v = new THREE.Vector3();

  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

  function progress() {
    const r = section.getBoundingClientRect();
    return clamp(-r.top / (r.height - innerHeight));
  }

  let running = false, smooth = -1;
  function frame(now) {
    if (!running) return;
    const t = now / 1000;
    fit(renderer, camera, canvas);
    const portrait = canvas.clientWidth < 860;
    const p = progress();
    smooth = smooth < 0 ? p : smooth + (p - smooth) * 0.12;  // jump straight there on the first frame
    const e = ease(clamp((smooth - 0.12) / 0.55));

    pivot.position.set(portrait ? -0.35 : 1.45, portrait ? -1.45 : -0.35, 0);
    pivot.scale.setScalar(portrait ? 0.6 : 0.9);
    // tilt the phone so the layers fan out diagonally
    phone.rotation.set(-0.95 + e * 0.15, 0.35 + Math.sin(t * 0.3) * 0.05, -0.62 + e * 0.12 + smooth * 0.1);
    layers.forEach((L) => { L.position.z = L.userData.z0 + L.userData.spread * e; });

    renderer.render(scene, camera);

    // place labels next to each layer's right edge
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const show = clamp((smooth - 0.45) / 0.15);
    labelEls.forEach((el, i) => {
      v.copy(layers[i].userData.anchor);
      layers[i].localToWorld(v);
      v.project(camera);
      const x = Math.min((v.x * 0.5 + 0.5) * w, w - el.offsetWidth - 12), y = (-v.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y - 18)}px)`;
      el.style.opacity = show * (portrait ? 0.95 : 1);
    });
    const step = smooth < 0.2 ? 0 : smooth < 0.55 ? 1 : 2;
    steps.forEach((s, i) => s.classList.toggle("on", i === step));
    requestAnimationFrame(frame);
  }

  if (reducedMotion()) {
    // show the exploded view without animation
    const still = () => {
      fit(renderer, camera, canvas);
      const portrait = canvas.clientWidth < 860;
      pivot.position.set(portrait ? -0.35 : 1.45, portrait ? -1.45 : -0.35, 0);
      pivot.scale.setScalar(portrait ? 0.6 : 0.9);
      phone.rotation.set(-0.8, 0.35, -0.5);
      layers.forEach((L) => { L.position.z = L.userData.z0 + L.userData.spread; });
      renderer.render(scene, camera);
      labelEls.forEach((el, i) => {
        v.copy(layers[i].userData.anchor); layers[i].localToWorld(v); v.project(camera);
        el.style.transform = `translate(${(v.x * 0.5 + 0.5) * canvas.clientWidth}px, ${(-v.y * 0.5 + 0.5) * canvas.clientHeight - 18}px)`;
        el.style.opacity = 1;
      });
    };
    still(); addEventListener("resize", still);
    steps.forEach((s) => s.classList.add("on"));
  } else {
    whenVisible(canvas, (on) => {
      if (on && !running) { running = true; requestAnimationFrame(frame); }
      else if (!on) running = false;
    });
  }
}

// start once everything above is defined
if (section && canvas) {
  if (!supportsWebGL()) {
    canvas.hidden = true;
    document.getElementById("insideFallback").hidden = false;
  } else {
    start();
  }
}
