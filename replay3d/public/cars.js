// A single-seater built from lofted body sections and simple parts, about 5.6 m long and 2.0 m wide, facing +X.
import * as THREE from "three";

const carbon = new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.5, metalness: 0.3 });
const tyreMat = new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.95 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.35, metalness: 0.8 });
const armMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.5 });
const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.35 });
const bodyMats = new Map();

function bodyMat(hex) {
  if (!bodyMats.has(hex)) bodyMats.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.32, metalness: 0.35 }));
  return bodyMats.get(hex);
}
function accentMat(hex) {
  const key = "a" + hex;
  if (!bodyMats.has(key)) {
    const c = new THREE.Color(hex);
    const lum = c.r * 0.3 + c.g * 0.6 + c.b * 0.1;
    bodyMats.set(key, new THREE.MeshStandardMaterial({ color: lum > 0.5 ? 0x15171a : 0xf2f2f2, roughness: 0.4, metalness: 0.2 }));
  }
  return bodyMats.get(key);
}

const sgnPow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

/** sections: [x, halfWidth, yBottom, yTop]; rounded cross-sections blended along x. */
function loft(sections, material, { z = 0, seg = 16, round = 2.8 } = {}) {
  const ring = seg;
  const pos = [];
  for (const [x, w, y0, y1] of sections) {
    const cy = (y0 + y1) / 2, hy = Math.max(0.005, (y1 - y0) / 2);
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      pos.push(x, cy + hy * sgnPow(Math.sin(a), 2 / round), z + Math.max(0.005, w) * sgnPow(Math.cos(a), 2 / round));
    }
  }
  const idx = [];
  for (let s = 0; s < sections.length - 1; s++) {
    for (let k = 0; k < ring; k++) {
      const a = s * ring + k, b = s * ring + ((k + 1) % ring), c = (s + 1) * ring + k, d = (s + 1) * ring + ((k + 1) % ring);
      idx.push(a, b, c, b, d, c);
    }
  }
  // end caps
  for (const [s, flip] of [[0, true], [sections.length - 1, false]]) {
    const centre = pos.length / 3;
    const [x, , y0, y1] = sections[s];
    pos.push(x, (y0 + y1) / 2, z);
    for (let k = 0; k < ring; k++) {
      const a = s * ring + k, b = s * ring + ((k + 1) % ring);
      idx.push(centre, flip ? b : a, flip ? a : b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function link(a, b, r, material) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 5), material);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return m;
}

