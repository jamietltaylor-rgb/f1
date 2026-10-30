// Small client for the free OpenF1 API (https://openf1.org). Historical data needs no key.
// Requests go through one queue with a gap between them, because the free tier is rate limited.

const BASE = "https://api.openf1.org/v1";
const FAST = new URLSearchParams(location.search).has("fast"); // used by tests only
const GAP_MS = FAST ? 0 : 1100;

let chain = Promise.resolve();
let lastAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const iso = (ms) => encodeURIComponent(new Date(ms).toISOString());

export function get(endpoint, params) {
  const job = chain.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    for (let attempt = 0; ; attempt++) {
      lastAt = Date.now();
      let res;
      try {
        res = await fetch(`${BASE}/${endpoint}?${params.join("&")}`);
      } catch {
        throw new Error("Couldn't reach OpenF1. Check your internet connection and try again.");
      }
      if (res.status === 429 && attempt < 5) {
        await sleep(2500 * (attempt + 1));
        continue;
      }
      if (res.status === 404) return [];
      if (res.status === 401 || res.status === 403) {
        throw new Error("OpenF1 only shares live data with paid accounts. A finished session's replay data usually appears a little while after it ends, so try again later.");
      }
      if (!res.ok) {
        let detail = "";
        try { detail = (await res.json()).detail || ""; } catch { /* ignore */ }
        throw new Error(`OpenF1 said no (${res.status}). ${typeof detail === "string" ? detail : ""}`.trim());
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    }
  });
  chain = job.catch(() => {});
  return job;
}

export const listSessions = (year) => get("sessions", [`year=${year}`]);
export const getDrivers = (sk) => get("drivers", [`session_key=${sk}`]);
export const getLaps = (sk, driver) => get("laps", [`session_key=${sk}`, `driver_number=${driver}`]);
export const getLocation = (sk, fromMs, toMs, driver) =>
  get("location", [`session_key=${sk}`, ...(driver ? [`driver_number=${driver}`] : []), `date>=${iso(fromMs)}`, `date<${iso(toMs)}`]);
export const getPositions = (sk, toMs) => get("position", [`session_key=${sk}`, `date<${iso(toMs)}`]);
export const getRaceControl = (sk) => get("race_control", [`session_key=${sk}`]);
