// app.js — Learn Stotras (matches current index.html IDs)
// Supports:
// - stotra selector (stotras/index.json -> stotra.json -> verses.json)
// - practice set (e.g. 1-10, 12, 18-20 or 1,7,8)
// - practice text toggle
// - speed control
// - per-verse practice runs
// - v.mode === "full_only" (only *_full.mp3; singles practice plays full)
// - NEW: Self-record & compare (A/B) stored locally via IndexedDB (no server)

const $ = (id) => document.getElementById(id);

// Header
const brandTitle = $("brandTitle");
const brandSub = $("brandSub");

// Top controls
const stotraSelect = $("stotraSelect");
const themeSelect = $("themeSelect");

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

// ---------- Compare UI (optional; app still works if not present) ----------
const compareBox = $("compareBox");
const compareTake = $("compareTake");
const recMine = $("recMine");
const stopMine = $("stopMine");
const playMine = $("playMine");
const compareAB = $("compareAB");
const clearMine = $("clearMine");
const compareStatus = $("compareStatus");

const compareEnabled =
  !!compareBox &&
  !!compareTake &&
  !!recMine &&
  !!stopMine &&
  !!playMine &&
  !!compareAB &&
  !!clearMine &&
  !!compareStatus;

// -------- State --------
let stotraIndex = null;
let stotra = null;
let verses = [];
let current = null;

let stopRequested = false;

// Compare recording state
let mediaRecorder = null;
let recordingChunks = [];
let recordingStream = null;
let mineObjectURL = null;

// A separate audio element for "Mine" playback so we don't fight the main player
const minePlayer = new Audio();
minePlayer.preload = "auto";

// -------- Helpers --------
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

function toBadge(n, decimals = 0) {
  if (decimals === 0) return `${n}×`;
  return `${Number(n).toFixed(decimals)}×`;
}

function updateBadges() {
  repSingleVal.textContent = toBadge(repSingle.value);
  repPairsVal.textContent = toBadge(repPairs.value);
  repFullVal.textContent = toBadge(repFull.value);
  speedVal.textContent = toBadge(speed.value, 2);
}

function normalizePath(p) {
  // Keep relative URLs relative; just collapse accidental double slashes
  return (p || "").replace(/\/{2,}/g, "/");
}

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

  const numericOnly = [...set].every(x => /^\d+$/.test(x));
  if (numericOnly) {
    const ids = [];
    for (const x of set) {
      const i = Number(x);
      if (i >= 1 && i <= versesArr.length) ids.push(versesArr[i - 1].id);
    }
    return ids.length ? ids : versesArr.map(v => v.id);
  }

  const byId = new Set(versesArr.map(v => v.id));
  const ids = [];
  for (const x of set) if (byId.has(x)) ids.push(x);
  return ids.length ? ids : versesArr.map(v => v.id);
}

function setTheme(themeValue) {
  document.documentElement.setAttribute("data-theme", themeValue);
  const key = stotra?.themeKey || "learnstotras_theme";
  localStorage.setItem(key, themeValue);
}

function loadSavedTheme() {
  const key = stotra?.themeKey || "learnstotras_theme";
  const saved = localStorage.getItem(key);
  const theme = saved || (themeSelect ? themeSelect.value : "dark");
  if (themeSelect) themeSelect.value = theme;
  setTheme(theme);
}

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

function setPlaybackRate() {
  const r = Number(speed.value || 1.0);
  player.playbackRate = r;
  minePlayer.playbackRate = r;
}

