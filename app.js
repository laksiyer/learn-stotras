// app.js — Learn Stotras (Practice engine + Theme + Script + Compare A/B)
// Drop-in replacement for your current index.html.
// FIXES for recording reliability (Chrome/desktop):
//  - mediaRecorder.start(250) so ondataavailable fires consistently
//  - requestData() before stop to flush final chunk
//  - skip saving empty blobs; show size + mime in UI
// Storage: IndexedDB Blob

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

// Separate audio element for user's take
const minePlayer = new Audio();
minePlayer.preload = "auto";

// ---------------- State ----------------
let stotraIndex = null; // stotras/index.json
let stotra = null;      // current stotra.json
let verses = [];        // current verses.json
let current = null;     // current verse object
let stopRequested = false;
let chapters = [];         // e.g., [{ id: "1", title: "1. अर्जुनविषादयोगः" }, ...]
let chapterVerses = [];    // filtered verses for currently selected chapter
let currentChapterId = ""; // "1", "2", ...

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
function getChapters() {
  const set = new Set(verses.map(v => v.chapter).filter(x => x != null));
  return Array.from(set).sort((a, b) => a - b);
}

function setChapter(ch) {
  currentChapter = ch;
  chapterVerses = verses.filter(v => v.chapter === ch);

  populateVerseDropdown();     // will be updated to use chapterVerses
  selectVerseByIndex(0);
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
    translitCache.clear();
    if (current) loadVerse(current);
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

    // IMPORTANT: do NOT normalize blob/data/absolute URLs
    const isSpecial =
      src.startsWith("blob:") ||
      src.startsWith("data:") ||
      /^[a-zA-Z]+:\/\//.test(src); // http://, https://, file:// etc.

    audioEl.src = isSpecial ? src : normalizePath(src);

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

// ---------------- Practice counting ----------------
function computeTotalPlaysForVerse(v) {
  const nSingle = Number(repSingle.value);
  const nPairs  = Number(repPairs.value);
  const nFull   = Number(repFull.value);

  const mode = (v.mode || "normal");
  if (mode === "full_only") return nSingle;

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

  const list = (chapterVerses && chapterVerses.length) ? chapterVerses : verses;

  list.forEach(v => {
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

  await refreshCompareUI();
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

  for (const key of singles) {
    const src = (key === "full") ? audioFor("full") : audioFor(key);
    if (!src) continue;

    for (let i = 0; i < Number(repSingle.value); i++) {
      if (stopRequested) return;
      await playSrc(src);
    }
  }

  if ((v.mode || "normal") !== "full_only") {
    for (let i = 0; i < Number(repPairs.value); i++) {
      if (stopRequested) return;
      const src12 = audioFor("p12");
      if (src12) await playSrc(src12);
      const src34 = audioFor("p34");
      if (src34) await playSrc(src34);
    }
  }

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

// =====================================================================
// Compare (Self-record A/B) — IndexedDB Blob storage + recording fixes
// =====================================================================

const DB_NAME = "learnstotras_recorder";
const DB_VER = 1;
const STORE = "takes";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const r = st.get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function dbSet(key, val) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const r = st.put(val, key);
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}

async function dbDel(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const r = st.delete(key);
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}

function recKey(stotraId, verseId, take) {
  return `learnstotras::${stotraId}::${verseId}::${take}`;
}

async function getMineBlob(take) {
  if (!compareEnabled || !current) return null;
  const stotraId = stotraSelect.value;
  return await dbGet(recKey(stotraId, current.id, take));
}

// ---- recorder runtime ----
let mediaRecorder = null;
let recordingChunks = [];
let recordingStream = null;

function pickBestMimeType() {
  // Chrome desktop: opus/webm is best.
  const candidates = [
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

function kb(n) {
  return `${Math.round(n / 1024)} KB`;
}

async function refreshCompareUI() {
  if (!compareEnabled || !current) return;

  const take = compareTake.value;
  const ref = audioFor(take);

  let mine = null;
  try { mine = await getMineBlob(take); } catch (e) { console.error(e); }

  playMine.disabled = !mine;
  clearMine.disabled = !mine;
  compareAB.disabled = !(mine && ref);

  const hasRecorder = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  recMine.disabled = !hasRecorder;

  if (!hasRecorder) {
    setCompareStatus("Recording not supported in this browser.");
    return;
  }

  setCompareStatus(
    mine
      ? `Saved recording exists for ${current.id} (${take.toUpperCase()}) — ${kb(mine.size)} — ${mine.type || "unknown"}`
      : `No saved recording for ${current.id} (${take.toUpperCase()}).`
  );
}

async function startMineRecording() {
  if (!compareEnabled || !current) return;

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setCompareStatus("Recording not supported in this browser.");
    return;
  }

  try { player.pause(); } catch {}
  try { minePlayer.pause(); } catch {}

  if (mediaRecorder && mediaRecorder.state === "recording") return;

  const take = compareTake.value;
  const stotraId = stotraSelect.value;
  recordingChunks = [];

  setCompareStatus("Requesting microphone permission…");

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

      // Guard: don’t save empty/silent blobs
      if (!blob || blob.size < 1000) {
        setCompareStatus(
          `Recording was empty (size ${blob ? blob.size : 0} bytes). Try again; check mic input selection.`
        );
        recMine.classList.remove("recording");
        recMine.disabled = false;
        stopMine.disabled = true;
        return;
      }

      setCompareStatus(`Recorded ${kb(blob.size)} — ${blob.type || "unknown"} — saving…`);

      const key = recKey(stotraId, current.id, take);
      try {
        await dbSet(key, blob);
        setCompareStatus(`Saved: ${current.id} (${take.toUpperCase()}) — ${kb(blob.size)} — ${blob.type || "unknown"}`);
      } catch (e) {
        console.error(e);
        setCompareStatus("Could not save (storage blocked or full).");
      }

      recMine.classList.remove("recording");
      recMine.disabled = false;
      stopMine.disabled = true;

      await refreshCompareUI();
    };

    // FIX #1: timeslice forces periodic chunk delivery
    mediaRecorder.start(250);

    recMine.disabled = true;
    stopMine.disabled = false;
    recMine.classList.add("recording");
    setCompareStatus(`Recording… ${current.id} (${take.toUpperCase()}) — mime: ${mediaRecorder.mimeType || "default"}`);
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
    if (mediaRecorder && mediaRecorder.state === "recording") {
      // FIX #2: flush final chunk before stopping
      if (typeof mediaRecorder.requestData === "function") {
        try { mediaRecorder.requestData(); } catch {}
      }
      mediaRecorder.stop();
    }
  } catch {}
}

async function playMineRecording() {
  if (!compareEnabled || !current) return;

  const take = compareTake.value;
  const blob = await getMineBlob(take);
  if (!blob) { setCompareStatus("No saved recording yet."); return; }

  if (blob.size < 1000) {
    setCompareStatus(`Saved blob is tiny (${blob.size} bytes). Clear and record again.`);
    return;
  }

  const url = URL.createObjectURL(blob);
  try {
    setCompareStatus(`Playing mine: ${current.id} (${take.toUpperCase()}) — ${kb(blob.size)} — ${blob.type || "unknown"}`);
    await playWith(minePlayer, url);
    setCompareStatus("Ready.");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

async function compareABPlay() {
  if (!compareEnabled || !current) return;

  const take = compareTake.value;
  const refSrc = audioFor(take);
  if (!refSrc) { setCompareStatus("Reference audio missing for this segment."); return; }

  const blob = await getMineBlob(take);
  if (!blob) { setCompareStatus("No saved recording yet."); return; }

  if (blob.size < 1000) {
    setCompareStatus(`Saved blob is tiny (${blob.size} bytes). Clear and record again.`);
    return;
  }

  const url = URL.createObjectURL(blob);
  try {
    setCompareStatus(`A→B compare: ${take.toUpperCase()} (Reference → Mine)`);
    await playSrc(refSrc);
    await playWith(minePlayer, url);
    setCompareStatus("Ready.");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

async function clearMineRecording() {
  if (!compareEnabled || !current) return;

  const take = compareTake.value;
  const stotraId = stotraSelect.value;
  const key = recKey(stotraId, current.id, take);

  try { await dbDel(key); } catch (e) { console.error(e); }

  setCompareStatus(`Cleared: ${current.id} (${take.toUpperCase()})`);
  await refreshCompareUI();
}

function getChapterIdFromVerseId(verseId) {
  // expects ids like "bg_01_023"
  const m = String(verseId || "").match(/^bg_(\d{2})_/i);
  if (!m) return "";
  return String(parseInt(m[1], 10)); // "01" -> "1"
}

// ---------------- Load stotra ----------------
async function loadStotra(stotraId) {
  const entry = stotraIndex.stotras.find(s => s.id === stotraId);
  if (!entry) throw new Error(`Unknown stotra id: ${stotraId}`);

stotra = await fetchJSON(entry.path);

let rawVerses = await fetchJSON(stotra.versesPath);

// normalize: allow either [ ... ] OR { verses: [ ... ] }
verses = Array.isArray(rawVerses) ? rawVerses : (rawVerses?.verses || []);

// add chapter/verseNumber if missing
verses = verses.map(v => {
  const out = { ...v };

  // 1) try from id like bg_01_023
  if (out.chapter == null && typeof out.id === "string") {
    const m = out.id.match(/^[a-z]+_(\d+)_([\d]+)/i);
    if (m) out.chapter = parseInt(m[1], 10);
    if (m) out.verseNumber = parseInt(m[2], 10);
  }

  // 2) try from title like "1.23"
  if (out.chapter == null && typeof out.title === "string") {
    const m2 = out.title.match(/^\s*(\d+)\.(\d+)\s*$/);
    if (m2) {
      out.chapter = parseInt(m2[1], 10);
      out.verseNumber = parseInt(m2[2], 10);
    }
  }

  // default chapter if still unknown (keeps it safe)
  if (out.chapter == null) out.chapter = 1;

  return out;
});
// Build chapters list from normalized verses (now each verse has .chapter)
const chapterSet = new Set(verses.map(v => String(v.chapter)));
chapters = Array.from(chapterSet)
  .sort((a, b) => Number(a) - Number(b))
  .map(ch => ({
    id: ch,
    title: (stotra.chapter_titles && stotra.chapter_titles[ch])
      ? `${ch}. ${stotra.chapter_titles[ch]}`
      : `Chapter ${ch}`
  }));

// default chapter (first one) + populate chapter dropdown
currentChapterId = chapters.length ? chapters[0].id : "";
chapterVerses = currentChapterId
  ? verses.filter(v => String(v.chapter) === String(currentChapterId))
  : [];

// update header
brandTitle.textContent = stotra.title || "Learn Stotras";
brandSub.textContent = stotra.subtitle || "पद → द्विपद → श्लोक अभ्यासः";

// populate chapter dropdown (NEW)
populateChapterDropdown();

// populate verse dropdown (this will use chapterVerses once you updated populateVerseDropdown)
populateVerseDropdown();
selectVerseByIndex(0);
updateTotalPlaysForRun();

setStatus("Loaded.");
await refreshCompareUI();
}
function populateChapterDropdown() {
  const chapterSelect = document.getElementById("chapterSelect");
  if (!chapterSelect) return;

  chapterSelect.innerHTML = "";
  chapters.forEach(ch => {
    const opt = document.createElement("option");
    opt.value = ch.id;
    opt.textContent = ch.title;
    chapterSelect.appendChild(opt);
  });

  if (currentChapterId) {
    chapterSelect.value = currentChapterId;
  }
}

// ---------------- Init ----------------
async function init() {
  updateBadges();
  initTheme();
  initScriptSelect();
  setPlaybackRate();

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

  stotraSelect.addEventListener("change", async () => {
    setStatus("Loading…");
    await loadStotra(stotraSelect.value);
  });

  verseSelect.addEventListener("change", () => selectVerseById(verseSelect.value));
  prevVerse.addEventListener("click", () => selectVerseByIndex(verseSelect.selectedIndex - 1));
  nextVerse.addEventListener("click", () => selectVerseByIndex(verseSelect.selectedIndex + 1));

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

  repSingle.addEventListener("input", () => { updateBadges(); updateTotalPlaysForRun(); });
  repPairs.addEventListener("input", () => { updateBadges(); updateTotalPlaysForRun(); });
  repFull.addEventListener("input", () => { updateBadges(); updateTotalPlaysForRun(); });
  speed.addEventListener("input", () => { updateBadges(); setPlaybackRate(); });

  usePractice.addEventListener("change", () => { if (current) loadVerse(current); });

  startBtn.addEventListener("click", startPracticeRun);
  stopBtn.addEventListener("click", stopPracticeRun);

  playP1.addEventListener("click", async () => await playSrc(audioFor("p1")));
  playP2.addEventListener("click", async () => await playSrc(audioFor("p2")));
  playP3.addEventListener("click", async () => await playSrc(audioFor("p3")));
  playP4.addEventListener("click", async () => await playSrc(audioFor("p4")));
  playP12.addEventListener("click", async () => await playSrc(audioFor("p12")));
  playP34.addEventListener("click", async () => await playSrc(audioFor("p34")));
  playFull.addEventListener("click", async () => await playSrc(audioFor("full")));

  if (compareEnabled) {
    stopMine.disabled = true;

    compareTake.addEventListener("change", refreshCompareUI);
    recMine.addEventListener("click", startMineRecording);
    stopMine.addEventListener("click", stopMineRecording);
    playMine.addEventListener("click", playMineRecording);
    compareAB.addEventListener("click", compareABPlay);
    clearMine.addEventListener("click", clearMineRecording);

    await refreshCompareUI();
  }

  setStatus("Loaded.");
}

init().catch(err => {
  console.error(err);
  setStatus(`Init failed: ${err.message}`);
});
