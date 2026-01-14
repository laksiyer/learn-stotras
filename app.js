// app.js — Learn Stotras (Practice engine + Theme + Script + Compare A/B)
// Drop-in replacement. Requires IDs present in your current index.html.

const $ = (id) => document.getElementById(id);

// ---------------- DOM ----------------
// Header
const brandTitle = $("brandTitle");
const brandSub = $("brandSub");

// Top controls
const stotraSelect = $("stotraSelect");
const themeSelect = $("themeSelect");
const scriptSelect = $("scriptSelect");

// Left panel
const prevVerse = $("prevVerse");
const nextVerse = $("nextVerse");
const verseSelect = $("verseSelect");
const meterBox = $("meterBox");

const practiceSet = $("practiceSet");
const applySet = $("applySet");
const clearSet = $("clearSet");
const setIndicator = $("setIndicator");

const repSingle = $("repSingle");
const repPairs = $("repPairs");
const repFull = $("repFull");
const speed = $("speed");

const repSingleVal = $("repSingleVal");
const repPairsVal = $("repPairsVal");
const repFullVal = $("repFullVal");
const speedVal = $("speedVal");

const usePractice = $("usePractice");
const totalPlaysBox = $("totalPlays");

const startBtn = $("startBtn");
const stopBtn = $("stopBtn");

// Right panel
const fullLine = $("fullLine");
const pada1 = $("pada1");
const pada2 = $("pada2");
const pada3 = $("pada3");
const pada4 = $("pada4");

const singleButtons = $("singleButtons");
const playP1 = $("playP1");
const playP2 = $("playP2");
const playP3 = $("playP3");
const playP4 = $("playP4");
const playP12 = $("playP12");
const playP34 = $("playP34");
const playFull = $("playFull");

const arthaSa = $("arthaSa");
const meaningEn = $("meaningEn");

const statusBox = $("status");
const player = $("player");

// Compare UI (optional)
const compareBox = $("compareBox");
const compareTake = $("compareTake");
const recMine = $("recMine");
const stopMine = $("stopMine");
const playMine = $("playMine");
const compareAB = $("compareAB");
const clearMine = $("clearMine");
const compareStatus = $("compareStatus");

const compareEnabled =
  !!compareBox && !!compareTake && !!recMine && !!stopMine &&
  !!playMine && !!compareAB && !!clearMine && !!compareStatus;

// ---------------- State ----------------
let stotraIndex = null; // stotras/index.json
let stotra = null;      // current stotra.json
let verses = [];        // current verses.json
let current = null;     // current verse object

let stopRequested = false;

// ---------------- Utilities ----------------
function setStatus(msg) {
  if (statusBox) statusBox.textContent = msg;
}

function setCompareStatus(msg) {
  if (compareEnabled) compareStatus.textContent = msg;
}

async function fetchJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
  return await r.json();
}

function normalizePath(p) {
  return (p || "").replace(/\/{2,}/g, "/");
}

function setPlaybackRate() {
  const r = Number(speed?.value || 1);
  player.playbackRate = r;
  minePlayer.playbackRate = r;
}

function toBadge(n, decimals = 0) {
  if (decimals === 0) return `${n}×`;
  return `${Number(n).toFixed(decimals)}×`;
}

function updateBadges() {
  if (repSingleVal) repSingleVal.textContent = toBadge(repSingle.value);
  if (repPairsVal) repPairsVal.textContent = toBadge(repPairs.value);
  if (repFullVal) repFullVal.textContent = toBadge(repFull.value);
  if (speedVal) speedVal.textContent = toBadge(speed.value, 2);
}

// ---------------- Theme ----------------
function applyTheme(themeValue) {
  // Your CSS uses :root for dark default and html[data-theme="..."] for others
  if (!themeValue || themeValue === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", themeValue);
  }
  localStorage.setItem("learnstotras_theme", themeValue || "dark");
}

function initTheme() {
  if (!themeSelect) return;
  const saved = localStorage.getItem("learnstotras_theme");
  if (saved) themeSelect.value = saved;
  applyTheme(themeSelect.value);
  themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));
}

// ---------------- Script switching (Aksharamukha lazy) ----------------
let akInstance = null;
let akLoading = null;
const translitCache = new Map();

