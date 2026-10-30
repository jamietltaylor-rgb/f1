// A small race simulation for the demo: cars follow the racing line at corner-limited speeds, catch each other,
// change lane to overtake (and can't drive through one another), and two cars crash and slide off into the run-off.
import { TRACK_WIDTH } from "./constants.js";

const COLOURS = ["3671c6", "e8321e", "ff8000", "27f4d2", "229971", "64c4ff", "6692ff", "b6babd", "52e252", "ff87bc"];
const STEP = 0.05; // seconds per simulation step
const CAR_LEN = 6.4; // bumper-to-bumper spacing a car needs to the one in front
const HALF = TRACK_WIDTH / 2;

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export class Demo {
  /** track: { centre: Vector3[], T: Vector3[], R: Vector3[], ds, length } from the scene */
  constructor(track, { crashes = [{ id: "7", after: 35 }, { id: "14", after: 95 }], seed = 11 } = {}) {
    this.kind = "demo";
    this.durationMs = Infinity;
    this.startMs = 0;
    this.track = track;
    this.n = track.centre.length;
    // true distance along the centreline points (they are not always evenly spaced)
    this.cum = [0];
    for (let i = 0; i < this.n; i++) this.cum.push(this.cum[i] + track.centre[i].distanceTo(track.centre[(i + 1) % this.n]));
    this.L = this.cum[this.n];
    this.cars = Array.from({ length: 20 }, (_, i) => ({
      id: String(i + 1), label: String(i + 1), name: `Car ${i + 1}`, team: "", colour: COLOURS[i >> 1],
    }));
    this.events = [];
    this.crashPlan = crashes.map((c) => ({ ...c, done: false }));
    this.vLimit = this._profile();
    const r = rng(seed);
    this.sim = this.cars.map((c, i) => ({
      id: c.id,
      S: -(12 + Math.floor(i / 2) * 8.5 + (i % 2) * 3), // grid slots behind the line, two abreast
      lat: (i % 2 ? 1 : -1) * 2.4,
      baseLat: (i % 2 ? 1 : -1) * 2.0 + (r() - 0.5),
      v: 0,
      pace: 0.955 + r() * 0.05,
      phase: r() * 6,
      mode: "race", // race | crash | stopped
      over: 0, // +1/-1 while overtaking on that side
      target: null,
      latTarget: 0,
      pos: [0, 0, 0], heading: 0, kmh: 0,
      idx: 0,
      w: [0, 0], vel: [0, 0], spin: 0, spinInit: 0,
    }));
    this.simT = 0;
    this.prev = this.sim.map((s) => this._place(s));
    this.cur = this.prev.map((p) => ({ ...p }));
    this.prevT = 0;
    this.curT = 0;
    this._index = new Map(this.cars.map((c, i) => [c.id, i]));
  }

  // speed the road allows at each point, with braking before corners and gradual acceleration out of them
  _profile() {
    const { T } = this.track, n = this.n, ds = this.track.ds;
    let v = T.map((t, i) => {
      const t2 = T[(i + 3) % n], t0 = T[(i + n - 3) % n];
      const ang = Math.acos(Math.min(1, Math.max(-1, t0.dot(t2))));
      const k = ang / (6 * ds);
      return Math.min(92, Math.max(26, Math.sqrt(46 / Math.max(k, 1e-4))));
    });
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n * 2 - 1; i >= 0; i--) { const a = i % n, b = (i + 1) % n; v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * 42 * ds)); }
      for (let i = 0; i < n * 2; i++) { const a = i % n, b = (i + 1) % n; v[b] = Math.min(v[b], Math.sqrt(v[a] * v[a] + 2 * 18 * ds)); }
    }
    this.curv = T.map((t, i) => {
      const t2 = T[(i + 3) % n], t0 = T[(i + n - 3) % n];
      return Math.acos(Math.min(1, Math.max(-1, t0.dot(t2)))) / (6 * ds);
    });
    return v;
  }

  _u(S) { return (((S % this.L) + this.L) % this.L) / this.L; }

  _frame(S) {
    const s = ((S % this.L) + this.L) % this.L, cum = this.cum;
    let lo = 0, hi = this.n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
    const i = lo, j = (i + 1) % this.n, seg = cum[i + 1] - cum[i];
    return { i, j, t: seg > 0 ? (s - cum[i]) / seg : 0 };
  }

  _place(s) {
    const { centre, R, T } = this.track;
    if (s.mode === "race") {
      const { i, j, t } = this._frame(s.S);
      const c0 = centre[i], c1 = centre[j], r0 = R[i], r1 = R[j];
      const rx = r0.x + (r1.x - r0.x) * t, rz = r0.z + (r1.z - r0.z) * t;
      const rl = Math.hypot(rx, rz) || 1;
      const x = c0.x + (c1.x - c0.x) * t + (rx / rl) * s.lat;
      const z = c0.z + (c1.z - c0.z) * t + (rz / rl) * s.lat;
      const y = c0.y + (c1.y - c0.y) * t;
      const tx = T[i].x, tz = T[i].z;
      // lean the heading into a lane change a little
      const hx = tx * Math.max(s.v, 1) + (rx / rl) * (s.latRate || 0), hz = tz * Math.max(s.v, 1) + (rz / rl) * (s.latRate || 0);
      return { pos: [x, y, z], heading: Math.atan2(hz, hx), kmh: s.v * 3.6 };
    }
    return { pos: [s.w[0], s.y ?? 0, s.w[1]], heading: s.heading, kmh: Math.hypot(s.vel[0], s.vel[1]) * 3.6 };
  }

  _gap(a, b) { // how far in front of a is b along the track
    const g = (b.S - a.S) % this.L;
    return g < 0 ? g + this.L : g;
  }

  _step(t) {
    const L = this.L, S = this.sim;
    const go = t > 3; // lights out
    // find each car's nearest car ahead
    for (const a of S) {
      if (a.mode !== "race") continue;
      let ahead = null, ag = 1e9;
      for (const b of S) {
        if (b === a || b.mode === "crash") continue;
        const g = this._gap(a, b);
        if (g > 0 && g < 80 && g < ag && Math.abs(b.lat - a.lat) < 3.2) { ahead = b; ag = g; }
      }
      const { i } = this._frame(a.S);
      let vDes = this.vLimit[i] * a.pace * (1 + 0.012 * Math.sin(t * 0.37 + a.phase));
      if (!go) vDes = 0;
      if (ahead) {
        const bumper = ag - CAR_LEN;
        // try to pull out and pass a slower car
        if (!a.over && bumper < 28 && vDes > ahead.v + 1.5 && go) {
          for (const side of (a.id % 2 ? [1, -1] : [-1, 1])) {
            const want = Math.max(-HALF + 2.8, Math.min(HALF - 2.8, ahead.lat + side * 3.6));
            if (Math.abs(want - ahead.lat) < 2.9) continue;
            const clear = S.every((o) => o === a || o === ahead || o.mode === "crash" || (() => {
              const g = this._gap(a, o), back = this._gap(o, a);
              return !((g < 40 || back < 14) && Math.abs(o.lat - want) < 2.9);
            })());
            if (clear) { a.over = side; a.target = ahead; break; }
          }
        }
        if (!a.over) vDes = Math.min(vDes, ahead.v + (bumper - 7) * 0.7);
        else vDes = Math.min(vDes + 6, vDes * 1.05); // slipstream and DRS
      }
      if (a.over && !ahead && go) vDes = Math.min(vDes + 6, vDes * 1.05); // keep the power on until clear
      if (a.over && ahead && ahead !== a.target) a.target = ahead; // someone else is now in the way
      if (a.over) {
        const t0 = a.target;
        const g = this._gap(a, t0);
        const ahead2 = g > 0 && g < L / 2;
        if (!ahead2 && this._gap(t0, a) > 9) { a.over = 0; a.target = null; a.latTarget = a.baseLat; }
        else a.latTarget = Math.max(-HALF + 2.8, Math.min(HALF - 2.8, t0.lat + a.over * 3.6));
      } else a.latTarget = a.baseLat;
      // speed
      if (vDes > a.v) a.v += Math.min(vDes - a.v, (14 * (1 - a.v / 105) + 2) * STEP);
      else a.v -= Math.min(a.v - vDes, 42 * STEP);
      let dl = Math.max(-2.6 * STEP, Math.min(2.6 * STEP, a.latTarget - a.lat));
      // never steer into a car that is alongside or just in front/behind
      for (const o of S) {
        if (o === a || o.mode !== "race") continue;
        if ((this._gap(a, o) < 8 || this._gap(o, a) < 8) && Math.abs(a.lat + dl - o.lat) < 2.6 && Math.abs(a.lat + dl - o.lat) < Math.abs(a.lat - o.lat)) { dl = 0; break; }
      }
      a.lat += dl;
      a.latRate = dl / STEP;
      a.S += a.v * STEP;
    }
    // hard rule: a car can never occupy the same space as the one it is behind
    for (let pass = 0, moved = true; pass < 12 && moved; pass++) {
      moved = false;
      for (const a of S) {
        if (a.mode !== "race") continue;
        for (const b of S) {
          if (b === a || b.mode === "crash") continue;
          const g = this._gap(a, b);
          if (g < CAR_LEN - 0.01 && (g > 0 || this._gap(b, a) > 0 || a.id < b.id) && Math.abs(b.lat - a.lat) < 2.4) {
            if (b.mode === "race" || b.mode === "stopped") {
              a.S = b.S - CAR_LEN;
              a.v = Math.min(a.v, b.mode === "race" ? b.v : 0);
              moved = true;
            }
          }
        }
      }
    }
    // scripted crashes: the car carries straight on from the next fast corner, spinning, into the run-off
    for (const plan of this.crashPlan) {
      if (plan.done || t < plan.after) continue;
      const a = S[this._index.get(plan.id)];
      if (!a || a.mode !== "race" || a.v < 40) continue;
      const { i } = this._frame(a.S);
      if (this.curv[i] > 1 / 240) {
        plan.done = true;
        const { T, R, centre } = this.track;
        const place = this._place(a);
        a.mode = "crash";
        a.w = [place.pos[0], place.pos[2]];
        a.y = place.pos[1];
        a.heading = place.heading;
        const turn = Math.sign(T[(i + 5) % this.n].clone().sub(T[(i + this.n - 5) % this.n]).dot(R[i])) || 1;
        a.vel = [T[i].x * a.v + R[i].x * a.latRate, T[i].z * a.v + R[i].z * a.latRate];
        a.spinInit = a.spin = -turn * (3 + (plan.id % 3)); // oversteers away from the corner
        a.idx = i;
        this.events.push({ id: a.id, label: a.label || a.id, t: t * 1000, until: Infinity, confirmed: true, level: 2 });
        void centre;
      }
    }
    for (const a of S) {
      if (a.mode !== "crash") continue;
      const { centre, R } = this.track, n = this.n;
      // nearest road point (search near the previous one)
      let best = a.idx, bd = Infinity;
      for (let k = -40; k <= 40; k++) {
        const j = (a.idx + k + n) % n;
        const d = (centre[j].x - a.w[0]) ** 2 + (centre[j].z - a.w[1]) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      a.idx = best;
      const lat = (a.w[0] - centre[best].x) * R[best].x + (a.w[1] - centre[best].z) * R[best].z;
      const out = Math.abs(lat);
      const sp = Math.hypot(a.vel[0], a.vel[1]);
      let decel = out < HALF ? 6 : out < HALF + 16 ? 16 : 9; // tarmac, gravel trap, grass
      if (out > HALF + 15 && sp > 2) { a.vel[0] *= 0.18; a.vel[1] *= 0.18; a.spin += 2.2; decel = 20; } // tyre wall
      const k = Math.max(0, sp - decel * STEP) / (sp || 1);
      a.vel[0] *= k; a.vel[1] *= k;
      a.w[0] += a.vel[0] * STEP;
      a.w[1] += a.vel[1] * STEP;
      a.heading += a.spin * STEP;
      a.spin *= 1 - Math.min(0.9, STEP * (sp < 3 ? 6 : 0.6));
      if (sp < 0.4) { a.vel = [0, 0]; a.spin = 0; a.mode = "stopped"; }
    }
    this.simT = t;
  }

  advance(tMs) {
    const target = Math.max(0, tMs / 1000);
    if (target < this.prevT) { // time went backwards: start again
      Object.assign(this, new Demo(this.track));
    }
    while (this.simT + STEP <= target) {
      this.prev = this.cur;
      this.prevT = this.curT;
      this._step(this.simT + STEP);
      this.cur = this.sim.map((s) => this._place(s));
      this.curT = this.simT;
    }
  }

  ready() { return true; }

  _lerp(id, tMs) {
    this.advance(tMs);
    const i = this._index.get(id);
    const a = this.prev[i], b = this.cur[i];
    const f = this.curT > this.prevT ? Math.min(1, Math.max(0, (tMs / 1000 - this.prevT) / (this.curT - this.prevT))) : 1;
    let dh = b.heading - a.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    return { pos: [a.pos[0] + (b.pos[0] - a.pos[0]) * f, a.pos[1] + (b.pos[1] - a.pos[1]) * f, a.pos[2] + (b.pos[2] - a.pos[2]) * f], heading: a.heading + dh * f, kmh: b.kmh };
  }

  sample(id, tMs) { return this._lerp(id, tMs).pos; }

  motion(id, tMs) {
    const s = this._lerp(id, tMs);
    return { dir: [Math.cos(s.heading), 0, Math.sin(s.heading)], kmh: s.kmh };
  }

  order(tMs) {
    this.advance(tMs);
    return this.sim
      .map((s) => ({ id: s.id, total: s.mode === "race" ? s.S : s.mode === "stopped" || s.mode === "crash" ? -1e9 + s.S : s.S }))
      .sort((a, b) => b.total - a.total)
      .map((e, idx) => ({ id: e.id, n: idx + 1 }));
  }
}
