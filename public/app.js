import * as THREE from "three";
import { createScene } from "./scene.js";
import { SILVERSTONE } from "./silverstone.js";
import { Demo } from "./demo.js";
import { Replay, outlineFromRows } from "./replay.js";
import { getDrivers, getLaps, getLocation, getPositions, listSessions } from "./openf1.js";

const $ = (id) => document.getElementById(id);
const view = createScene($("view"));
window.__view = view; // handy for debugging in the browser console

const CHUNK_MS = 60_000;
let source = null;
let now = 0; // demo: ms since start. replay: epoch ms.
let playing = false;
let speed = 1;
let camMode = "free";
let followId = null;
let followActive = false;
const lastFollow = new THREE.Vector3();
let loadToken = 0;
let sessions = [];

// ---------- status line ----------
let statusTimer = 0;
function status(text, { error = false, sticky = false } = {}) {
  const el = $("status");
  clearTimeout(statusTimer);
  if (!text) { el.classList.remove("on", "err"); return; }
  el.textContent = text;
  el.classList.add("on");
  el.classList.toggle("err", error);
  if (!sticky) statusTimer = setTimeout(() => el.classList.remove("on"), error ? 9000 : 3500);
}

// ---------- sources ----------
function startDemo() {
  loadToken++;
  const pts = SILVERSTONE.points.map(([x, y]) => new THREE.Vector3(x, 0, -y));
  const corners = SILVERSTONE.corners.map(([name, x, y]) => ({ name, x, y: 0, z: -y }));
  const track = view.setTrack(pts, corners);
  view.fitCamera();
  setSource(new Demo(track.curve, track.length));
  now = 0;
  playing = true;
  updatePlayButton();
  status("Silverstone demo: simulated cars. Drag to look around, scroll to zoom.");
}

function setSource(src) {
  source = src;
  view.setCars(src.cars);
  followId = null;
  followActive = false;
  buildDriverList();
  const demo = src.kind === "demo";
  $("scrub").disabled = demo;
  if (demo) now = 0;
  else now = src.startMs;
  updatePlayButton();
}

// ---------- driver list ----------
function buildDriverList() {
  const ol = $("driverList");
  ol.innerHTML = "";
  for (const c of source.cars) {
    const li = document.createElement("li");
    li.dataset.id = c.id;
    li.innerHTML = `<span class="pos"></span><span class="sw" style="background:#${c.colour}"></span><span class="nm"></span>`;
    li.querySelector(".nm").textContent = c.label;
    li.title = c.name + (c.team ? ` · ${c.team}` : "");
    li.addEventListener("click", () => selectCar(c.id, true));
    ol.appendChild(li);
  }
}

function refreshOrder() {
  if (!source) return;
  const ol = $("driverList");
  const items = new Map([...ol.children].map((li) => [li.dataset.id, li]));
  for (const { id, n } of source.order(now)) {
    const li = items.get(id);
    if (!li) continue;
    li.querySelector(".pos").textContent = n ?? "";
    li.classList.toggle("on", id === followId);
    ol.appendChild(li);
  }
}

function selectCar(id, goFollow) {
  followId = id;
  followActive = false;
  if (goFollow) {
    camMode = "follow";
    $("cam").value = "follow";
  }
  refreshOrder();
}