async function loadAksharamukha() {
  if (akInstance) return akInstance;
  if (akLoading) return akLoading;

  akLoading = new Promise((resolve, reject) => {
    if (window.Aksharamukha?.new) {
      window.Aksharamukha.new().then(inst => { akInstance = inst; resolve(inst); }).catch(reject);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/aksharamukha@latest/dist/index.global.js";
    s.onload = async () => {
      try {
        akInstance = await window.Aksharamukha.new();
        resolve(akInstance);
      } catch (e) { reject(e); }
    };
    s.onerror = () => reject(new Error("Failed to load Aksharamukha"));
    document.head.appendChild(s);
  });

  return akLoading;
}

async function translit(text, toScript) {
  if (!text || toScript === "Devanagari") return text;
  const key = `${toScript}::${text}`;
  if (translitCache.has(key)) return translitCache.get(key);
  const ak = await loadAksharamukha();
  const out = await ak.process("autodetect", toScript, text);
  translitCache.set(key, out);
  return out;
}

function initScriptSelect() {
  if (!scriptSelect) return;
  const saved = localStorage.getItem("learnstotras_script");
  if (saved) scriptSelect.value = saved;

  scriptSelect.addEventListener("change", () => {
    localStorage.setItem("learnstotras_script", scriptSelect.value);
    if (current) loadVerse(current); // rerender text only
  });
}

// ---------------- Audio paths ----------------
function audioFor(key) {
  if (!current) return null;

  const file =
    key === "p12" ? current.audio?.p12 :
    key === "p34" ? current.audio?.p34 :
    key === "full" ? current.audio?.full :
    current.audio?.[key];

  if (!file) return null;

  const base = (stotra?.audioBase || "").replace(/\/$/, "");
  return base ? `${base}/${file}` : file;
}

function playWith(audioEl, src) {
  return new Promise((resolve) => {
    if (!src) return resolve();

    audioEl.pause();
    audioEl.currentTime = 0;
    audioEl.src = normalizePath(src);
    setPlaybackRate();

    const cleanup = () => {
      audioEl.removeEventListener("ended", onEnd);
      audioEl.removeEventListener("error", onErr);
    };
    const onEnd = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); resolve(); };

    audioEl.addEventListener("ended", onEnd);
    audioEl.addEventListener("error", onErr);

    audioEl.play().catch(() => { cleanup(); resolve(); });
  });
}

function playSrc(src) {
  return playWith(player, src);
}

// ---------------- Practice set parsing ----------------
function parsePracticeSet(str) {
  const s = (str || "").trim();
  if (!s) return null;

  const parts = s.split(",").map(x => x.trim()).filter(Boolean);
  const out = new Set();

  for (const p of parts) {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (let i = lo; i <= hi; i++) out.add(String(i));
    } else {
      out.add(p);
    }
  }
  return out;
}

function resolvePracticeSetToVerseIds(set, versesArr) {
  if (!set) return versesArr.map(v => v.id);

  // if all numeric, treat as 1-based indices
  const numericOnly = [...set].every(x => /^\d+$/.test(x));
  if (numericOnly) {
    const ids = [];
    for (const x of set) {
      const i = Number(x);
      if (i >= 1 && i <= versesArr.length) ids.push(versesArr[i - 1].id);
    }
    return ids.length ? ids : versesArr.map(v => v.id);
  }

  // otherwise treat as explicit IDs
  const byId = new Set(versesArr.map(v => v.id));
  const ids = [];
  for (const x of set) if (byId.has(x)) ids.push(x);
  return ids.length ? ids : versesArr.map(v => v.id);
}

// ---------------- Practice counting ----------------
function computeTotalPlaysForVerse(v) {
  const nSingle = Number(repSingle.value);
  const nPairs  = Number(repPairs.value);
  const nFull   = Number(repFull.value);

  const mode = (v.mode || "normal");

  if (mode === "full_only") {
    // "singles" are treated as full repeats
    return nSingle;
  }

  // Singles: either 4 (p1..p4) or 2 (p12,p34) if split-practice
  const splitSingles = !!v.needsSplitPractice;
  const singlesUnits = splitSingles ? 2 : 4;
  const singlesPlays = singlesUnits * nSingle;

  const hasP12 = !!(v.audio?.p12);
  const hasP34 = !!(v.audio?.p34);
  const pairUnits = (hasP12 ? 1 : 0) + (hasP34 ? 1 : 0);
  const pairPlays = pairUnits * nPairs;

  return singlesPlays + pairPlays + nFull;
}

function updateTotalPlaysForRun() {
  if (!totalPlaysBox) return;
  const set = parsePracticeSet(practiceSet?.value || "");
  const ids = resolvePracticeSetToVerseIds(set, verses);
  let total = 0;
  for (const id of ids) {
    const v = verses.find(x => x.id === id);
    if (v) total += computeTotalPlaysForVerse(v);
  }
  totalPlaysBox.textContent = String(total);
}

