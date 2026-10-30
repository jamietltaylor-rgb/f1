// Keeps replayed cars from driving through each other without changing who is ahead of whom.
// Each car's real position is turned into "distance along the track" and "sideways position on the road".
// Where two cars would overlap, they are moved apart: side by side if they are level (so an overtake shows the
// passing car pulling out beside the other), or nose to tail if one is just behind. The real order is never swapped.

const CAR_LEN = 6.4; // nose-to-tail spacing needed
const CAR_GAP = 2.5; // side-to-side spacing needed (car 2 m wide)
const EDGE = 11; // furthest a car may be pushed sideways from the centreline

export class Spacer {
  constructor(track) {
    this.t = track;
    this.n = track.centre.length;
    this.L = track.length;
    this.hint = new Map();
    this.side = new Map(); // remembered "who is on which side" for a pair, so it never flips mid-overtake
  }

  _project(id, x, z) {
    const { centre, T, R } = this.t, n = this.n;
    const test = (k) => (centre[k].x - x) ** 2 + (centre[k].z - z) ** 2;
    let best = -1, bd = Infinity;
    const h = this.hint.get(id);
    if (h !== undefined) for (let d = -40; d <= 40; d++) { const k = (h + d + n) % n, v = test(k); if (v < bd) { bd = v; best = k; } }
    if (best < 0 || bd > 70 * 70) { bd = Infinity; for (let k = 0; k < n; k++) { const v = test(k); if (v < bd) { bd = v; best = k; } } }
    this.hint.set(id, best);
    const c = centre[best];
    const dx = x - c.x, dz = z - c.z;
    return { k: best, S: best * (this.L / n) + dx * T[best].x + dz * T[best].z, lat: dx * R[best].x + dz * R[best].z };
  }

  /** cars: [{ id, x, z, kmh }] -> Map id -> [dx, dz] world-space offset that removes the overlaps. */
  offsets(cars) {
    const L = this.L, { T, R } = this.t;
    const c = cars.map((q) => ({ ...q, ...this._project(q.id, q.x, q.z), dS: 0, dL: 0 }));
    const wrap = (d) => d - L * Math.round(d / L);
    const pairs = [];
    for (let a = 0; a < c.length; a++) for (let b = a + 1; b < c.length; b++) {
      if (Math.abs(wrap(c[a].S - c[b].S)) < 14 && Math.abs(c[a].lat - c[b].lat) < 8) pairs.push([a, b]);
    }
    const live = new Set();
    for (let pass = 0; pass < 8; pass++) {
      let any = false;
      for (const [a, b] of pairs) {
        const A = c[a], B = c[b];
        const dS = wrap((A.S + A.dS) - (B.S + B.dS)); // >0: A is ahead of B
        const dl = (A.lat + A.dL) - (B.lat + B.dL);
        if (Math.abs(dS) >= CAR_LEN || Math.abs(dl) >= CAR_GAP) continue;
        const key = A.id < B.id ? `${A.id}|${B.id}` : `${B.id}|${A.id}`;
        live.add(key);
        // a car that is (nearly) stationary stays put; the other one moves out of its way
        const wa = A.kmh < 15 && B.kmh >= 15 ? 0 : B.kmh < 15 && A.kmh >= 15 ? 1 : 0.5;
        const wb = 1 - wa;
        const costLat = CAR_GAP - Math.abs(dl), costLon = CAR_LEN - Math.abs(dS);
        if (costLat <= costLon * 1.15) {
          let s = this.side.get(key);
          if (s === undefined) { s = dl > 0.05 ? 1 : dl < -0.05 ? -1 : (A.id < B.id ? 1 : -1); this.side.set(key, s); }
          const need = (CAR_GAP - s * dl) * 1; // how much more separation is needed on that side
          let da = need * wa, db = -need * wb;
          A.dL += s * da; B.dL += s * db;
          for (const q of [A, B]) { const l = q.lat + q.dL; if (Math.abs(l) > EDGE && Math.abs(q.lat) <= EDGE) q.dL = Math.sign(l) * EDGE - q.lat; }
        } else {
          const need = CAR_LEN - Math.abs(dS);
          const front = dS >= 0 ? A : B, rear = dS >= 0 ? B : A;
          const wf = front === A ? wa : wb, wr = 1 - wf;
          front.dS += need * wf; rear.dS -= need * wr;
        }
        any = true;
      }
      if (!any) break;
    }
    for (const key of [...this.side.keys()]) if (!live.has(key) && Math.random() < 0.02) this.side.delete(key);
    const out = new Map();
    for (const q of c) {
      const dS = Math.max(-6, Math.min(6, q.dS)), dL = Math.max(-5, Math.min(5, q.dL));
      out.set(q.id, [T[q.k].x * dS + R[q.k].x * dL, T[q.k].z * dS + R[q.k].z * dL]);
    }
    return out;
  }
}
