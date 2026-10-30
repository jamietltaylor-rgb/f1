// Keeps cars from drawing on top of each other. Each car is three circles along its length; overlapping pairs are
// pushed apart (a few relaxation passes), and the result is smoothed in time by the caller so nothing jumps.

const R = 1.05; // circle radius, metres
const OFFS = [-1.95, 0, 1.95]; // circle centres along the car, metres from its middle

/** cars: [{ x, z, heading }] heading in the scene's rotation convention (rotation.y). Returns offsets [[dx, dz]]. */
export function separation(cars, maxShift = 4.5) {
  const n = cars.length;
  const off = cars.map(() => [0, 0]);
  const fw = cars.map((c) => [Math.cos(c.heading), -Math.sin(c.heading)]);
  const near = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    if (Math.abs(cars[a].x - cars[b].x) < 9 && Math.abs(cars[a].z - cars[b].z) < 9) near.push([a, b]);
  }
  if (!near.length) return off;
  for (let pass = 0; pass < 8; pass++) {
    let any = false;
    for (const [a, b] of near) {
      const ax = cars[a].x + off[a][0], az = cars[a].z + off[a][1];
      const bx = cars[b].x + off[b][0], bz = cars[b].z + off[b][1];
      for (const oa of OFFS) for (const ob of OFFS) {
        const pax = ax + fw[a][0] * oa, paz = az + fw[a][1] * oa;
        const pbx = bx + fw[b][0] * ob, pbz = bz + fw[b][1] * ob;
        let dx = pax - pbx, dz = paz - pbz;
        let d = Math.hypot(dx, dz);
        const need = 2 * R;
        if (d >= need) continue;
        if (d < 1e-3) { dx = -fw[a][1]; dz = fw[a][0]; d = 1; } // exactly on top: split sideways
        const push = (need - d) / d / 2;
        off[a][0] += dx * push * 0.5; off[a][1] += dz * push * 0.5;
        off[b][0] -= dx * push * 0.5; off[b][1] -= dz * push * 0.5;
        any = true;
      }
    }
    if (!any) break;
  }
  return off.map(([x, z]) => {
    const m = Math.hypot(x, z);
    return m > maxShift ? [(x / m) * maxShift, (z / m) * maxShift] : [x, z];
  });
}