// ---------------- Verse rendering ----------------
async function renderVerseText(v) {
  const script = scriptSelect?.value || "Devanagari";

  meterBox.textContent = v.meter || "—";
  fullLine.textContent = await translit(v.full || "—", script);

  const baseText = v.text || {};
  const prText = v.practice || baseText;
  const t = usePractice?.checked ? prText : baseText;

  pada1.textContent = await translit(t.p1 || "", script);
  pada2.textContent = await translit(t.p2 || "", script);
  pada3.textContent = await translit(t.p3 || "", script);
  pada4.textContent = await translit(t.p4 || "", script);

  arthaSa.textContent = v.gloss?.sa || "";
  meaningEn.textContent = v.gloss?.en || "";
}

function populateVerseDropdown() {
  verseSelect.innerHTML = "";
  verses.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.title || v.id;
    verseSelect.appendChild(opt);
  });
}

function selectVerseByIndex(idx) {
  if (!verses.length) return;
  const i = Math.max(0, Math.min(idx, verses.length - 1));
  verseSelect.selectedIndex = i;
  loadVerse(verses[i]);
}

function selectVerseById(id) {
  const idx = verses.findIndex(v => v.id === id);
  if (idx >= 0) selectVerseByIndex(idx);
}

// ---------------- Verse load ----------------
async function loadVerse(v) {
  current = v;
  current.mode = current.mode || "normal";

  brandTitle.textContent = stotra?.title || "Learn Stotras";
  brandSub.textContent = stotra?.subtitle || "पद → द्विपद → श्लोक अभ्यासः";

  await renderVerseText(v);

  const mode = current.mode;
  const split = !!current.needsSplitPractice;

  // Show singles row only if normal and not split-practice
  singleButtons.style.display = (mode === "full_only" || split) ? "none" : "";

  playP1.disabled = (mode === "full_only" || split || !current.audio?.p1);
  playP2.disabled = (mode === "full_only" || split || !current.audio?.p2);
  playP3.disabled = (mode === "full_only" || split || !current.audio?.p3);
  playP4.disabled = (mode === "full_only" || split || !current.audio?.p4);

  playP12.disabled = (mode === "full_only" || !current.audio?.p12);
  playP34.disabled = (mode === "full_only" || !current.audio?.p34);
  playFull.disabled = (!current.audio?.full);

  updateTotalPlaysForRun();
  setStatus("Ready.");

  refreshCompareUI();
}

// ---------------- Practice run ----------------
function getSinglesKeysForVerse(v) {
  const mode = (v.mode || "normal");
  if (mode === "full_only") return ["full"];
  if (v.needsSplitPractice) return ["p12", "p34"];
  return ["p1", "p2", "p3", "p4"];
}

async function runPracticeForVerse(v) {
  const singles = getSinglesKeysForVerse(v);

  // Singles
  for (const key of singles) {
    const src = (key === "full") ? audioFor("full") : audioFor(key);
    if (!src) continue;

    for (let i = 0; i < Number(repSingle.value); i++) {
      if (stopRequested) return;
      await playSrc(src);
    }
  }

  // Pairs (skip for full_only)
  if ((v.mode || "normal") !== "full_only") {
    for (let i = 0; i < Number(repPairs.value); i++) {
      if (stopRequested) return;
      const src12 = audioFor("p12");
      if (src12) await playSrc(src12);
      const src34 = audioFor("p34");
      if (src34) await playSrc(src34);
    }
  }

  // Full
  for (let i = 0; i < Number(repFull.value); i++) {
    if (stopRequested) return;
    const src = audioFor("full");
    if (src) await playSrc(src);
  }
}

async function startPracticeRun() {
  stopRequested = false;
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;

  const set = parsePracticeSet(practiceSet.value);
  const ids = resolvePracticeSetToVerseIds(set, verses);

  setStatus("Starting…");

  for (const id of ids) {
    if (stopRequested) break;
    const v = verses.find(x => x.id === id);
    if (!v) continue;
    selectVerseById(id);
    setStatus(`Practicing: ${v.title || v.id}`);
    await runPracticeForVerse(v);
  }

  if (stopBtn) stopBtn.disabled = true;
  if (startBtn) startBtn.disabled = false;
  setStatus(stopRequested ? "Stopped." : "Done.");
}

function stopPracticeRun() {
  stopRequested = true;
  player.pause();
  player.currentTime = 0;
  if (stopBtn) stopBtn.disabled = true;
  if (startBtn) startBtn.disabled = false;
  setStatus("Stopping…");
}