export function buildCar(hex) {
  const body = bodyMat(hex);
  const accent = accentMat(hex);
  const g = new THREE.Group();
  const wheels = [];

  // monocoque, nose and engine cover as one smooth shape
  g.add(loft([
    [3.0, 0.05, 0.2, 0.3],
    [2.55, 0.1, 0.19, 0.32],
    [1.9, 0.17, 0.18, 0.4],
    [1.2, 0.25, 0.18, 0.5],
    [0.6, 0.3, 0.18, 0.62],
    [0.0, 0.31, 0.18, 0.62],
    [-0.5, 0.29, 0.18, 0.7],
    [-1.1, 0.24, 0.2, 0.82],
    [-1.8, 0.16, 0.22, 0.64],
    [-2.4, 0.09, 0.26, 0.5],
  ], body));
  // sidepods: wide and low at the front, tapering to the rear (the "coke bottle")
  for (const side of [-1, 1]) {
    g.add(loft([
      [0.75, 0.04, 0.2, 0.34],
      [0.35, 0.2, 0.18, 0.5],
      [-0.3, 0.26, 0.18, 0.54],
      [-1.0, 0.24, 0.18, 0.46],
      [-1.7, 0.13, 0.2, 0.34],
      [-2.0, 0.04, 0.22, 0.3],
    ], body, { z: side * 0.52, seg: 12 }));
  }
  // floor and diffuser
  g.add(box(3.8, 0.04, 1.5, carbon, -0.2, 0.15, 0));
  const diff = box(0.9, 0.04, 1.0, carbon, -2.3, 0.26, 0);
  diff.rotation.z = 0.28;
  g.add(diff);
  // airbox and shark fin
  g.add(loft([[-0.1, 0.05, 0.6, 0.78], [-0.45, 0.17, 0.6, 0.96], [-0.9, 0.12, 0.6, 0.9]], accent, { seg: 10 }));
  g.add(box(1.3, 0.38, 0.02, body, -1.65, 0.78, 0));
  // cockpit rim, driver, halo
  g.add(box(0.7, 0.05, 0.5, carbon, 0.15, 0.63, 0));
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), helmetMat);
  helmet.position.set(0.18, 0.72, 0);
  helmet.scale.set(1.1, 1, 0.95);
  g.add(helmet);
  for (const s of [-1, 1]) {
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.2, 0.62, s * 0.27), new THREE.Vector3(0.0, 0.86, s * 0.23),
      new THREE.Vector3(0.45, 0.93, s * 0.11), new THREE.Vector3(0.78, 0.9, 0),
    ]), 14, 0.02, 6), carbon);
    g.add(tube);
  }
  g.add(link([0.78, 0.9, 0], [0.95, 0.62, 0], 0.025, carbon));

  // front wing: three elements and end plates
  const fw = [[3.12, 0.1, 1.92], [2.98, 0.17, 1.86], [2.84, 0.24, 1.78]];
  fw.forEach(([x, y, w], i) => g.add(box(0.28, 0.025, w, i === 0 ? carbon : body, x, y, 0)));
  for (const s of [-1, 1]) g.add(box(0.62, 0.3, 0.025, accent, 3.0, 0.2, s * 0.97));
  g.add(box(0.12, 0.12, 0.08, carbon, 2.6, 0.14, 0.18)); // pylons
  g.add(box(0.12, 0.12, 0.08, carbon, 2.6, 0.14, -0.18));
  // rear wing: main plane, DRS flap, end plates, beam wing
  g.add(box(0.34, 0.03, 1.0, carbon, -2.55, 0.8, 0));
  g.add(box(0.26, 0.025, 1.0, body, -2.62, 0.96, 0));
  for (const s of [-1, 1]) g.add(box(0.72, 0.58, 0.025, accent, -2.58, 0.78, s * 0.52));
  g.add(box(0.06, 0.4, 0.06, carbon, -2.3, 0.55, 0));
  g.add(box(0.3, 0.025, 0.85, carbon, -2.4, 0.4, 0));

  // wheels, suspension, brake ducts
  const addWheel = (x, z, R, W) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, R, z);
    pivot.rotation.x = Math.PI / 2;
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 24), tyreMat);
    tyre.castShadow = true;
    spin.add(tyre);
    const face = Math.sign(z) * -1; // outer face is +Y after the pivot turn for z>0? set both faces
    for (const f of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.66, R * 0.66, 0.01, 18), rimMat);
      rim.position.y = (W / 2 + 0.002) * f;
      spin.add(rim);
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(R * 1.2, 0.012, R * 0.14), carbon);
      spoke.position.y = (W / 2 + 0.008) * f;
      spin.add(spoke);
      const spoke2 = spoke.clone();
      spoke2.rotation.y = Math.PI / 2;
      spin.add(spoke2);
      const band = new THREE.Mesh(new THREE.TorusGeometry(R * 0.9, 0.012, 4, 24), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }));
      band.rotation.x = Math.PI / 2;
      band.position.y = (W / 2 - 0.004) * f;
      spin.add(band);
    }
    void face;
    pivot.add(spin);
    g.add(pivot);
    wheels.push({ spin, R });
    // wishbones
    const inner = Math.sign(z) * 0.2;
    g.add(link([x + 0.15, R + 0.08, inner], [x, R + 0.02, z - Math.sign(z) * W / 2], 0.014, armMat));
    g.add(link([x - 0.15, R - 0.05, inner], [x, R - 0.02, z - Math.sign(z) * W / 2], 0.014, armMat));
  };
  for (const s of [-1, 1]) {
    addWheel(1.85, s * 0.8, 0.33, 0.30); // front
    addWheel(-1.75, s * 0.8, 0.36, 0.42); // rear
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, wheels };
}
