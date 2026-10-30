// Simulated cars that drive round whatever track is on screen, so the 3D model can be explored with no data.
import * as THREE from "three";

const COLOURS = ["3671c6", "e8321e", "ff8000", "27f4d2", "229971", "64c4ff", "6692ff", "b6babd", "52e252", "ff87bc"];

export class Demo {
  constructor(curve, length) {
    this.kind = "demo";
    this.durationMs = Infinity;
    this.startMs = 0;
    this.curve = curve;
    this.length = length;
    this.cars = Array.from({ length: 20 }, (_, i) => ({
      id: String(i + 1),
      label: String(i + 1),
      name: `Car ${i + 1}`,
      team: "",
      colour: COLOURS[i >> 1],
    }));
    // speed profile: slow for tight corners, fast on straights, with braking lead-in
    const N = 1200;
    const tangents = [];
    for (let i = 0; i < N; i++) tangents.push(curve.getTangentAt(i / N));
    const ds = length / N;
    let v = tangents.map((t, i) => {
      const t2 = tangents[(i + 2) % N];
      const ang = Math.acos(Math.min(1, Math.max(-1, t.dot(t2))));
      const k = ang / (2 * ds);
      return Math.min(88, Math.max(30, Math.sqrt(48 / Math.max(k, 1e-4))));
    });
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N * 2 - 1; i >= 0; i--) { // braking: can't enter a corner faster than you can slow for it
        const a = i % N, b = (i + 1) % N;
        v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * 45 * ds));
      }
      for (let i = 0; i < N * 2; i++) { // acceleration
        const a = i % N, b = (i + 1) % N;
        v[b] = Math.min(v[b], Math.sqrt(v[a] * v[a] + 2 * 22 * ds));
      }
    }
    const raw = v.reduce((s, x) => s + ds / x, 0);
    const k = 92 / raw; // make a lap take about 92 s
    this.v = v.map((x) => x / k);
    this.cum = [0];
    for (let i = 0; i < N; i++) this.cum.push(this.cum[i] + ds / this.v[i]);
    this.lapTime = this.cum[N];
    this.N = N;
    this._tmp = new THREE.Vector3();
  }

  ready() { return true; }

  _state(id, tMs) {
    const i = Number(id) - 1;
    const pace = 1 - (i % 10) * 0.0018;
    const tau = (tMs / 1000) * pace - i * 0.55;
    const laps = Math.floor(tau / this.lapTime);
    const local = tau - laps * this.lapTime;
    let lo = 0, hi = this.N;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] <= local) lo = m; else hi = m;
    }
    const f = (local - this.cum[lo]) / (this.cum[lo + 1] - this.cum[lo]);
    const u = (lo + f) / this.N;
    return { u, total: laps + u, i };
  }

  sample(id, tMs) {
    const { u, i } = this._state(id, tMs);
    const p = this.curve.getPointAt(((u % 1) + 1) % 1);
    const t = this.curve.getTangentAt(((u % 1) + 1) % 1);
    const side = (i % 2 ? 1 : -1) * 2.4 * (1 + 0.25 * Math.sin(tMs / 4000 + i));
    const l = Math.hypot(t.x, t.z) || 1;
    return [p.x - (t.z / l) * side, p.y, p.z + (t.x / l) * side];
  }

  motion(id, tMs) {
    const a = this.sample(id, tMs - 200), b = this.sample(id, tMs + 200);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    return { dir: d, kmh: (Math.hypot(d[0], d[1], d[2]) / 0.4) * 3.6 };
  }

  order(tMs) {
    return this.cars
      .map((c) => ({ id: c.id, total: this._state(c.id, tMs).total }))
      .sort((a, b) => b.total - a.total)
      .map((e, idx) => ({ id: e.id, n: idx + 1 }));
  }
}
