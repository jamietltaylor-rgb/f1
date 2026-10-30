// Scenery that makes the track feel like a circuit: pit lane, garages, a paddock and grandstands with a crowd.
// Placement is automatic (it only needs the track's centre line), so it works for any circuit and is approximate.
import * as THREE from "three";
import { TRACK_WIDTH } from "./scene.js";

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...extra });
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

function instanced(geo, material, items) {
  const m = new THREE.InstancedMesh(geo, material, Math.max(1, items.length));
  m.count = items.length;
  const d = new THREE.Object3D();
  items.forEach((it, i) => {
    d.position.copy(it.pos);
    d.rotation.set(0, it.yaw ?? 0, 0);
    d.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
    if (it.color !== undefined) m.setColorAt(i, new THREE.Color(it.color));
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  return m;
}

function strip(a, b, material) {
  const n = a.length;
  const pos = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) { pos.set([a[i].x, a[i].y, a[i].z], i * 6); pos.set([b[i].x, b[i].y, b[i].z], i * 6 + 3); }
  const idx = [];
  for (let i = 0; i < n - 1; i++) idx.push(i * 2, (i + 1) * 2, i * 2 + 1, (i + 1) * 2, (i + 1) * 2 + 1, i * 2 + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

/**
 * @param group  THREE.Group to fill
 * @param track  { centre: Vector3[] (even arc-length spacing), length, groundY }
 * @param colours  team colours as hex strings, used for garages and trucks
 * @param corners  [{name, x, z}] optional names for the stands
 * @returns { stands: [{name, seat: Vector3, centre: Vector3}], pit: {u0, u1} }
 */
export function buildVenue(group, track, colours, corners = []) {
  const C = track.centre;
  const n = C.length;
  const ds = track.length / n;
  const groundY = track.groundY;
  const T = [], R = [];
  for (let i = 0; i < n; i++) {
    const t = C[(i + 1) % n].clone().sub(C[(i + n - 1) % n]).setY(0).normalize();
    T.push(t);
    R.push(new THREE.Vector3(-t.z, 0, t.x)); // right of travel
  }
  const at = (i, off) => C[((i % n) + n) % n].clone().addScaledVector(R[((i % n) + n) % n], off);
  const yaw = (i) => -Math.atan2(T[((i % n) + n) % n].z, T[((i % n) + n) % n].x);

  // distance from a point to the parts of the track that are further than `span` samples away
  const clearance = (pt, i0, span) => {
    let best = Infinity;
    for (let j = 0; j < n; j += 2) {
      const d = Math.min(Math.abs(j - i0), n - Math.abs(j - i0));
      if (d < span) continue;
      best = Math.min(best, Math.hypot(C[j].x - pt.x, C[j].z - pt.z));
    }
    return best;
  };

  const teamColours = [...new Set(colours.map((c) => String(c).replace("#", "").toLowerCase()))].map((c) => parseInt(c, 16) || 0x888888);
  const units = Math.max(10, Math.min(12, teamColours.length || 10));

  // ---- which side of the straight has room for pits and a paddock ----
  const back = Math.round(320 / ds), fwd = Math.round(260 / ds);
  const spanSamples = Math.round(500 / ds);
  const score = (s) => {
    let m = Infinity;
    for (let k = -back; k <= fwd; k += Math.max(1, Math.round(30 / ds))) {
      for (const off of [30, 60, 100]) m = Math.min(m, clearance(at(k, s * off), ((k % n) + n) % n, spanSamples));
    }
    return m;
  };
  const sa = score(1), sb = score(-1);
  const side = sa >= sb ? 1 : -1;
  const roomy = Math.max(sa, sb);

  // ---- pit lane ----
  const half = TRACK_WIDTH / 2;
  const laneOff = half + 3 + 4.5;
  const laneL = [], laneR = [];
  for (let k = -back; k <= fwd; k++) {
    const edge = Math.min(k + back, fwd - k) * ds; // metres from the nearer end
    const off = laneOff * smooth(edge / 70);
    const c = at(k, side * off);
    const w = 4.2;
    const a = c.clone().addScaledVector(R[((k % n) + n) % n], -w);
    const b = c.clone().addScaledVector(R[((k % n) + n) % n], w);
    a.y += 0.04; b.y += 0.04;
    laneL.push(a); laneR.push(b);
  }
  group.add(strip(laneL, laneR, mat(0x5a5d62, { side: THREE.DoubleSide })));
  // pit wall
  const wall = [];
  for (let k = -back + Math.round(70 / ds); k <= fwd - Math.round(70 / ds); k += Math.round(8 / ds)) {
    const p = at(k, side * (laneOff - 5.2));
    wall.push({ pos: new THREE.Vector3(p.x, p.y + 0.5, p.z), yaw: yaw(k), sx: 8, sy: 1, sz: 0.5 });
  }
  group.add(instanced(UNIT, mat(0xcfd2d6), wall));

  // ---- garages: one bay per team, with a coloured door, a plinth and an upper floor ----
  const bays = [], doors = [], plinths = [], upper = [], glass = [];
  const bayLen = 20;
  const start = Math.round(-((units * bayLen) / 2 - 20) / ds);
  const lane = [];
  for (let u = 0; u < units; u++) {
    const k = Math.round(start + (u * bayLen) / ds);
    const p = at(k, side * (laneOff + 4.5 + 4.8));
    const y = p.y;
    bays.push({ pos: new THREE.Vector3(p.x, y + 2.5, p.z), yaw: yaw(k), sx: bayLen - 0.6, sy: 5, sz: 9.6 });
    const f = at(k, side * (laneOff + 4.6));
    doors.push({ pos: new THREE.Vector3(f.x, y + 1.9, f.z), yaw: yaw(k), sx: bayLen - 4, sy: 3.6, sz: 0.3, color: teamColours[u % teamColours.length] ?? 0x888888 });
    plinths.push({ pos: new THREE.Vector3(p.x, groundY + (y - groundY) / 2 - 0.05, p.z), yaw: yaw(k), sx: bayLen, sy: Math.max(0.1, y - groundY - 0.1), sz: 11 });
    upper.push({ pos: new THREE.Vector3(p.x, y + 7.5, p.z), yaw: yaw(k), sx: bayLen, sy: 5, sz: 10.4 });
    glass.push({ pos: new THREE.Vector3(f.x, y + 7.6, f.z), yaw: yaw(k), sx: bayLen - 1, sy: 3, sz: 0.2 });
    lane.push(f);
  }
  group.add(instanced(UNIT, mat(0xe3e5e8), bays));
  group.add(instanced(UNIT, mat(0xffffff, { roughness: 0.5 }), doors));
  group.add(instanced(UNIT, mat(0x4a4d52), plinths));
  group.add(instanced(UNIT, mat(0xd8dbe0), upper));
  group.add(instanced(UNIT, mat(0x25465f, { roughness: 0.2, metalness: 0.4 }), glass));
  // roof edge so the pit building doesn't look like a block
  const roofs = bays.map((b) => ({ pos: b.pos.clone().setY(b.pos.y + 2.6), yaw: b.yaw, sx: b.sx + 0.8, sy: 0.3, sz: b.sz + 2.4 }));
  group.add(instanced(UNIT, mat(0x888b90), roofs));

  // ---- paddock behind the garages ----
  let paddock = false;
  if (roomy > 110) {
    paddock = true;
    const kc = Math.round(start + (units * bayLen) / 2 / ds - 10 / ds);
    const base = at(kc, side * (laneOff + 4.5 + 9.6 + 8 + 36));
    const slabLen = 330, slabW = 70;
    const sy = base.y;
    group.add(instanced(UNIT, mat(0x8d9096), [{ pos: new THREE.Vector3(base.x, sy - 0.1, base.z), yaw: yaw(kc), sx: slabLen, sy: 0.2, sz: slabW }]));
    group.add(instanced(UNIT, mat(0x4a4d52), [{ pos: new THREE.Vector3(base.x, groundY + (sy - groundY) / 2 - 0.2, base.z), yaw: yaw(kc), sx: slabLen, sy: Math.max(0.1, sy - groundY - 0.3), sz: slabW }]));
    const fwdV = T[((kc % n) + n) % n], rgt = R[((kc % n) + n) % n];
    const place = (a, b) => new THREE.Vector3(base.x + fwdV.x * a + rgt.x * b, sy, base.z + fwdV.z * a + rgt.z * b);
    const hosp = [], trucks = [], tents = [];
    const cols = Math.max(units, 10);
    for (let u = 0; u < cols; u++) {
      const a = -slabLen / 2 + 22 + u * ((slabLen - 40) / cols);
      const h = place(a, side * 12);
      hosp.push({ pos: h.clone().setY(sy + 4.2), yaw: yaw(kc), sx: 22, sy: 8.4, sz: 12 });
      const tr = place(a + 3, side * -18);
      trucks.push({ pos: tr.clone().setY(sy + 1.6), yaw: yaw(kc), sx: 15, sy: 3.2, sz: 2.8, color: teamColours[u % teamColours.length] ?? 0x888888 });
      if (u % 2 === 0) tents.push({ pos: place(a + 2, side * -2).setY(sy + 2.2), yaw: yaw(kc) + Math.PI / 4, sx: 7, sy: 4.4, sz: 7 });
    }
    group.add(instanced(UNIT, mat(0xf4f5f6), hosp));
    group.add(instanced(UNIT, mat(0xffffff), trucks));
    const cone = new THREE.ConeGeometry(0.75, 1, 4);
    group.add(instanced(cone, mat(0xf0efe9), tents));
  }

  // ---- grandstands ----
  const stands = [];
  const L = Math.max(2, Math.round(40 / ds));
  const turn = [];
  for (let i = 0; i < n; i++) {
    const a = T[(i - L + n) % n], b = T[(i + L) % n];
    const ang = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
    const dir = Math.sign(b.clone().sub(a).dot(R[i]));
    turn.push({ i, ang, dir });
  }
  const picked = [];
  const minGap = Math.round(450 / ds);
  const farFromPit = (i) => { const d = Math.min(Math.abs(i - 0), n - Math.abs(i)); return d > Math.round(520 / ds); };
  for (const c of [...turn].sort((a, b) => b.ang - a.ang)) {
    if (c.ang < 0.28 || picked.length >= 7) break;
    if (!farFromPit(c.i)) continue;
    if (picked.every((p) => Math.min(Math.abs(p.i - c.i), n - Math.abs(p.i - c.i)) > minGap)) picked.push(c);
  }
  const specs = [{ i: Math.round(140 / ds) % n, s: -side, label: "Main straight", straight: true }];
  for (const c of picked) specs.push({ i: c.i, s: -c.dir || 1, label: null });
  const palettes = [0x2c5fa8, 0xc4382b, 0x1f8a5b, 0x7a4aa8, 0xd08a1e];
  const crowdCols = [0xe8e8e8, 0xd94f4f, 0x4f8bd9, 0xf2c14e, 0x333333, 0x6bbf6b];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let k = 0;
  for (const sp of specs) {
    let s = sp.s;
    const tryBuild = (sd) => {
      const p = at(sp.i, sd * (half + 17));
      return { p, clr: clearance(p, sp.i, spanSamples) };
    };
    let t = tryBuild(s);
    if (t.clr < 60) { s = -s; t = tryBuild(s); }
    if (t.clr < 60) continue;
    const base = t.p;
    const g = new THREE.Group();
    g.position.copy(base);
    const toTrack = R[sp.i].clone().multiplyScalar(-s); // direction from stand to the track
    g.rotation.y = -Math.atan2(toTrack.z, toTrack.x);
    const W = sp.straight ? 90 : 52;
    const seatCol = palettes[k % palettes.length];
    const tiers = 7;
    for (let r = 0; r < tiers; r++) {
      const h = (r + 1) * 0.9;
      const m = new THREE.Mesh(UNIT, mat(r % 2 ? 0x9a9da2 : 0x8a8d92));
      m.scale.set(1.1, h, W);
      m.position.set(-(0.55 + r * 1.1), h / 2, 0);
      g.add(m);
      const seats = new THREE.Mesh(UNIT, mat(seatCol));
      seats.scale.set(0.7, 0.12, W);
      seats.position.set(-(0.55 + r * 1.1) + 0.1, h + 0.06, 0);
      g.add(seats);
    }
    const crowd = [];
    for (let r = 0; r < tiers; r++) {
      const h = (r + 1) * 0.9;
      for (let z = -W / 2 + 0.6; z < W / 2 - 0.4; z += 0.8) {
        if (rnd() < 0.3) continue;
        crowd.push({ pos: new THREE.Vector3(-(0.55 + r * 1.1) + 0.1, h + 0.62, z), sx: 0.42, sy: 1, sz: 0.42, color: crowdCols[Math.floor(rnd() * crowdCols.length)] });
      }
    }
    g.add(instanced(UNIT, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), crowd));
    const roofY = tiers * 0.9 + 4.2;
    const roof = new THREE.Mesh(UNIT, mat(0xeeeeee));
    roof.scale.set(tiers * 1.1 + 2.5, 0.35, W + 2);
    roof.position.set(-(tiers * 1.1) / 2 + 0.2, roofY, 0);
    g.add(roof);
    for (const z of [-W / 2, 0, W / 2]) {
      const p = new THREE.Mesh(UNIT, mat(0x55585d));
      p.scale.set(0.4, roofY, 0.4);
      p.position.set(-tiers * 1.1 - 0.2, roofY / 2, z);
      g.add(p);
    }
    const fence = new THREE.Mesh(UNIT, mat(0x2b2d31));
    fence.scale.set(0.2, 1.3, W);
    fence.position.set(0.9, 0.65, 0);
    g.add(fence);
    const found = Math.max(0, base.y - groundY - 0.1);
    if (found > 0.2) {
      const f = new THREE.Mesh(UNIT, mat(0x4a4d52));
      f.scale.set(tiers * 1.1 + 3, found, W + 2);
      f.position.set(-(tiers * 1.1) / 2 + 0.5, -found / 2 - 0.05, 0);
      g.add(f);
    }
    group.add(g);
    g.updateMatrixWorld(true);
    const seat = g.localToWorld(new THREE.Vector3(-(0.55 + 4 * 1.1), 5 * 0.9 + 1.4, 0));
    let name = sp.label;
    if (!name) {
      let best = null, bd = 260;
      for (const c of corners) {
        const d = Math.hypot(c.x - base.x, c.z - base.z);
        if (d < bd) { bd = d; best = c.name; }
      }
      name = best ? `${best} stand` : `Corner stand ${stands.length}`;
    }
    stands.push({ name, seat, centre: base.clone() });
    k++;
  }
  return { stands, laneCentres: lane, hasPaddock: paddock };
}
