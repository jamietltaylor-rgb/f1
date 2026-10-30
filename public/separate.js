// Keeps cars from drawing on top of each other. Each car is two circles (front and rear); overlapping pairs are
// nudged apart sideways-ish by half the overlap each, and the nudge is smoothed in time so nothing jumps.

const R = 1.15; // circle radius, metres
const OFF = 1.7; // circle centre distance from car centre along its heading

/** cars: [{ x, z, heading }] heading in the scene's rotation convention (rotation.y). Returns target offsets [[dx, dz]]. */
export function separation(cars, maxShift = 1.6) {
  const out = cars.map(() => [0, 0]);
  const pts = cars.map((c) => {
    const fx = Math.cos(c.heading), fz = -Math.sin(c.heading);
    return [[c.x + fx * OFF, c.z + fz * OFF], [c.x - fx * OFF, c.z - fz * OFF]];
  });
  for (let a = 0; a < cars.length; a++) {
    for (let b = a + 1; b < cars.length; b++) {
      if (Math.abs(cars[a].x - cars[b].x) > 8 || Math.abs(cars[a].z - cars[b].z) > 8) continue;
      for (const pa of pts[a]) for (const pb of pts[b]) {
        let dx = pa[0] - pb[0], dz = pa[1] - pb[1];
        let d = Math.hypot(dx, dz);
        const need = 2 * R;
        if (d >= need) continue;
        if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
        const push = (need - d) / 2 / d;
        out[a][0] += dx * push * 0.5; out[a][1] += dz * push * 0.5;
        out[b][0] -= dx * push * 0.5; out[b][1] -= dz * push * 0.5;
      }
    }
  }
  return out.map(([x, z]) => {
    const m = Math.hypot(x, z);
    return m > maxShift ? [(x / m) * maxShift, (z / m) * maxShift] : [x, z];
  });
}