// ---------------- Compare (Self-record A/B) ----------------
let mediaRecorder = null;
let recordingChunks = [];
let recordingStream = null;

let mineObjectURL = null;
const minePlayer = new Audio();
minePlayer.preload = "auto";

const DB_NAME = "learn-stotras";
const DB_VER = 1;
const STORE = "userRecordings";

function dbKey(stotraId, verseId, take) {
  return `${stotraId}::${verseId}::${take}`;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const req = st.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function dbPut(obj) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(obj);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

async function dbDel(key) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

function revokeMineURL() {
  if (mineObjectURL) {
    URL.revokeObjectURL(mineObjectURL);
    mineObjectURL = null;
  }
}

async function getMineBlobForCurrent(take) {
  if (!compareEnabled || !current) return null;
  const stotraId = stotraSelect.value;
  const key = dbKey(stotraId, current.id, take);
  const rec = await dbGet(key);
  return rec?.blob || null;
}

async function refreshCompareUI() {
  if (!compareEnabled || !current) return;

  const take = compareTake.value;
  const ref = audioFor(take);
  const blob = await getMineBlobForCurrent(take);

  playMine.disabled = !blob;
  clearMine.disabled = !blob;
  compareAB.disabled = !(blob && ref);

  const hasRecorder = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  recMine.disabled = !hasRecorder;
  if (!hasRecorder) {
    setCompareStatus("Recording not supported in this browser.");
    return;
  }

  setCompareStatus(
    blob
      ? `Saved recording exists for ${current.id} (${take.toUpperCase()}).`
      : `No saved recording for ${current.id} (${take.toUpperCase()}).`
  );
}

function pickBestMimeType() {
  // Better mobile coverage: mp4/aac first, then webm/ogg
  const candidates = [
    "audio/mp4",
    "audio/aac",
    "audio/mpeg",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

async function startMineRecording() {
  if (!compareEnabled || !current) return;

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setCompareStatus("Recording not supported in this browser.");
    return;
  }

  // Stop playback to reduce feedback
  try { player.pause(); } catch {}
  try { minePlayer.pause(); } catch {}

  if (mediaRecorder && mediaRecorder.state === "recording") return;

  setCompareStatus("Requesting microphone permission…");

  const take = compareTake.value;
  const stotraId = stotraSelect.value;
  recordingChunks = [];

  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    const mimeType = pickBestMimeType();
    mediaRecorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordingChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      try { recordingStream?.getTracks()?.forEach(t => t.stop()); } catch {}
      recordingStream = null;

      const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const key = dbKey(stotraId, current.id, take);

      await dbPut({ key, stotraId, verseId: current.id, take, updated: Date.now(), blob });

      recMine.classList.remove("recording");
      recMine.disabled = false;
      stopMine.disabled = true;

      setCompareStatus(`Saved: ${current.id} (${take.toUpperCase()}).`);
      await refreshCompareUI();
    };

    mediaRecorder.start();

    recMine.disabled = true;
    stopMine.disabled = false;
    recMine.classList.add("recording");
    setCompareStatus(`Recording… ${current.id} (${take.toUpperCase()})`);
  } catch (err) {
    try { recordingStream?.getTracks()?.forEach(t => t.stop()); } catch {}
    recordingStream = null;
    mediaRecorder = null;

    recMine.classList.remove("recording");
    recMine.disabled = false;
    stopMine.disabled = true;

    setCompareStatus(`Mic error: ${err?.message || err}`);
  }
}

function stopMineRecording() {
  if (!compareEnabled) return;
  try {
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  } catch {}
}

async function playMineSrc(src) {
  return playWith(minePlayer, src);
}

async function playMineRecording() {
  if (!compareEnabled || !current) return;

  const take = compareTake.value;
  const blob = await getMineBlobForCurrent(take);
  if (!blob) { setCompareStatus("No saved recording yet."); return; }

  revokeMineURL();
  mineObjectURL = URL.createObjectURL(blob);

  setCompareStatus(`Playing mine: ${current.id} (${take.toUpperCase()})`);
  await playMineSrc(mineObjectURL);
  setCompareStatus("Ready.");
}

async function compareABPlay() {
  if (!compareEnabled || !current) return;

  const take = compareTake.value;
  const refSrc = audioFor(take);
  const blob = await getMineBlobForCurrent(take);

  if (!refSrc) { setCompareStatus("Reference audio missing for this segment."); return; }
  if (!blob) { setCompareStatus("No saved recording yet."); return; }

  revokeMineURL();
  mineObjectURL = URL.createObjectURL(blob);

  setCompareStatus(`A→B compare: ${take.toUpperCase()} (Reference → Mine)`);
  await playSrc(refSrc);
  await playMineSrc(mineObjectURL);
  setCompareStatus("Ready.");
}

