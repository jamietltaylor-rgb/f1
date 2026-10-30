// The 3D world: lights, sky, terrain, track, cars and camera.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { buildCar } from "./cars.js";
import { asphaltTexture, buildTerrain, gravelTexture, grassTexture, makeClouds, makeHills, makeSky, scatterTrees } from "./environment.js";

import { TRACK_WIDTH } from "./constants.js";
export { TRACK_WIDTH };

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const haze = new THREE.Color(0xd3e1ec);
  scene.background = haze;
  scene.fog = new THREE.Fog(haze, 3500, 26000);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 70000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 4;
  controls.maxDistance = 30000;
  controls.screenSpacePanning = false;
  let controlsActive = true;
  let beforeRender = null;

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x587a46, 1.15));
  const sunDir = new THREE.Vector3(-0.5, 0.55, 0.45).normalize();
  const sun = new THREE.DirectionalLight(0xfff1d8, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -150;
  sc.right = sc.top = 150;
  sc.near = 10;
  sc.far = 900;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  const sky = makeSky();
  scene.add(sky);
  const clouds = makeClouds();
  scene.add(clouds);
  const hills = makeHills();
  scene.add(hills);

  const world = new THREE.Group();
  scene.add(world);
  const trackGroup = new THREE.Group();
  const venueGroup = new THREE.Group();
  const treeGroup = new THREE.Group();
  const carGroup = new THREE.Group();
  world.add(trackGroup, venueGroup, treeGroup, carGroup);

  const grassTex = grassTexture();
  const asphaltTex = asphaltTexture();
  const gravelTex = gravelTexture();

  let track = null;
  const cars = new Map();
  let carScale = 1;

  // ---------- cars ----------
  const markerTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill();
    g.fillStyle = "#222";
    g.beginPath(); g.arc(32, 32, 20, 0, 7); g.fill();
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(32, 32, 14, 0, 7); g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  const blobTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,.35)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  blobMat.userData.shared = true;

  function textSprite(text, bg, fontPx, w, h, base, centreY) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(4, 6, w - 8, h - 12, 12);
    g.fill();
    g.fillStyle = "#fff";
    g.font = `700 ${fontPx}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    s.scale.set(base[0], base[1], 1);
    s.userData.base = base;
    s.center.set(0.5, centreY);
    s.renderOrder = 10;
    return s;
  }
  const labelSprite = (t) => textSprite(t, "rgba(16,18,20,.82)", 34, 160, 64, [0.06, 0.024], 0);
  const crashTag = (t, bg = "#d4140a") => {
    const s = textSprite(t, bg, 36, 256, 64, [0.1, 0.025], -1.25);
    s.visible = false;
    s.renderOrder = 11;
    return s;
  };

  function clearCars() {
    for (const c of cars.values()) carGroup.remove(c.root);
    cars.clear();
  }

  function setCars(list) {
    clearCars();
    for (const info of list) {
      const hex = parseInt(String(info.colour || "888888").replace("#", ""), 16) || 0x888888;
      const root = new THREE.Group();
      root.rotation.order = "YZX";
      const { group: model, wheels } = buildCar(hex);
      model.userData.carId = info.id;
      root.add(model);
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.2), blobMat);
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.05;
      root.add(blob);
      const label = labelSprite(info.label);
      label.position.y = 2.4;
      const tagYes = crashTag("CRASHED"), tagMaybe = crashTag("CRASH?"), tagStop = crashTag("STOPPED", "#c46b00");
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, color: hex, depthTest: false, transparent: true, sizeAttenuation: false }));
      marker.scale.set(0.02, 0.02, 1);
      marker.userData.base = [0.02, 0.02];
      marker.renderOrder = 9;
      marker.position.y = 1;
      root.add(label, tagYes, tagMaybe, tagStop, marker);
      root.userData.carId = info.id;
      carGroup.add(root);
      cars.set(info.id, { id: info.id, root, model, wheels, label, marker, tagYes, tagMaybe, tagStop, crash: 0, heading: 0, pitch: 0, y: 0, hasPlaced: false, last: new THREE.Vector3(), spin: 0, pos: new THREE.Vector3(), info });
    }
    applyCarScale();
  }

  function applyCarScale() {
    for (const c of cars.values()) {
      c.model.scale.setScalar(carScale);
      c.label.position.y = 2.2 * carScale + 0.4;
      c.tagYes.position.y = c.tagMaybe.position.y = c.tagStop.position.y = c.label.position.y;
    }
  }
  const setCarScale = (v) => { carScale = v; applyCarScale(); };

  function setCrashed(id, level) {
    const c = cars.get(id);
    if (!c) return;
    c.crash = level;
    c.tagYes.visible = level === 2;
    c.tagMaybe.visible = level === 1;
    c.tagStop.visible = level === 3;
  }

  /** dir is the direction of travel; dt is the frame time in seconds (used to smooth turning). */
  function placeCar(id, pos, dir, dt = 0.016) {
    const c = cars.get(id);
    if (!c) return;
    if (!pos) { c.root.visible = false; c.hasPlaced = false; return; }
    c.root.visible = true;
    const first = !c.hasPlaced;
    if (first) { c.y = pos[1]; c.last.set(pos[0], pos[1], pos[2]); }
    // height is low-passed so noisy altitude data doesn't make cars bounce
    c.y += (pos[1] - c.y) * (1 - Math.exp(-dt * 8));
    c.pos.set(pos[0], first ? pos[1] : c.y, pos[2]);
    c.root.position.copy(c.pos);
    if (dir) {
      const flat = Math.hypot(dir[0], dir[2]);
      if (flat > 0.002) {
        const want = -Math.atan2(dir[2], dir[0]);
        if (first) c.heading = want;
        let d = want - c.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        c.heading += d * (1 - Math.exp(-dt * 14));
        c.pitch += (Math.atan2(dir[1], flat) - c.pitch) * (1 - Math.exp(-dt * 8));
      }
    }
    c.root.rotation.set(0, c.heading, c.pitch);
    // spin the wheels by the distance rolled
    const moved = Math.min(40, c.pos.distanceTo(c.last));
    c.last.copy(c.pos);
    if (moved > 0 && !first) for (const w of c.wheels) w.spin.rotation.y -= (moved * (1 / carScale)) / w.R;
    c.hasPlaced = true;
  }

  // ---------- track ----------
  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
      if (o.material && !o.material.userData?.shared) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    g.clear();
  }

  function strip(a, b, material, { y0 = 0, dv = null, colours = null } = {}) {
    const n = a.length;
    const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos.set([a[i].x, a[i].y + y0, a[i].z, b[i].x, b[i].y + y0, b[i].z], i * 6);
      const v = dv ? dv[i] : i;
      uv.set([0, v, 1, v], i * 4);
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, (i + 1) * 2, i * 2 + 1, (i + 1) * 2, (i + 1) * 2 + 1, i * 2 + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    if (colours) {
      const col = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) { col.set(colours[i], i * 6); col.set(colours[i], i * 6 + 3); }
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = true;
    return m;
  }

  function openStrip(a, b, material, y0 = 0, colours = null) {
    // like strip() but not closed into a loop
    const n = a.length;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) pos.set([a[i].x, a[i].y + y0, a[i].z, b[i].x, b[i].y + y0, b[i].z], i * 6);
    const idx = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, (i + 1) * 2, i * 2 + 1, (i + 1) * 2, (i + 1) * 2 + 1, i * 2 + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (colours) {
      const col = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) { col.set(colours[i], i * 6); col.set(colours[i], i * 6 + 3); }
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    const uv = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) uv.set([0, i * 0.2, 1, i * 0.2], i * 4);
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = true;
    return m;
  }

  function checker() {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 32;
    const g = c.getContext("2d");
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) {
      g.fillStyle = (x + y) % 2 ? "#111" : "#fff";
      g.fillRect(x * 8, y * 8, 8, 8);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  const UNIT = new THREE.BoxGeometry(1, 1, 1);
  UNIT.userData.shared = true;
  function instancedBoxes(items, material) {
    const m = new THREE.InstancedMesh(UNIT, material, Math.max(1, items.length));
    m.count = items.length;
    const d = new THREE.Object3D();
    items.forEach((it, i) => {
      d.position.copy(it.pos);
      d.rotation.set(0, it.yaw, 0);
      d.scale.set(it.sx, it.sy, it.sz);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      if (it.color !== undefined) m.setColorAt(i, new THREE.Color(it.color));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /** points: Vector3[] along the middle of the road, in driving order (closed loop). */
  function setTrack(points) {
    disposeGroup(trackGroup);
    disposeGroup(venueGroup);
    disposeGroup(treeGroup);
    const curve = new THREE.CatmullRomCurve3(points, true, "centripetal");
    const length = curve.getLength();
    const n = Math.max(400, Math.min(2800, Math.round(length / 4)));
    const ds = length / n;
    const centre = [], T = [], Rt = [];
    for (let i = 0; i < n; i++) {
      centre.push(curve.getPointAt(i / n));
    }
    for (let i = 0; i < n; i++) {
      const t = centre[(i + 1) % n].clone().sub(centre[(i + n - 1) % n]);
      t.y = 0;
      t.normalize();
      T.push(t);
      Rt.push(new THREE.Vector3(-t.z, 0, t.x)); // right of travel
    }
    const half = TRACK_WIDTH / 2;
    const off = (i, o, y = 0) => centre[i].clone().addScaledVector(Rt[i], o).setY(centre[i].y + y);
    const range = (a, b, f) => Array.from({ length: n + 1 }, (_, i) => f(i % n)); // closed loop: first sample repeated at the end
    const dv = Array.from({ length: n + 1 }, (_, i) => (i * ds) / 18);

    // terrain first, so everything else can sit on it
    const terrain = buildTerrain(centre, grassTex);
    terrain.mesh.material.userData.shared = true;
    trackGroup.add(terrain.mesh);
    const far = new THREE.Mesh(new THREE.CircleGeometry(60000, 40), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
    far.material.map = grassTex.clone();
    far.material.map.repeat.set(60000 / 35, 60000 / 35);
    far.material.map.needsUpdate = true;
    far.rotation.x = -Math.PI / 2;
    far.position.y = terrain.edgeHeight - 0.3;
    far.receiveShadow = true;
    trackGroup.add(far);

    // road
    asphaltTex.repeat.set(1, 1);
    const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.9, side: THREE.DoubleSide });
    asphalt.userData.shared = true;
    trackGroup.add(strip(range(0, n, (i) => off(i, half)), range(0, n, (i) => off(i, -half)), asphalt, { dv }));
    const line = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.7, side: THREE.DoubleSide });
    trackGroup.add(strip(range(0, n, (i) => off(i, half - 0.25)), range(0, n, (i) => off(i, half - 0.8)), line, { y0: 0.04 }));
    trackGroup.add(strip(range(0, n, (i) => off(i, -(half - 0.8))), range(0, n, (i) => off(i, -(half - 0.25))), line, { y0: 0.04 }));
    // thin skirt so the road edge sits cleanly on the ground
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 1, side: THREE.DoubleSide });
    trackGroup.add(strip(range(0, n, (i) => off(i, half)), range(0, n, (i) => off(i, half, -0.6)), edgeMat, { y0: -0.02 }));
    trackGroup.add(strip(range(0, n, (i) => off(i, -half)), range(0, n, (i) => off(i, -half, -0.6)), edgeMat, { y0: -0.02 }));

    // where are the corners? (turning more than ~10 degrees over 60 m)
    const L = Math.max(2, Math.round(30 / ds));
    const corner = new Array(n).fill(0); // +1 turning right, -1 left, 0 straight
    for (let i = 0; i < n; i++) {
      const a = T[(i - L + n) % n], b = T[(i + L) % n];
      const ang = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
      if (ang > 0.17) corner[i] = Math.sign(b.clone().sub(a).dot(Rt[i])) || 0;
    }

    // kerbs on the inside of corners, gravel and tyre walls on the outside
    const redWhite = [[0.8, 0.12, 0.1], [0.95, 0.95, 0.95]];
    const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
    const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1, side: THREE.DoubleSide });
    gravelTex.repeat.set(1, 1);
    gravelMat.userData.shared = true;
    const walls = [];
    let i = 0;
    const pit = (k) => Math.min(k, n - k) * ds < 420;
    while (i < n) {
      if (!corner[i]) { i++; continue; }
      const dir = corner[i];
      let j = i;
      while (j < n && corner[j] === dir) j++;
      if (j - i > 4) {
        const idxs = Array.from({ length: j - i }, (_, k) => i + k);
        const insideSide = dir; // turning right => inside is to the right
        const outsideSide = -dir;
        const a = idxs.map((k) => off(k, insideSide * half));
        const b = idxs.map((k) => off(k, insideSide * (half + 1.6)));
        const cols = idxs.map((k) => redWhite[Math.floor((k * ds) / 4) % 2]);
        trackGroup.add(openStrip(insideSide > 0 ? a : b, insideSide > 0 ? b : a, kerbMat, 0.05, cols));
        // outside kerb at the exit is shorter; draw a plain one
        const ga = idxs.map((k) => off(k, outsideSide * (half + 1.6), -0.45));
        const gb = idxs.map((k) => off(k, outsideSide * (half + 16), -0.45));
        trackGroup.add(openStrip(outsideSide > 0 ? ga : gb, outsideSide > 0 ? gb : ga, gravelMat, 0, null));
        idxs.forEach((k, q) => {
          if (q % 2) return;
          const p = off(k, outsideSide * (half + 17.5), 0);
          const g = terrain.heightAt(p.x, p.z);
          walls.push({ pos: new THREE.Vector3(p.x, Math.max(g, p.y - 0.5) + 0.6, p.z), yaw: -Math.atan2(T[k].z, T[k].x), sx: ds * 2.1, sy: 1.2, sz: 1.0, color: Math.floor((k * ds) / 8) % 2 ? 0xd03a2e : 0xf0f0f0 });
        });
      }
      i = j;
    }
    // armco and sponsor boards along the straights
    const armco = [], boards = [];
    const boardCols = [0xe30613, 0x0b4ea2, 0xf2c200, 0x1d9a4a, 0xffffff, 0x111111];
    for (let k = 0; k < n; k += 2) {
      if (corner[k] || pit(k)) continue;
      for (const s of [-1, 1]) {
        const p = off(k, s * (half + 9.5), 0);
        const g = terrain.heightAt(p.x, p.z);
        armco.push({ pos: new THREE.Vector3(p.x, Math.max(g, p.y - 0.5) + 0.45, p.z), yaw: -Math.atan2(T[k].z, T[k].x), sx: ds * 2.1, sy: 0.55, sz: 0.25 });
        if ((k / 2) % 4 === 0) {
          const q = off(k, s * (half + 6), 0);
          const g2 = terrain.heightAt(q.x, q.z);
          boards.push({ pos: new THREE.Vector3(q.x, Math.max(g2, q.y - 0.5) + 0.7, q.z), yaw: -Math.atan2(T[k].z, T[k].x), sx: ds * 6, sy: 1.1, sz: 0.12, color: boardCols[Math.floor(k / 8) % boardCols.length] });
        }
      }
    }
    trackGroup.add(instancedBoxes(walls, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })));
    trackGroup.add(instancedBoxes(armco, new THREE.MeshStandardMaterial({ color: 0xb5b9bf, roughness: 0.5, metalness: 0.6 })));
    trackGroup.add(instancedBoxes(boards, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 })));

    // start/finish line
    const sl = new THREE.Mesh(new THREE.PlaneGeometry(3, TRACK_WIDTH - 1.6), new THREE.MeshBasicMaterial({ map: checker(), side: THREE.DoubleSide }));
    sl.rotation.set(-Math.PI / 2, -Math.atan2(T[0].z, T[0].x), 0, "YXZ");
    sl.position.copy(centre[0]).setY(centre[0].y + 0.07);
    trackGroup.add(sl);

    const box3 = new THREE.Box3().setFromPoints(centre);
    const sphere = box3.getBoundingSphere(new THREE.Sphere());
    track = { curve, length, box: box3, sphere, centre, T, R: Rt, ds, corner, groundY: terrain.edgeHeight, heightAt: terrain.heightAt };
    return track;
  }

  function addTrees(avoid) {
    disposeGroup(treeGroup);
    if (track) scatterTrees(treeGroup, track, track.heightAt, avoid);
  }

  function fitCamera() {
    if (!track) return;
    const { sphere } = track;
    const r = sphere.radius;
    controls.target.copy(sphere.center);
    camera.position.set(sphere.center.x - r * 0.25, sphere.center.y + r * 1.45, sphere.center.z + r * 1.3);
    controls.update();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const ray = new THREE.Raycaster();
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    const meshes = [];
    for (const c of cars.values()) if (c.root.visible) meshes.push(c.model);
    let hit = ray.intersectObjects(meshes, true)[0];
    if (!hit) {
      // far away the cars are tiny, so also accept a click on a marker dot
      let best = null, bd = 0.025;
      const v = new THREE.Vector3();
      for (const c of cars.values()) {
        if (!c.root.visible) continue;
        v.copy(c.pos).project(camera);
        const d = Math.hypot(v.x - ((clientX - r.left) / r.width) * 2 + 1, v.y + ((clientY - r.top) / r.height) * 2 - 1);
        if (v.z < 1 && d < bd) { bd = d; best = c.id; }
      }
      return best;
    }
    let o = hit.object;
    while (o && o.userData.carId === undefined) o = o.parent;
    return o ? o.userData.carId : null;
  }

  const q = (v) => Math.round(v);
  const tmp = new THREE.Vector3();
  let clock = performance.now();
  function render() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - clock) / 1000);
    clock = now;
    if (controlsActive) controls.update();
    if (beforeRender) beforeRender();
    sky.position.copy(camera.position);
    clouds.position.set(camera.position.x, 0, camera.position.z);
    clouds.rotation.y += dt * 0.0006;
    // the sun's shadow box follows what the camera is looking at
    const tx = q(controls.target.x), ty = q(controls.target.y), tz = q(controls.target.z);
    sun.target.position.set(tx, ty, tz);
    sun.position.set(tx + sunDir.x * 450, ty + sunDir.y * 450, tz + sunDir.z * 450);
    // sprites that keep a constant screen size would otherwise grow when the lens zooms in
    const lens = Math.tan((camera.fov * Math.PI) / 360) / Math.tan((50 * Math.PI) / 360);
    const pulse = 0.65 + 0.35 * Math.sin(now / 160);
    for (const c of cars.values()) {
      const d = camera.position.distanceTo(c.pos);
      c.label.visible = d < 1200 || c.crash > 0;
      c.marker.visible = d > 350;
      c.marker.material.opacity = Math.min(1, (d - 350) / 500);
      if (c.crash) (c.crash === 2 ? c.tagYes : c.crash === 1 ? c.tagMaybe : c.tagStop).material.opacity = pulse;
    }
    scene.traverse((o) => { if (o.isSprite && o.userData.base) o.scale.set(o.userData.base[0] * lens, o.userData.base[1] * lens, 1); });
    void tmp;
    renderer.render(scene, camera);
  }

  return {
    renderer, scene, camera, controls, cars, THREE,
    venueGroup, treeGroup, setCrashed, setTrack, addTrees, setCars, setCarScale, placeCar, fitCamera, pick, resize,
    getTrack: () => track,
    setControlsActive: (v) => { controlsActive = v; },
    onBeforeRender: (fn) => { beforeRender = fn; },
    get carScale() { return carScale; },
    render,
  };
}
