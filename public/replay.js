// Holds the position data for one replay and answers "where is car X at time t?".
// OpenF1 positions are in tenths of a metre: x east, y north, z up.

const SCALE = 0.1;
export const toWorld = (r) => [r.x * SCALE, r.z * SCALE, -r.y * SCALE]; // three.js: x east, y up, z south

export class Replay {
  constructor({ session, startMs, durationMs, drivers }) {
    this.kind = "replay";
    this.session = session;
    this.startMs = startMs;
    this.durationMs = durationMs;
    this.loadedUntil = startMs;
    this.cars = drivers.map((d) => ({
      id: String(d.driver_number),
      label: d.name_acronym || String(d.driver_number),
      name: d.full_name || d.name_acronym,
      team: d.team_name || "",
      colour: d.team_colour || "888888",
    }));
    this.data = new Map(this.cars.map((c) => [c.id, { t: [], p: [] }]));
    this.pos = new Map(); // id -> { t: [], n: [] } running order
  }

  addLocation(rows, loadedUntilMs) {
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const r of rows) {
      const d = this.data.get(String(r.driver_number));
      if (!d || r.x == null || r.y == null) continue;
      const t = Date.parse(r.date);
      if (!Number.isFinite(t)) continue;
      d.t.push(t);
      d.p.push(toWorld({ x: r.x, y: r.y, z: r.z ?? 0 }));
    }
    this.loadedUntil = Math.max(this.loadedUntil, loadedUntilMs);
  }

  addPositions(rows) {
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const r of rows) {
      const id = String(r.driver_number);
      if (!this.pos.has(id)) this.pos.set(id, { t: [], n: [] });
      const e = this.pos.get(id);
      e.t.push(Date.parse(r.date));
      e.n.push(r.position);
    }
  }

  ready(tMs) {
    return tMs <= this.loadedUntil;
  }

  sample(id, tMs) {
    const d = this.data.get(id);
    if (!d || !d.t.length) return null;
    const { t, p } = d;
    if (tMs <= t[0]) return tMs < t[0] - 5000 ? null : p[0];
    const last = t.length - 1;
    if (tMs >= t[last]) return p[last];
    let lo = 0, hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= tMs) lo = mid; else hi = mid;
    }
    const gap = t[hi] - t[lo];
    if (gap > 4000) return p[lo]; // missing data: hold still rather than glide across the map
    const f = (tMs - t[lo]) / gap;
    const a = p[lo], b = p[hi];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  /** Direction of travel and speed in km/h, from a short look either side of t. */
  motion(id, tMs) {
    const a = this.sample(id, tMs - 200), b = this.sample(id, tMs + 200);
    if (!a || !b) return null;
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    return { dir: d, kmh: (Math.hypot(d[0], d[1], d[2]) / 0.4) * 3.6 };
  }

  order(tMs) {
    const out = [];
    for (const c of this.cars) {
      const e = this.pos.get(c.id);
      let n = 99;
      if (e && e.t.length) {
        let lo = -1;
        for (let i = 0, j = e.t.length - 1; i <= j;) {
          const m = (i + j) >> 1;
          if (e.t[m] <= tMs) { lo = m; i = m + 1; } else j = m - 1;
        }
        if (lo >= 0) n = e.n[lo];
        else n = e.n[0];
      }
      out.push([c.id, n]);
    }
    out.sort((x, y) => x[1] - y[1]);
    return out.map(([id, n]) => ({ id, n: n === 99 ? null : n }));
  }
}

/** Turn one car's raw location rows for a lap into a closed centre line (world coords, ~every 8 m). */
export function outlineFromRows(rows) {
  rows = rows.filter((r) => r.x != null && r.y != null && !(r.x === 0 && r.y === 0 && r.z === 0));
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  const pts = [];
  let last = null;
  for (const r of rows) {
    const p = toWorld({ x: r.x, y: r.y, z: r.z ?? 0 });
    if (!last || Math.hypot(p[0] - last[0], p[2] - last[2]) >= 8) {
      pts.push(p);
      last = p;
    }
  }
  // drop a seam overlap at the end if the lap runs past the start line
  while (pts.length > 10 && Math.hypot(pts.at(-1)[0] - pts[0][0], pts.at(-1)[2] - pts[0][2]) < 6) pts.pop();
  // light smoothing, because GPS-derived positions are slightly noisy
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    return [0, 1, 2].map((k) => (a[k] + 2 * p[k] + b[k]) / 4);
  });
}

// ---------- crash detection ----------
// OpenF1 has no "crash" flag, so a crash is inferred from the movement data: a car doing 110+ km/h that is
// almost stopped within 4.5 s and then stays stopped for 8 s. Stops in the pit area are ignored by the caller,
// and a sudden stop is a crash, confirmed when race control also mentions that car around that time. A slow stop is only reported as 'stopped' if race control mentions the car.

/** t: ms timestamps, p: world positions [x,y,z]. Returns [{ t, pos, until }] */
export function findStops(t, p) {
  const n = t.length;
  const v = new Float32Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const dt = (t[i] - t[i - 1]) / 1000;
    if (dt > 0 && dt < 2.5) v[i] = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]) / dt;
  }
  const out = [];
  let i = 1;
  while (i < n) {
    if (!(v[i] >= 30)) { i++; continue; }
    const limit = t[i] + 4500;
    let stop = -1;
    for (let j = i + 1; j < n && t[j] <= limit; j++) if (v[j] <= 5) { stop = j; break; }
    if (stop < 0) { i++; continue; }
    const need = t[stop] + 8000;
    let k = stop, still = true;
    for (; k < n && t[k] <= need; k++) if (v[k] > 4) { still = false; break; }
    if (!still) { i = stop + 1; continue; }
    if (k >= n && t[n - 1] < need) { i++; continue; } // not enough data after the stop yet
    let m = k;
    while (m < n && !(v[m] > 10)) m++;
    // how violent was it? average slow-down from the fastest point in the 3 s before the stop
    let jp = stop;
    for (let j = stop; j >= 0 && t[j] >= t[stop] - 3000; j--) if (v[j] > v[jp] || !(v[jp] >= 0)) jp = j;
    const secs = Math.max(0.25, (t[stop] - t[jp]) / 1000);
    const hard = (v[jp] - v[stop]) / secs >= 12;
    out.push({ t: t[stop], pos: p[stop], until: m < n ? t[m] : Infinity, hard });
    i = Math.max(k, stop + 1);
  }
  return out;
}

Replay.prototype.detectCrashes = function (isInPits, notes = []) {
  const events = [];
  for (const c of this.cars) {
    const d = this.data.get(c.id);
    if (!d || d.t.length < 10) continue;
    for (const s of findStops(d.t, d.p)) {
      if (isInPits(s.pos)) continue;
      const num = Number(c.id);
      const confirmed = notes.some((r) => Math.abs(Date.parse(r.date) - s.t) <= 90_000 && Number(r.driver_number) === num && /STOPPED|INCIDENT|COLLISION|CONTACT|SPUN|CRASH|OFF TRACK|RETIRE/i.test(String(r.message || "")));
      if (!s.hard && !confirmed) continue; // coasting to a halt is a breakdown, not worth shouting about
      const level = s.hard ? (confirmed ? 2 : 1) : 3;
      events.push({ id: c.id, label: c.label, t: s.t, until: s.until, confirmed, level });
    }
  }
  events.sort((a, b) => a.t - b.t);
  this.events = events;
};

Replay.prototype.events = [];