async function clearMineRecording() {
  if (!compareEnabled || !current) return;
  const take = compareTake.value;
  const stotraId = stotraSelect.value;
  const key = dbKey(stotraId, current.id, take);

  await dbDel(key);
  revokeMineURL();
  setCompareStatus(`Cleared: ${current.id} (${take.toUpperCase()})`);
  await refreshCompareUI();
}

// ---------------- Load stotra ----------------
async function loadStotra(stotraId) {
  const entry = stotraIndex.stotras.find(s => s.id === stotraId);
  if (!entry) throw new Error(`Unknown stotra id: ${stotraId}`);

  stotra = await fetchJSON(entry.path);
  verses = await fetchJSON(stotra.versesPath);

  brandTitle.textContent = stotra.title || "Learn Stotras";
  brandSub.textContent = stotra.subtitle || "पद → द्विपद → श्लोक अभ्यासः";

  populateVerseDropdown();
  selectVerseByIndex(0);
  updateTotalPlaysForRun();

  setStatus("Loaded.");
  await refreshCompareUI();
}

// ---------------- Init ----------------
async function init() {
  updateBadges();
  initTheme();
  initScriptSelect();

  setPlaybackRate();

  // Populate stotra selector
  stotraIndex = await fetchJSON("stotras/index.json");
  stotraSelect.innerHTML = "";
  stotraIndex.stotras.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.title || s.id;
    stotraSelect.appendChild(opt);
  });

  const initial = stotraIndex.stotras[0]?.id;
  if (!initial) throw new Error("No stotras in stotras/index.json");

  stotraSelect.value = initial;
  await loadStotra(initial);

  // -------- Event wiring (THIS is what was missing) --------
  stotraSelect.addEventListener("change", async () => {
    setStatus("Loading…");
    await loadStotra(stotraSelect.value);
  });

  verseSelect.addEventListener("change", () => selectVerseById(verseSelect.value));
  prevVerse.addEventListener("click", () => selectVerseByIndex(verseSelect.selectedIndex - 1));
  nextVerse.addEventListener("click", () => selectVerseByIndex(verseSelect.selectedIndex + 1));

  // Apply/Clear practice set
  applySet.addEventListener("click", () => {
    const set = parsePracticeSet(practiceSet.value);
    setIndicator.textContent = set ? "Practice set applied." : "";
    updateTotalPlaysForRun();
  });

  clearSet.addEventListener("click", () => {
    practiceSet.value = "";
    setIndicator.textContent = "";
    updateTotalPlaysForRun();
  });

  // Sliders
  repSingle.addEventListener("input", () => { updateBadges(); updateTotalPlaysForRun(); });
  repPairs.addEventListener("input", () => { updateBadges(); updateTotalPlaysForRun(); });
  repFull.addEventListener("input", () => { updateBadges(); updateTotalPlaysForRun(); });
  speed.addEventListener("input", () => { updateBadges(); setPlaybackRate(); });

  // Practice text toggle
  usePractice.addEventListener("change", () => { if (current) loadVerse(current); });

  // Start/Stop practice
  startBtn.addEventListener("click", startPracticeRun);
  stopBtn.addEventListener("click", stopPracticeRun);

  // Playback buttons
  playP1.addEventListener("click", async () => await playSrc(audioFor("p1")));
  playP2.addEventListener("click", async () => await playSrc(audioFor("p2")));
  playP3.addEventListener("click", async () => await playSrc(audioFor("p3")));
  playP4.addEventListener("click", async () => await playSrc(audioFor("p4")));
  playP12.addEventListener("click", async () => await playSrc(audioFor("p12")));
  playP34.addEventListener("click", async () => await playSrc(audioFor("p34")));
  playFull.addEventListener("click", async () => await playSrc(audioFor("full")));

  // Compare wiring
  if (compareEnabled) {
    stopMine.disabled = true;

    compareTake.addEventListener("change", refreshCompareUI);
    recMine.addEventListener("click", startMineRecording);
    stopMine.addEventListener("click", stopMineRecording);
    playMine.addEventListener("click", playMineRecording);
    compareAB.addEventListener("click", compareABPlay);
    clearMine.addEventListener("click", clearMineRecording);

    refreshCompareUI();
  }

  setStatus("Loaded.");
}

init().catch(err => {
  console.error(err);
  setStatus(`Init failed: ${err.message}`);
});