function playWith(audioEl, src) {
  return new Promise((resolve) => {
    if (!src) return resolve();

    audioEl.pause();
    audioEl.currentTime = 0;
    audioEl.src = src;
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
  if (!src) return Promise.resolve();
  return playWith(player, normalizePath(src));
}

function playMineSrc(src) {
  if (!src) return Promise.resolve();
  return playWith(minePlayer, src);
}

// ---------------- IndexedDB for "Mine" recordings ----------------
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

  // A→B requires both reference and mine
  compareAB.disabled = !(blob && ref);

  // If recording supported?
  const hasRecorder = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  recMine.disabled = !hasRecorder;
  if (!hasRecorder) {
    setCompareStatus("Recording not supported in this browser.");
    return;
  }

  if (blob) {
    setCompareStatus(`Saved recording exists for ${current.id} (${take.toUpperCase()}).`);
  } else {
    setCompareStatus(`No saved recording for ${current.id} (${take.toUpperCase()}).`);
  }
}

// ---------------- Recording controls ----------------
function pickBestMimeType() {
  // Try common types. Browser decides based on support.
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  }
  return ""; // let browser choose
}

async function startMineRecording() {
  if (!compareEnabled || !current) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setCompareStatus("Recording not supported in this browser.");
    return;
  }

  // Stop any current playback to reduce feedback
  try { player.pause(); } catch {}
  try { minePlayer.pause(); } catch {}

  // If already recording, ignore
  if (mediaRecorder && mediaRecorder.state === "recording") return;

  const take = compareTake.value;
  const stotraId = stotraSelect.value;

  recordingChunks = [];

  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    const mimeType = pickBestMimeType();
    mediaRecorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordingChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // Cleanup stream tracks
      try {
        recordingStream?.getTracks()?.forEach(t => t.stop());
      } catch {}
      recordingStream = null;

      const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const key = dbKey(stotraId, current.id, take);
      await dbPut({
        key,
        stotraId,
        verseId: current.id,
        take,
        updated: Date.now(),
        blob
      });

      recMine.classList.remove("recording");
      recMine.disabled = false;
      stopMine.disabled = true;

      setCompareStatus(`Saved: ${current.id} (${take.toUpperCase()}).`);
      await refreshCompareUI();
    };

    mediaRecorder.start();

    // UI updates
    recMine.disabled = true;
    stopMine.disabled = false;
    recMine.classList.add("recording");
    setCompareStatus(`Recording… ${current.id} (${take.toUpperCase()})`);

  } catch (err) {
    // Cleanup if permission denied
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
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  } catch {}
}