// ---------- loading a real replay ----------
async function loadReplay() {
  const s = sessions[Number($("session").value)];
  if (!s) { status("Pick a session first.", { error: true }); return; }
  const token = ++loadToken;
  const lapNo = Math.max(1, Number($("lap").value) || 1);
  const minutes = Number($("mins").value) || 3;
  $("load").disabled = true;
  playing = false;
  try {
    status("Getting the drivers…", { sticky: true });
    const raw = await getDrivers(s.session_key);
    if (token !== loadToken) return;
    const seen = new Set();
    const drivers = raw.filter((d) => !seen.has(d.driver_number) && seen.add(d.driver_number)).sort((a, b) => a.driver_number - b.driver_number);
    if (!drivers.length) throw new Error("OpenF1 has no driver list for this session yet.");

    status("Finding the lap and the shape of the track…", { sticky: true });
    const laps = await getLaps(s.session_key, drivers[0].driver_number);
    if (token !== loadToken) return;
    const lap = laps.find((l) => l.lap_number === lapNo && l.date_start);
    let startMs;
    if (lap) startMs = Date.parse(lap.date_start);
    else if (lapNo === 1) startMs = Date.parse(s.date_start);
    else throw new Error(`Couldn't find lap ${lapNo} for this session. Try a lower lap number.`);

    const flying = laps
      .filter((l) => l.lap_duration && l.date_start && !l.is_pit_out_lap && l.lap_duration > 40)
      .sort((a, b) => a.lap_duration - b.lap_duration)[0];
    if (!flying) throw new Error("This session has no timed laps in the data yet, so the track shape can't be drawn.");
    const outlineRows = await getLocation(s.session_key, Date.parse(flying.date_start), Date.parse(flying.date_start) + flying.lap_duration * 1000 + 1500, drivers[0].driver_number);
    if (token !== loadToken) return;
    const outline = outlineFromRows(outlineRows);
    if (outline.length < 40) throw new Error("Not enough position data to draw the track yet.");
    view.setTrack(outline.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    view.fitCamera();

    const durationMs = minutes * 60_000;
    const replay = new Replay({ session: s, startMs, durationMs, drivers });
    setSource(replay);

    const chunks = Math.ceil(durationMs / CHUNK_MS);
    for (let i = 0; i < chunks; i++) {
      status(`Loading car positions… ${i + 1} of ${chunks}`, { sticky: true });
      const from = startMs + i * CHUNK_MS;
      const to = Math.min(startMs + durationMs, from + CHUNK_MS);
      const rows = await getLocation(s.session_key, from, to);
      if (token !== loadToken) return;
      replay.addLocation(rows, to);
      if (i === 0) {
        now = startMs;
        playing = true;
        updatePlayButton();
      }
    }
    getPositions(s.session_key, startMs + durationMs).then((rows) => { if (token === loadToken) replay.addPositions(rows); }).catch(() => {});
    status("Loaded. Press play or drag the slider.");
  } catch (e) {
    if (token === loadToken) status(e.message || String(e), { error: true });
  } finally {
    $("load").disabled = false;
  }
}

// ---------- session picker ----------
function fillYears() {
  const y = new Date().getFullYear();
  const sel = $("year");
  for (let i = y; i >= 2023; i--) sel.add(new Option(String(i), String(i)));
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fillSessions() {
  const sel = $("session");
  sel.innerHTML = "";
  const only = $("onlySilverstone").checked;
  const nowMs = Date.now();
  const rows = sessions.filter((s) => Date.parse(s.date_end) < nowMs && (!only || /silverstone/i.test(`${s.circuit_short_name} ${s.location}`)));
  rows.sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
  for (const s of rows) {
    sel.add(new Option(`${s.country_name} · ${s.session_name} · ${fmtDate(s.date_start)}`, String(sessions.indexOf(s))));
  }
  if (!rows.length) sel.add(new Option("No finished sessions found", ""));
}

async function loadSessions() {
  $("session").innerHTML = "<option>Loading sessions…</option>";
  try {
    sessions = await listSessions($("year").value);
    fillSessions();
  } catch (e) {
    sessions = [];
    $("session").innerHTML = "<option value=''>Couldn't load sessions</option>";
    status(e.message, { error: true });
  }
}

async function latestSession() {
  try {
    status("Looking for the newest finished session…", { sticky: true });
    $("onlySilverstone").checked = false;
    let y = new Date().getFullYear();
    for (; y >= 2023; y--) {
      $("year").value = String(y);
      sessions = await listSessions(y);
      const done = sessions.filter((s) => Date.parse(s.date_end) < Date.now());
      if (done.length) break;
    }
    fillSessions();
    if (!$("session").value) throw new Error("No finished sessions found.");
    loadReplay();
  } catch (e) {
    status(e.message, { error: true });
  }
}

// ---------- controls ----------
function updatePlayButton() {
  $("play").textContent = playing ? "Pause" : "Play";
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

$("picker").addEventListener("submit", (e) => { e.preventDefault(); loadReplay(); });
$("year").addEventListener("change", loadSessions);
$("onlySilverstone").addEventListener("change", fillSessions);
$("latest").addEventListener("click", latestSession);
$("demo").addEventListener("click", startDemo);
$("play").addEventListener("click", () => { playing = !playing; updatePlayButton(); });
$("speed").addEventListener("change", (e) => { speed = Number(e.target.value); });
$("size").addEventListener("input", (e) => view.setCarScale(Number(e.target.value)));
$("reset").addEventListener("click", () => {
  camMode = "free";
  $("cam").value = "free";
  followActive = false;
  view.fitCamera();
});
$("cam").addEventListener("change", (e) => {
  camMode = e.target.value;
  followActive = false;
  if (camMode === "follow" && !followId && source) selectCar(source.order(now)[0]?.id ?? source.cars[0]?.id, false);
});
$("hideDrivers").addEventListener("click", () => $("drivers").classList.toggle("collapsed"));
$("scrub").addEventListener("input", (e) => {
  if (!source || source.kind !== "replay") return;
  const want = source.startMs + (Number(e.target.value) / 1000) * source.durationMs;
  now = Math.min(want, source.loadedUntil - 300);
  followActive = false;
});
window.addEventListener("keydown", (e) => {
  if (e.target.matches("input,select,textarea")) return;
  if (e.code === "Space") { e.preventDefault(); playing = !playing; updatePlayButton(); }
});

// click a car to follow it
let down = null;
$("view").addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
$("view").addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  const id = view.pick(e.clientX, e.clientY);
  if (id) selectCar(id, true);
});

// ---------- main loop ----------
let prev = performance.now();
let orderAt = 0;
function frame(t) {
  const dt = Math.min(0.1, (t - prev) / 1000);
  prev = t;
  if (source) {
    const isReplay = source.kind === "replay";
    if (playing) {
      const next = now + dt * 1000 * speed;
      if (isReplay) {
        const end = source.startMs + source.durationMs;
        if (next >= end) { now = end; playing = false; updatePlayButton(); }
        else if (source.ready(next + 200)) now = next;
        else status("Buffering…", { sticky: true });
      } else now = next;
    }
    for (const c of source.cars) {
      const p = source.sample(c.id, now);
      const m = p ? source.motion(c.id, now) : null;
      view.placeCar(c.id, p, m?.dir);
    }
    followCamera();
    if (isReplay) {
      const f = (now - source.startMs) / source.durationMs;
      if (document.activeElement !== $("scrub")) $("scrub").value = String(Math.round(f * 1000));
      $("clock").textContent = `${fmt(now - source.startMs)} / ${fmt(source.durationMs)}`;
    } else $("clock").textContent = `Demo ${fmt(now)}`;
    if (t - orderAt > 500) { orderAt = t; refreshOrder(); }
  }
  view.render();
  requestAnimationFrame(frame);
}

function followCamera() {
  if (camMode !== "follow" || !followId) { $("hud").textContent = ""; return; }
  const c = view.cars.get(followId);
  if (!c || !c.root.visible) return;
  const m = source.motion(followId, now);
  $("hud").textContent = m ? `${c.info.label} ${Math.round(m.kmh)} km/h` : c.info.label;
  if (!followActive) {
    const k = view.carScale / 3;
    const fwd = new THREE.Vector3(Math.cos(c.heading), 0, -Math.sin(c.heading));
    view.camera.position.copy(c.pos).addScaledVector(fwd, -26 * k).add(new THREE.Vector3(0, 9 * k, 0));
    view.controls.target.copy(c.pos);
    lastFollow.copy(c.pos);
    followActive = true;
    return;
  }
  const delta = c.pos.clone().sub(lastFollow);
  view.camera.position.add(delta);
  view.controls.target.add(delta);
  lastFollow.copy(c.pos);
}

// ---------- start ----------
fillYears();
startDemo();
requestAnimationFrame(frame);
loadSessions();
