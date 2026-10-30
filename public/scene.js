// The 3D world: lights, ground, the track ribbon, the cars and the camera.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

export const TRACK_WIDTH = 13;

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9c4dc);
  scene.fog = new THREE.Fog(0xa9c4dc, 6000, 26000);

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 60000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 8;
  controls.maxDistance = 30000;
  controls.screenSpacePanning = false;

  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4d6b3f, 1.35));
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.1);
  sun.position.set(-2500, 4000, 1800);
  scene.add(sun);

  const world = new THREE.Group();
  scene.add(world);
  const trackGroup = new THREE.Group();
  world.add(trackGroup);
  const carGroup = new THREE.Group();
  world.add(carGroup);
  const venueGroup = new THREE.Group();
  world.add(venueGroup);

  let track = null; // { curve, length, box, sphere, groundY }
  const cars = new Map(); // id -> car object
  let carScale = 1;
  let zoomK = 1;

  const mats = { cars: new Map() };
  const matFor = (hex) => {
    if (!mats.cars.has(hex)) mats.cars.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.45, metalness: 0.25 }));
    return mats.cars.get(hex);
  };
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.8 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.95 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  const blobTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,.55)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  // A low-poly single-seater, about 5.5 m long, facing +X.
  function buildCar(hex) {
    const body = matFor(hex);
    const g = new THREE.Group();
    g.add(box(3.6, 0.28, 0.95, dark, -0.1, 0.18, 0)); // floor
    g.add(box(2.6, 0.5, 0.62, body, 0.1, 0.5, 0)); // tub
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.34, 2.0, 12), body);
    nose.rotation.z = Math.PI / 2; // wide end back, tip forward
    nose.position.set(1.9, 0.4, 0);
    g.add(nose);
    g.add(box(1.7, 0.42, 0.55, body, -0.5, 0.42, 0.62)); // sidepods
    g.add(box(1.7, 0.42, 0.55, body, -0.5, 0.42, -0.62));
    g.add(box(1.5, 0.5, 0.3, body, -0.95, 0.72, 0)); // engine cover
    g.add(box(0.5, 0.06, 1.9, body, 3.0, 0.1, 0)); // front wing
    g.add(box(0.5, 0.2, 0.05, dark, 3.0, 0.2, 0.95));
    g.add(box(0.5, 0.2, 0.05, dark, 3.0, 0.2, -0.95));
    g.add(box(0.55, 0.07, 1.0, body, -2.7, 0.95, 0)); // rear wing
    g.add(box(0.7, 0.45, 0.05, dark, -2.7, 0.75, 0.5));
    g.add(box(0.7, 0.45, 0.05, dark, -2.7, 0.75, -0.5));
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), white);
    helmet.position.set(0.15, 0.85, 0);
    g.add(helmet);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 6, 12, Math.PI), dark);
    halo.rotation.set(0, Math.PI / 2, 0);
    halo.position.set(0.2, 0.78, 0);
    g.add(halo);
    for (const [x, z, r, w] of [[1.75, 0.86, 0.34, 0.3], [1.75, -0.86, 0.34, 0.3], [-1.6, 0.9, 0.37, 0.42], [-1.6, -0.9, 0.37, 0.42]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), tyre);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, r, z);
      g.add(wheel);
    }
    return g;
  }

  function labelSprite(text) {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(16,18,20,.82)";
    g.beginPath();
    g.roundRect(4, 8, 152, 48, 12);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "700 34px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 80, 33);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    s.scale.set(0.06, 0.024, 1);
    s.userData.base = [0.06, 0.024];
    s.center.set(0.5, 0);
    s.renderOrder = 10;
    return s;
  }

  const tagTex = {};
  function crashTag(text) {
    if (!tagTex[text]) {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 64;
      const g = c.getContext("2d");
      g.fillStyle = "#d4140a";
      g.beginPath();
      g.roundRect(4, 6, 248, 52, 12);
      g.fill();
      g.fillStyle = "#fff";
      g.font = "800 38px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, 128, 33);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      tagTex[text] = t;
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex[text], depthTest: false, transparent: true, sizeAttenuation: false }));
    sp.scale.set(0.1, 0.025, 1);
    sp.userData.base = [0.1, 0.025];
    sp.center.set(0.5, -1.25);
    sp.renderOrder = 11;
    sp.visible = false;
    return sp;
  }

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
      const model = buildCar(hex);
      model.name = "model";
      model.userData.carId = info.id;
      root.add(model);
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.4), blobMat);
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.04;
      root.add(blob);
      const label = labelSprite(info.label);
      label.position.y = 2.6;
      root.add(label);
      const tagYes = crashTag("CRASHED");
      const tagMaybe = crashTag("CRASH?");
      const tagStop = crashTag("STOPPED");
      root.add(tagYes, tagMaybe, tagStop);
      root.userData.carId = info.id;
      carGroup.add(root);
      cars.set(info.id, { id: info.id, root, model, label, tagYes, tagMaybe, tagStop, crash: 0, heading: 0, pitch: 0, visible: false, pos: new THREE.Vector3(), info });
    }
    applyCarScale();
  }

  function applyCarScale() {
    for (const c of cars.values()) {
      c.model.scale.setScalar(carScale * zoomK);
      c.label.position.y = 2.2 * carScale * zoomK + 1.2;
      c.tagYes.position.y = c.tagMaybe.position.y = c.tagStop.position.y = c.label.position.y;
    }
  }

  function setCarScale(v) {
    carScale = v;
    applyCarScale();
  }

  function setCrashed(id, level) {
    const c = cars.get(id);
    if (!c) return;
    c.crash = level;
    c.tagYes.visible = level === 2;
    c.tagMaybe.visible = level === 1;
    c.tagStop.visible = level === 3;
  }

  function placeCar(id, pos, dir) {
    const c = cars.get(id);
    if (!c) return;
    if (!pos) {
      c.root.visible = false;
      return;
    }
    c.root.visible = true;
    c.pos.set(pos[0], pos[1], pos[2]);
    c.root.position.copy(c.pos);
    if (dir) {
      const flat = Math.hypot(dir[0], dir[2]);
      if (flat > 0.002) {
        const want = -Math.atan2(dir[2], dir[0]);
        let d = want - c.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        c.heading += d * 0.35;
        const pitchWant = Math.atan2(dir[1], flat);
        c.pitch += (pitchWant - c.pitch) * 0.2;
      }
    }
    c.root.rotation.set(0, c.heading, c.pitch);
  }

  // ---- track ----
  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.material.userData?.shared) {
        o.material.map?.dispose?.();
        o.material.dispose();
      }
    });
    g.clear();
  }

  function strip(left, right, y0, mat) {
    // left/right are arrays of Vector3 (closed loop). y0 lifts the strip a little.
    const n = left.length;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      pos.set([left[i].x, left[i].y + y0, left[i].z], i * 6);
      pos.set([right[i].x, right[i].y + y0, right[i].z], i * 6 + 3);
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      idx.push(i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
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

  /** points: Vector3[] along the middle of the road, in driving order (closed loop). */
  function setTrack(points, corners = []) {
    disposeGroup(trackGroup);
    disposeGroup(venueGroup);
    const curve = new THREE.CatmullRomCurve3(points, true, "centripetal");
    const length = curve.getLength();
    const n = Math.max(300, Math.min(2400, Math.round(length / 5)));
    const centre = [];
    const left = [];
    const right = [];
    const edgeL1 = [], edgeL2 = [], edgeR1 = [], edgeR2 = [];
    let minY = Infinity;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u);
      const nx = -t.z, nz = t.x;
      const l = Math.hypot(nx, nz) || 1;
      const nv = new THREE.Vector3(nx / l, 0, nz / l);
      const h = TRACK_WIDTH / 2;
      centre.push(p);
      left.push(p.clone().addScaledVector(nv, h));
      right.push(p.clone().addScaledVector(nv, -h));
      edgeL1.push(p.clone().addScaledVector(nv, h - 0.2));
      edgeL2.push(p.clone().addScaledVector(nv, h - 0.8));
      edgeR1.push(p.clone().addScaledVector(nv, -(h - 0.8)));
      edgeR2.push(p.clone().addScaledVector(nv, -(h - 0.2)));
      minY = Math.min(minY, p.y);
    }
    const groundY = minY - 1.2;
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x34373b, roughness: 0.92, side: THREE.DoubleSide });
    const line = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.7, side: THREE.DoubleSide });
    trackGroup.add(strip(left, right, 0, asphalt));
    trackGroup.add(strip(edgeL1, edgeL2, 0.05, line));
    trackGroup.add(strip(edgeR1, edgeR2, 0.05, line));

    // skirts from road edge down to the ground, so a hilly track doesn't float
    const grass = new THREE.MeshStandardMaterial({ color: 0x4f7a43, roughness: 1, side: THREE.DoubleSide });
    const groundL = left.map((p) => new THREE.Vector3(p.x, groundY, p.z));
    const groundR = right.map((p) => new THREE.Vector3(p.x, groundY, p.z));
    trackGroup.add(strip(left, groundL, -0.05, grass));
    trackGroup.add(strip(right, groundR, -0.05, grass));

    const ground = new THREE.Mesh(new THREE.CircleGeometry(40000, 48), new THREE.MeshStandardMaterial({ color: 0x57854a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = groundY;
    trackGroup.add(ground);

    // start/finish line
    const p0 = centre[0];
    const t0 = curve.getTangentAt(0);
    const sl = new THREE.Mesh(new THREE.PlaneGeometry(3, TRACK_WIDTH - 1.6), new THREE.MeshBasicMaterial({ map: checker(), side: THREE.DoubleSide }));
    sl.rotation.set(-Math.PI / 2, -Math.atan2(t0.z, t0.x), 0, "YXZ");
    sl.position.copy(p0).setY(p0.y + 0.09);
    trackGroup.add(sl);

    for (const c of corners) {
      const s = labelSprite(c.name);
      s.scale.set(0.085, 0.032, 1);
      s.userData.base = [0.085, 0.032];
      s.position.set(c.x, (c.y ?? 0) + 24, c.z);
      trackGroup.add(s);
    }

    const box3 = new THREE.Box3().setFromPoints(centre);
    const sphere = box3.getBoundingSphere(new THREE.Sphere());
    track = { curve, length, box: box3, sphere, groundY, centre };
    return track;
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

  // ---- picking ----
  const ray = new THREE.Raycaster();
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    const meshes = [];
    for (const c of cars.values()) if (c.root.visible) meshes.push(c.model);
    const hit = ray.intersectObjects(meshes, true)[0];
    let o = hit?.object;
    while (o && o.userData.carId === undefined) o = o.parent;
    return o ? o.userData.carId : null;
  }

  return {
    renderer, scene, camera, controls, cars, THREE,
    venueGroup, setCrashed, setTrack, setCars, setCarScale, placeCar, fitCamera, pick, resize,
    getTrack: () => track,
    get carScale() { return carScale; },
    render() {
      controls.update();
      // keep cars visible from far away: grow them with camera distance
      const k = Math.min(10, Math.max(1, camera.position.distanceTo(controls.target) / 450));
      if (Math.abs(k - zoomK) > 0.03) { zoomK = k; applyCarScale(); }
      // sprites that keep a constant screen size would otherwise grow when the lens zooms in
      const lens = Math.tan((camera.fov * Math.PI) / 360) / Math.tan((50 * Math.PI) / 360);
      scene.traverse((o) => { if (o.isSprite && o.userData.base) o.scale.set(o.userData.base[0] * lens, o.userData.base[1] * lens, 1); });
      const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 160);
      for (const c of cars.values()) if (c.crash) (c.crash === 2 ? c.tagYes : c.crash === 1 ? c.tagMaybe : c.tagStop).material.opacity = pulse;
      renderer.render(scene, camera);
    },
  };
}