async function playMineRecording() {
  if (!compareEnabled || !current) return;

  const take = compareTake.value;
  const blob = await getMineBlobForCurrent(take);
  if (!blob) {
    setCompareStatus("No saved recording yet.");
    return;
  }

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

  if (!refSrc) {
    setCompareStatus("Reference audio missing for this segment.");
    return;
  }
  if (!blob) {
    setCompareStatus("No saved recording yet.");
    return;
  }

  // Create mine URL
  revokeMineURL();
  mineObjectURL = URL.createObjectURL(blob);

  // A→B: play Reference (A), then Mine (B)
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

// ---------------- Existing practice logic ----------------
function computeTotalPlaysForVerse(v) {
  const nSingle = Number(repSingle.value);
  const nPairs  = Number(repPairs.value);
  const nFull   = Number(repFull.value);

  // full-only rows only use "singles" count (as full repeats)
  if ((v.mode || "normal") === "full_only") {
    return nSingle;
  }

  const usesPairsAsSingles = !!v.needsSplitPractice;
  const singlesUnits = usesPairsAsSingles ? 2 : 4;
  const singlesPlays = singlesUnits * nSingle;

  const hasP12 = !!(v.available?.p12 && v.audio?.p12);
  const hasP34 = !!(v.available?.p34 && v.audio?.p34);
  const pairUnits = (hasP12 ? 1 : 0) + (hasP34 ? 1 : 0);
  const pairPlays = pairUnits * nPairs;

  return singlesPlays + pairPlays + nFull;
}

function updateTotalPlaysForRun() {
  const set = parsePracticeSet(practiceSet.value);
  const ids = resolvePracticeSetToVerseIds(set, verses);
  let total = 0;
  for (const id of ids) {
    const v = verses.find(x => x.id === id);
    if (v) total += computeTotalPlaysForVerse(v);
  }
  totalPlaysBox.textContent = String(total);
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

function loadVerse(v) {
  current = v;

  // Ensure defaults (schema evolution safe)
  current.mode = current.mode || "normal";

  // Header title/subtitle (stotra-level)
  brandTitle.textContent = stotra?.title || "Learn Stotras";
  brandSub.textContent = stotra?.subtitle || "पद → द्विपद → श्लोक अभ्यासः";

  // Meter and full line
  meterBox.textContent = v.meter || "—";
  fullLine.textContent = v.full || "—";

  // Text vs practice text
  const baseText = v.text || {};
  const prText = v.practice || baseText;
  const t = usePractice.checked ? prText : baseText;

  pada1.textContent = t.p1 || "";
  pada2.textContent = t.p2 || "";
  pada3.textContent = t.p3 || "";
  pada4.textContent = t.p4 || "";

  // Meanings
  arthaSa.textContent = v.gloss?.sa || "";
  meaningEn.textContent = v.gloss?.en || "";

  // Buttons enablement
  const isFullOnly = (v.mode === "full_only");
  const isSplitSingles = !!v.needsSplitPractice;

  // Singles row hidden if full_only OR needsSplitPractice
  singleButtons.style.display = (isFullOnly || isSplitSingles) ? "none" : "";

  playP1.disabled = isFullOnly || isSplitSingles || !v.audio?.p1;
  playP2.disabled = isFullOnly || isSplitSingles || !v.audio?.p2;
  playP3.disabled = isFullOnly || isSplitSingles || !v.audio?.p3;
  playP4.disabled = isFullOnly || isSplitSingles || !v.audio?.p4;

  playP12.disabled = isFullOnly || !v.audio?.p12;
  playP34.disabled = isFullOnly || !v.audio?.p34;
  playFull.disabled = !v.audio?.full;

  // UI hint
  if (setIndicator) {
    if (isFullOnly) setIndicator.textContent = "This line is full-only (prose/preface).";
    else if (isSplitSingles) setIndicator.textContent = "";
    else setIndicator.textContent = "";
  }

  updateTotalPlaysForRun();
  setStatus("Ready.");

  // Refresh compare state for new verse
  refreshCompareUI();
}

function getSinglesKeysForVerse(v) {
  const mode = (v.mode || "normal");

  // full-only: singles practice means repeating full
  if (mode === "full_only") return ["full"];

  // needs split practice: treat p12/p34 as "singles"
  if (v.needsSplitPractice) return ["p12", "p34"];

  return ["p1", "p2", "p3", "p4"];
}

async function runPracticeForVerse(v) {
  const singlesKeys = getSinglesKeysForVerse(v);

  // Singles loop
  for (const k of singlesKeys) {
    const src = (k === "full") ? audioFor("full") : audioFor(k);
    if (!src) continue;

    for (let i = 0; i < Number(repSingle.value); i++) {
      if (stopRequested) return;
      await playSrc(src);
    }
  }

  // Pair loop (skip for full_only)
  if ((v.mode || "normal") !== "full_only") {
    for (let i = 0; i < Number(repPairs.value); i++) {
      if (stopRequested) return;
      const src12 = audioFor("p12");
      if (src12) await playSrc(src12);
      const src34 = audioFor("p34");
      if (src34) await playSrc(src34);
    }
  }

  // Full loop
  for (let i = 0; i < Number(repFull.value); i++) {
    if (stopRequested) return;
    const src = audioFor("full");
    if (src) await playSrc(src);
  }
}

async function startPracticeRun() {
  stopRequested = false;
  startBtn.disabled = true;
  stopBtn.disabled = false;

  const set = parsePracticeSet(practiceSet.value);
  const ids = resolvePracticeSetToVerseIds(set, verses);

  let total = 0;
  for (const id of ids) {
    const v = verses.find(x => x.id === id);
    if (v) total += computeTotalPlaysForVerse(v);
  }
  totalPlaysBox.textContent = String(total);

  setStatus("Starting…");

  for (const id of ids) {
    if (stopRequested) break;
    const v = verses.find(x => x.id === id);
    if (!v) continue;

    selectVerseById(id);
    setStatus(`Practicing: ${v.title || v.id}`);
    await runPracticeForVerse(v);
  }

  stopBtn.disabled = true;
  startBtn.disabled = false;
  setStatus(stopRequested ? "Stopped." : "Done.");
}

function stopPracticeRun() {
  stopRequested = true;
  player.pause();
  player.currentTime = 0;
  stopBtn.disabled = true;
  startBtn.disabled = false;
  setStatus("Stopping…");
}

async function loadStotra(stotraId) {
  const entry = stotraIndex.stotras.find(s => s.id === stotraId);
  if (!entry) throw new Error(`Unknown stotra id: ${stotraId}`);

  stotra = await fetchJSON(entry.path);
  verses = await fetchJSON(stotra.versesPath);

  // theme
  loadSavedTheme();

  // header
  brandTitle.textContent = stotra.title || "Learn Stotras";
  brandSub.textContent = stotra.subtitle || "पद → द्विपद → श्लोक अभ्यासः";

  populateVerseDropdown();
  selectVerseByIndex(0);
  updateTotalPlaysForRun();

  setStatus("Loaded.");
  refreshCompareUI();
}

async function init() {
  updateBadges();

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

  // --- Events ---
  stotraSelect.addEventListener("change", async () => {
    setStatus("Loading…");
    await loadStotra(stotraSelect.value);
  });

  verseSelect.addEventListener("change", () => {
    selectVerseById(verseSelect.value);
  });

  prevVerse.addEventListener("click", () => {
    selectVerseByIndex(verseSelect.selectedIndex - 1);
  });

  nextVerse.addEventListener("click", () => {
    selectVerseByIndex(verseSelect.selectedIndex + 1);
  });

  applySet.addEventListener("click", () => {
    const set = parsePracticeSet(practiceSet.value);
    if (!set) setIndicator.textContent = "";
    else setIndicator.textContent = "Practice set applied.";
    updateTotalPlaysForRun();
  });

  clearSet.addEventListener("click", () => {
    practiceSet.value = "";
    setIndicator.textContent = "";
    updateTotalPlaysForRun();
  });

  repSingle.addEventListener("input", () => { updateBadges(); updateTotalPlaysForRun(); });
  repPairs.addEventListener("input", () => { updateBadges(); updateTotalPlaysForRun(); });
  repFull.addEventListener("input", () => { updateBadges(); updateTotalPlaysForRun(); });

  speed.addEventListener("input", () => { updateBadges(); setPlaybackRate(); });

  usePractice.addEventListener("change", () => {
    if (current) loadVerse(current);
  });

  themeSelect.addEventListener("change", () => {
    setTheme(themeSelect.value);
  });

  startBtn.addEventListener("click", startPracticeRun);
  stopBtn.addEventListener("click", stopPracticeRun);

  // Playback chips
  playP1.addEventListener("click", async () => await playSrc(audioFor("p1")));
  playP2.addEventListener("click", async () => await playSrc(audioFor("p2")));
  playP3.addEventListener("click", async () => await playSrc(audioFor("p3")));
  playP4.addEventListener("click", async () => await playSrc(audioFor("p4")));
  playP12.addEventListener("click", async () => await playSrc(audioFor("p12")));
  playP34.addEventListener("click", async () => await playSrc(audioFor("p34")));
  playFull.addEventListener("click", async () => await playSrc(audioFor("full")));

  // Compare events (only if UI exists)
  if (compareEnabled) {
    compareTake.addEventListener("change", refreshCompareUI);

    recMine.addEventListener("click", startMineRecording);
    stopMine.addEventListener("click", stopMineRecording);
    playMine.addEventListener("click", playMineRecording);
    compareAB.addEventListener("click", compareABPlay);
    clearMine.addEventListener("click", clearMineRecording);

    // initial state
    stopMine.disabled = true;
    refreshCompareUI();
  }

  setPlaybackRate();
}

init().catch(err => {
  console.error(err);
  setStatus(`Init failed: ${err.message}`);
});
