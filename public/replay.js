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
