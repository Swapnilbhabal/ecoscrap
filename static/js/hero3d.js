/* =====================================================================
   hero3d.js - homepage hero scene
   Old devices float around a copper "recovery loop". Glowing particles
   (the recovered material) stream from each device into the loop.
   ===================================================================== */
import { THREE, supportsWebGL, reducedMotion, makeRenderer, environment, fit, whenVisible,
  M, phone, laptop, battery, chip, charger, dotTexture } from "./three-kit.js";

const canvas = document.getElementById("hero3d");

if (!canvas) {
  // not on this page
} else if (!supportsWebGL()) {
  document.documentElement.classList.add("no-webgl");
} else {
  start();
}

function start() {
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  scene.environment = environment(renderer);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0.2, 10.5);

  const key = new THREE.DirectionalLight(0xffe2c4, 2.2); key.position.set(4, 5, 6);
  const rim = new THREE.DirectionalLight(0x7be0a5, 1.4); rim.position.set(-6, -2, -4);
  scene.add(key, rim, new THREE.AmbientLight(0x335544, 0.6));

  const world = new THREE.Group();
  scene.add(world);

  /* ---- the recovery loop ---- */
  const loop = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.075, 40, 220), M.copper());
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.012, 12, 220), M.gold());
  const ring3 = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.008, 12, 220), M.gold());
  loop.add(ring, ring2, ring3);
  loop.rotation.set(1.15, 0.15, 0);
  world.add(loop);

  /* ---- devices orbiting the loop ---- */
  const devices = [
    { obj: phone(), pos: [-1.6, 1.25, 1.2], rot: [0.2, 0.5, -0.25], s: 1.15 },
    { obj: laptop(), pos: [2.3, -0.55, -1.6], rot: [0.35, -0.8, 0.08], s: 0.85 },
    { obj: battery(), pos: [-2.0, -1.35, 0.6], rot: [0.4, 0, 0.7], s: 1.1 },
    { obj: chip(), pos: [0.6, 1.95, -0.4], rot: [0.9, 0.3, 0.2], s: 0.95 },
    { obj: charger(), pos: [1.1, -1.85, 1.3], rot: [0.3, 0.6, 0.1], s: 0.9 },
  ];
  devices.forEach((d, i) => {
    d.obj.position.set(...d.pos);
    d.obj.rotation.set(...d.rot);
    d.obj.scale.setScalar(0.001);
    d.phase = i * 1.3;
    world.add(d.obj);
  });

  /* ---- particles: material flowing from devices into the loop ---- */
  const N = 900;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const seeds = Array.from({ length: N }, (_, i) => ({ d: i % devices.length, t: Math.random(), a: Math.random() * Math.PI * 2, sp: 0.12 + Math.random() * 0.18, j: (Math.random() - 0.5) * 0.5 }));
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const pmat = new THREE.PointsMaterial({ size: 0.07, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const flow = new THREE.Points(geo, pmat);
  world.add(flow);

  /* ---- ambient swirl hugging the ring ---- */
  const S = 1400;
  const sgeo = new THREE.BufferGeometry();
  const spos = new Float32Array(S * 3);
  for (let i = 0; i < S; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.random() * Math.PI * 2, r = 1.9 + Math.cos(v) * (0.2 + Math.random() * 0.25);
    spos[i * 3] = Math.cos(u) * r; spos[i * 3 + 1] = Math.sin(u) * r; spos[i * 3 + 2] = Math.sin(v) * 0.35;
  }
  sgeo.setAttribute("position", new THREE.BufferAttribute(spos, 3));
  const swirl = new THREE.Points(sgeo, new THREE.PointsMaterial({ size: 0.03, color: 0xe9b949, map: dotTexture(), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  loop.add(swirl);

  const copper = new THREE.Color(0xd2793a), gold = new THREE.Color(0xe9b949), mint = new THREE.Color(0x7be0a5);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), out = new THREE.Vector3(), c = new THREE.Color();

  function updateParticles(dt) {
    loop.updateMatrixWorld();
    for (let i = 0; i < N; i++) {
      const p = seeds[i];
      p.t += dt * p.sp;
      if (p.t > 1) { p.t -= 1; p.a = Math.random() * Math.PI * 2; }
      const dev = devices[p.d].obj;
      tmpA.copy(dev.position);                                           // start: the device
      tmpC.set(Math.cos(p.a) * 1.9, Math.sin(p.a) * 1.9, 0).applyMatrix4(loop.matrix); // end: a point on the loop
      tmpB.copy(tmpA).lerp(tmpC, 0.5); tmpB.y += 0.9 + p.j; tmpB.z += 0.6;   // control point: arc upwards
      const t = p.t, it = 1 - t;
      out.set(it * it * tmpA.x + 2 * it * t * tmpB.x + t * t * tmpC.x,
        it * it * tmpA.y + 2 * it * t * tmpB.y + t * t * tmpC.y,
        it * it * tmpA.z + 2 * it * t * tmpB.z + t * t * tmpC.z);
      pos.set([out.x, out.y, out.z], i * 3);
      c.copy(copper).lerp(t < 0.6 ? gold : mint, t < 0.6 ? t / 0.6 : (t - 0.6) / 0.4);
      const fade = Math.sin(Math.PI * t);
      col.set([c.r * fade, c.g * fade, c.b * fade], i * 3);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  /* ---- layout: right side on desktop, top on mobile ---- */
  function layout() {
    const portrait = canvas.clientWidth < 860;
    world.position.set(portrait ? 0 : 2.55, portrait ? -0.1 : 0.05, 0);
    world.scale.setScalar(portrait ? 0.95 : 1);
  }

  /* ---- pointer parallax ---- */
  const target = { x: 0, y: 0 };
  addEventListener("pointermove", (e) => {
    target.x = (e.clientX / innerWidth - 0.5) * 2;
    target.y = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  /* ---- intro: the one orchestrated moment ---- */
  const t0 = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3);

  let running = false, last = performance.now();
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const time = (now - t0) / 1000;
    if (fit(renderer, camera, canvas)) layout();

    devices.forEach((d, i) => {
      const k = ease(Math.min(1, Math.max(0, (time - 0.15 * i) / 1.3)));
      d.obj.scale.setScalar(d.s * k);
      d.obj.position.y = d.pos[1] + Math.sin(time * 0.8 + d.phase) * 0.12;
      d.obj.rotation.y = d.rot[1] + time * 0.18 * (i % 2 ? -1 : 1);
    });
    const ringIn = ease(Math.min(1, time / 1.6));
    loop.scale.setScalar(0.6 + 0.4 * ringIn);
    loop.rotation.z = time * 0.12;
    swirl.rotation.z = -time * 0.25;
    pmat.opacity = Math.min(1, Math.max(0, time - 0.8));
    updateParticles(dt);

    world.rotation.y += (target.x * 0.22 - world.rotation.y) * 0.04;
    world.rotation.x += (target.y * 0.1 - world.rotation.x) * 0.04;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  if (reducedMotion()) {
    // one still frame, fully assembled
    fit(renderer, camera, canvas); layout();
    devices.forEach((d) => d.obj.scale.setScalar(d.s));
    for (let k = 0; k < 40; k++) updateParticles(0.05);
    pmat.opacity = 1;
    renderer.render(scene, camera);
    addEventListener("resize", () => { fit(renderer, camera, canvas); layout(); renderer.render(scene, camera); });
  } else {
    whenVisible(canvas, (on) => {
      if (on && !running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
      else if (!on) running = false;
    });
  }
}
