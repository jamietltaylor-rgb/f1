// Sky, clouds, distant hills, terrain, textures and trees.
import * as THREE from "three";

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

export function grassTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = "#4f7d3f";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * 512, y = rnd() * 512, r = 6 + rnd() * 40;
    const d = (rnd() - 0.5) * 26;
    g.fillStyle = `rgba(${80 + d},${126 + d * 1.2},${62 + d * 0.6},0.16)`;
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
      g.beginPath();
      g.arc(x + ox, y + oy, r, 0, 7);
      g.fill();
    }
  }
  for (let i = 0; i < 9000; i++) {
    const v = 90 + rnd() * 70;
    g.fillStyle = `rgba(${v * 0.55},${v},${v * 0.4},0.35)`;
    g.fillRect(rnd() * 512, rnd() * 512, 1.5, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Across the road (u) there are slightly darker rubbered lines; along it (v) the grain repeats. */
export function asphaltTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#3b3e43";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14000; i++) {
    const v = 40 + rnd() * 45;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(rnd() * 256, rnd() * 256, 1.6, 1.6);
  }
  const lines = [[0.26, 0.09], [0.5, 0.12], [0.74, 0.09]];
  for (const [u, w] of lines) {
    const grad = g.createLinearGradient((u - w) * 256, 0, (u + w) * 256, 0);
    grad.addColorStop(0, "rgba(10,10,12,0)");
    grad.addColorStop(0.5, "rgba(10,10,12,0.28)");
    grad.addColorStop(1, "rgba(10,10,12,0)");
    g.fillStyle = grad;
    g.fillRect((u - w) * 256, 0, w * 512, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function gravelTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = "#b8a98b";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2500; i++) {
    const v = 120 + rnd() * 90;
    g.fillStyle = `rgba(${v},${v * 0.92},${v * 0.75},0.6)`;
    g.fillRect(rnd() * 128, rnd() * 128, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeSky() {
  const geo = new THREE.SphereGeometry(45000, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sun: { value: new THREE.Vector3(-0.5, 0.55, 0.45).normalize() } },
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sun;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 horizon = vec3(0.84, 0.90, 0.95);
        vec3 mid = vec3(0.50, 0.70, 0.92);
        vec3 top = vec3(0.17, 0.42, 0.80);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
        col = mix(col, top, smoothstep(0.2, 0.9, h));
        float s = max(dot(normalize(vDir), normalize(sun)), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

export function makeClouds() {
  const [c, g] = canvas(256, 128);
  for (let i = 0; i < 40; i++) {
    const x = 50 + rnd() * 156, y = 40 + rnd() * 50, r = 14 + rnd() * 26;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  for (let i = 0; i < 38; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.55 + rnd() * 0.3, fog: false, depthWrite: false });
    const s = new THREE.Sprite(m);
    const a = rnd() * Math.PI * 2, d = 3000 + rnd() * 22000;
    s.position.set(Math.cos(a) * d, 1500 + rnd() * 1500, Math.sin(a) * d);
    const w = 3500 + rnd() * 5000;
    s.scale.set(w, w * 0.45, 1);
    group.add(s);
  }
  return group;
}

export function makeHills() {
  const group = new THREE.Group();
  for (const [R, hMax, col, bump] of [[16000, 650, 0x5d8a52, 3], [24000, 1300, 0x6f93a8, 5]]) {
    const N = 180;
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const h = hMax * (0.35 + 0.35 * Math.sin(a * bump + 1) + 0.2 * Math.sin(a * bump * 2.7 + 2) + 0.1 * Math.sin(a * bump * 7.1));
      pos.push(Math.cos(a) * R, -50, Math.sin(a) * R, Math.cos(a) * R, Math.max(20, h), Math.sin(a) * R);
    }
    for (let i = 0; i < N; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })));
  }
  return group;
}

/** Smooth ground that follows the height of the track (inverse-distance blend), with a bilinear lookup. */
export function buildTerrain(centre, groundTex) {
  const xs = centre.map((p) => p.x), zs = centre.map((p) => p.z);
  const pad = 1500;
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, z0 = Math.min(...zs) - pad, z1 = Math.max(...zs) + pad;
  const N = 240;
  const dx = (x1 - x0) / N, dz = (z1 - z0) / N;
  const pts = centre.filter((_, i) => i % 6 === 0);
  const H = new Float32Array((N + 1) * (N + 1));
  let flat = true;
  const y0 = centre[0].y;
  for (const p of centre) if (Math.abs(p.y - y0) > 0.05) { flat = false; break; }
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = x0 + i * dx, z = z0 + j * dz;
      let sw = 0, sh = 0, md = Infinity;
      if (flat) { H[j * (N + 1) + i] = y0; continue; }
      for (const p of pts) {
        const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        const w = 1 / ((d2 + 100) * (d2 + 100));
        sw += w;
        sh += w * p.y;
        if (d2 < md) md = d2;
      }
      // a shallow groove along the road, so the coarse ground mesh can never poke through it on slopes
      H[j * (N + 1) + i] = sh / sw - 1.3 * Math.exp(-md / 900);
    }
  }
  const drop = 0.55;
  const pos = new Float32Array((N + 1) * (N + 1) * 3), uv = new Float32Array((N + 1) * (N + 1) * 2);
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      pos.set([x0 + i * dx, H[k] - drop, z0 + j * dz], k * 3);
      uv.set([(x0 + i * dx) / 70, (z0 + j * dz) / 70], k * 2);
    }
  }
  const idx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
  mesh.receiveShadow = true;
  // exactly the height of the drawn triangles (each grid square is split along its b-c diagonal)
  const heightAt = (x, z) => {
    const fx = Math.min(N - 0.001, Math.max(0, (x - x0) / dx)), fz = Math.min(N - 0.001, Math.max(0, (z - z0) / dz));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const h = (a, b) => H[b * (N + 1) + a];
    const ha = h(i, j), hb = h(i + 1, j), hc = h(i, j + 1), hd = h(i + 1, j + 1);
    const v = tx + tz <= 1 ? ha + tx * (hb - ha) + tz * (hc - ha) : hd + (1 - tx) * (hc - hd) + (1 - tz) * (hb - hd);
    return v - drop;
  };
  // the ground plane that fills the rest of the world sits below the lowest point, with a wall round the edge of the mesh
  let minH = Infinity;
  for (const h of H) minH = Math.min(minH, h);
  const planeY = minH - drop - 3;
  const ring = [];
  for (let i = 0; i <= N; i++) ring.push([i, 0]);
  for (let j = 1; j <= N; j++) ring.push([N, j]);
  for (let i = N - 1; i >= 0; i--) ring.push([i, N]);
  for (let j = N - 1; j > 0; j--) ring.push([0, j]);
  const wp = [], wi = [];
  ring.forEach(([i, j], k) => {
    const h = H[j * (N + 1) + i] - drop;
    wp.push(x0 + i * dx, h, z0 + j * dz, x0 + i * dx, planeY, z0 + j * dz);
    const nx = (k + 1) % ring.length;
    wi.push(k * 2, nx * 2, k * 2 + 1, nx * 2, nx * 2 + 1, k * 2 + 1);
  });
  const wg = new THREE.BufferGeometry();
  wg.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
  wg.setIndex(wi);
  wg.computeVertexNormals();
  const wall = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x4c7a3e, roughness: 1, side: THREE.DoubleSide }));
  mesh.add(wall);
  return { mesh, heightAt, edgeHeight: planeY + 0.3 };
}

export function scatterTrees(group, track, heightAt, avoid) {
  const C = track.centre;
  const n = C.length;
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 1, 5);
  const crownGeo = new THREE.ConeGeometry(1, 1, 7);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3a2a, roughness: 1 });
  const items = [];
  seed = 777;
  const grid = new Map();
  const cell = 80;
  for (let i = 0; i < n; i++) {
    const key = `${Math.floor(C[i].x / cell)},${Math.floor(C[i].z / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(C[i]);
  }
  const nearTrack = (x, z, r) => {
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell), k = Math.ceil(r / cell);
    for (let a = -k; a <= k; a++) for (let b = -k; b <= k; b++) {
      const l = grid.get(`${gx + a},${gz + b}`);
      if (l) for (const p of l) if (Math.hypot(p.x - x, p.z - z) < r) return true;
    }
    return false;
  };
  let tries = 0;
  while (items.length < 2600 && tries < 20000) {
    tries++;
    const base = C[Math.floor(rnd() * n)];
    const clump = rnd() < 0.6;
    const dist = clump ? 70 + rnd() * 260 : 70 + rnd() * 1200;
    const a = rnd() * Math.PI * 2;
    const x = base.x + Math.cos(a) * dist, z = base.z + Math.sin(a) * dist;
    // woodland comes in patches
    const patch = Math.sin(x / 350) * Math.sin(z / 290) + Math.sin(x / 130 + z / 170) * 0.4;
    if (patch < -0.1 && rnd() < 0.85) continue;
    if (nearTrack(x, z, 62)) continue;
    if (avoid(x, z)) continue;
    const h = 7 + rnd() * 10;
    items.push({ x, z, h, w: h * (0.32 + rnd() * 0.12), tone: rnd() });
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, items.length);
  const crowns = new THREE.InstancedMesh(crownGeo, leafMat, items.length * 2);
  const d = new THREE.Object3D();
  items.forEach((t, i) => {
    const y = heightAt(t.x, t.z);
    d.rotation.set(0, rnd() * 6, 0);
    d.position.set(t.x, y + t.h * 0.15, t.z);
    d.scale.set(1, t.h * 0.3, 1);
    d.updateMatrix();
    trunks.setMatrixAt(i, d.matrix);
    const col = new THREE.Color().setHSL(0.27 + t.tone * 0.06, 0.45, 0.17 + t.tone * 0.08);
    for (let k = 0; k < 2; k++) {
      d.position.set(t.x, y + t.h * (0.3 + k * 0.3) + t.h * 0.28, t.z);
      d.scale.set(t.w * (1 - k * 0.35), t.h * 0.62, t.w * (1 - k * 0.35));
      d.updateMatrix();
      crowns.setMatrixAt(i * 2 + k, d.matrix);
      crowns.setColorAt(i * 2 + k, col);
    }
  });
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);
  return items.length;
}
