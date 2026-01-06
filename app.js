// app.js — Learn Stotras (generalized from Nitishatakam)
// Keeps UI/logic intact, adds:
// - Stotra selector
// - Loads stotra manifest + verses.json per stotra
// - Theme persists globally (or via manifest override)

const stotraSelect = document.getElementById("stotraSelect");
const brandTitleEl = document.getElementById("brandTitle");
const brandSubEl = document.getElementById("brandSub");

const verseSelect = document.getElementById("verseSelect");
const prevVerseBtn = document.getElementById("prevVerse");
const nextVerseBtn = document.getElementById("nextVerse");

const fullLine = document.getElementById("fullLine");
const meterBox = document.getElementById("meterBox");

const padaEls = [
  document.getElementById("pada1"),
  document.getElementById("pada2"),
  document.getElementById("pada3"),
  document.getElementById("pada4"),
];

const arthaSa = document.getElementById("arthaSa");
const meaningEn = document.getElementById("meaningEn");

const repSingle = document.getElementById("repSingle");
const repPairs = document.getElementById("repPairs");
const repFull = document.getElementById("repFull");
const speed = document.getElementById("speed");
const usePractice = document.getElementById("usePractice");

// value badges
const repSingleVal = document.getElementById("repSingleVal");
const repPairsVal = document.getElementById("repPairsVal");
const repFullVal = document.getElementById("repFullVal");
const speedVal = document.getElementById("speedVal");

// total plays indicator
const totalPlaysEl = document.getElementById("totalPlays");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

// Single buttons (normal verses only)
const singleButtons = document.getElementById("singleButtons");
const playP1 = document.getElementById("playP1");
const playP2 = document.getElementById("playP2");
const playP3 = document.getElementById("playP3");
const playP4 = document.getElementById("playP4");

// Pair / full buttons
const playP12 = document.getElementById("playP12");
const playP34 = document.getElementById("playP34");
const playFull = document.getElementById("playFull");

const status = document.getElementById("status");
const player = document.getElementById("player");

// Practice set UI
const practiceSetInput = document.getElementById("practiceSet");
const applySetBtn = document.getElementById("applySet");
const clearSetBtn = document.getElementById("clearSet");
const setIndicator = document.getElementById("setIndicator");

// Theme UI
const themeSelect = document.getElementById("themeSelect");

// ----------------- NEW: stotra state -----------------
let stotraIndex = null;      // stotras/index.json
let stotra = null;           // current manifest stotra.json

let verses = [];
let current = null;
let stopRequested = false;

// Practice set state: array of verse indices in verses[]
let practiceSetIndices = []; // empty => not active

// ---------- UI helpers ----------
function setStatus(msg) { status.textContent = msg; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function updateSliderBadges() {
  repSingleVal.textContent = `${repSingle.value}×`;
  repPairsVal.textContent = `${repPairs.value}×`;
  repFullVal.textContent = `${repFull.value}×`;
  speedVal.textContent = `${Number(speed.value).toFixed(2)}×`;
}

// ---------- verse helpers ----------
function currentIndex() {
  if (!current) return -1;
  return verses.findIndex(v => v.id === current.id);
}

function selectVerseByIndex(idx) {
  if (!verses.length) return;
  const i = clamp(idx, 0, verses.length - 1);
  verseSelect.selectedIndex = i;
  loadVerse(verses[i]);
}

function getSinglesSequence() {
  if (!current) return ["p1", "p2", "p3", "p4"];
  if (current.needsSplitPractice) return ["p12", "p34"];
  return ["p1", "p2", "p3", "p4"];
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

function computeTotalPlaysForVerse(v) {
  if (!v) return 0;

  const nSingle = Number(repSingle.value);
  const nPairs = Number(repPairs.value);
  const nFull = Number(repFull.value);

  const isSpecial = !!v.needsSplitPractice;
  const singlesUnits = isSpecial ? 2 : 4;
  const singlesPlays = singlesUnits * nSingle;

  const hasP12 = !!(v.available?.p12 && v.audio?.p12);
  const hasP34 = !!(v.available?.p34 && v.audio?.p34);
  const pairUnitsPerCycle = (hasP12 ? 1 : 0) + (hasP34 ? 1 : 0);
  const pairsPlays = pairUnitsPerCycle * nPairs;

  return singlesPlays + pairsPlays + nFull;
}

function updateRunSummary() {
  const perVerse = computeTotalPlaysForVerse(current);
  if (practiceSetIndices.length > 0) {
    totalPlaysEl.textContent = String(perVerse * practiceSetIndices.length);
  } else {
    totalPlaysEl.textContent = String(perVerse);
  }
}

// ---------- Practice set parsing ----------
function extractVerseNumber(v) {
  const m = String(v.id || "").match(/(\d+)/);
  if (m) return Number(m[1]);
  return null;
}

function parsePracticeSet(text, maxN) {
  const raw = (text || "").trim();
  if (!raw) return [];

  const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
  const nums = [];

  for (const part of parts) {
    const r = part.replace(/\s+/g, "");
    if (/^\d+$/.test(r)) {
      nums.push(Number(r));
      continue;
    }
    if (/^\d+-\d+$/.test(r)) {
      const [a, b] = r.split("-").map(Number);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let k = lo; k <= hi; k++) nums.push(k);
      continue;
    }
    throw new Error(`Invalid token: "${part}"`);
  }

  const seen = new Set();
  const unique = [];
  for (const n of nums) {
    if (!Number.isFinite(n)) continue;
    if (n < 1 || n > maxN) continue;
    if (!seen.has(n)) { seen.add(n); unique.push(n); }
  }
  return unique;
}

function applyPracticeSetFromInput() {
  try {
    const maxN = verses.length;
    const wanted = parsePracticeSet(practiceSetInput.value, maxN);
    if (wanted.length === 0) {
      practiceSetIndices = [];
      setIndicator.textContent = "";
      updateRunSummary();
      setStatus("Set cleared. (Single-verse mode)");
      return;
    }

    practiceSetIndices = wanted.map(n => n - 1).filter(i => i >= 0 && i < verses.length);

    const label = wanted.join(", ");
    setIndicator.textContent = `Practicing set: ${label} (${practiceSetIndices.length} verses)`;
    updateRunSummary();
    setStatus("Set applied.");
  } catch (e) {
    setStatus(`Set error: ${e.message}`);
  }
}

function clearPracticeSet() {
  practiceSetInput.value = "";
  practiceSetIndices = [];
  setIndicator.textContent = "";
  updateRunSummary();
  setStatus("Set cleared. (Single-verse mode)");
}

// ---------- audio ----------
async function playSrc(src) {
  return new Promise((resolve, reject) => {
    if (!src) return reject(new Error("Missing audio src"));

    player.pause();
    player.currentTime = 0;
    player.src = src;
    player.playbackRate = Number(speed.value);

    const onEnded = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("Audio error / file not found")); };

    function cleanup() {
      player.removeEventListener("ended", onEnded);
      player.removeEventListener("error", onError);
    }

    player.addEventListener("ended", onEnded);
    player.addEventListener("error", onError);

    setStatus(`Playing: ${src}`);
    player.play().catch(err => { cleanup(); reject(err); });
  });
}

async function playUnit(key) {
  if (!current) return;
  stopRequested = false;
  const src = audioFor(key);
  if (!src) { setStatus("Audio missing."); return; }
  try {
    await playSrc(src);
    setStatus("Ready.");
  } catch (e) {
    setStatus(`Could not play. (${e.message})`);
  }
}

// ---------- practice runner ----------
async function runPracticeForCurrentVerse() {
  if (!current) return;

  try {
    const seq = getSinglesSequence();
    for (const k of seq) {
      const src = audioFor(k);
      if (!src) continue;

      for (let i = 0; i < Number(repSingle.value); i++) {
        if (stopRequested) { setStatus("Stopped."); return; }
        await playSrc(src);
      }
    }

    for (const k of ["p12", "p34"]) {
      const src = audioFor(k);
      if (!src) continue;

      for (let i = 0; i < Number(repPairs.value); i++) {
        if (stopRequested) { setStatus("Stopped."); return; }
        await playSrc(src);
      }
    }

    const fullSrc = audioFor("full");
    for (let i = 0; i < Number(repFull.value); i++) {
      if (stopRequested) { setStatus("Stopped."); return; }
      await playSrc(fullSrc);
    }
  } catch (e) {
    setStatus(`Could not play audio. Check file paths. (${e.message})`);
    throw e;
  }
}

async function runPractice() {
  if (!current) return;
  stopRequested = false;

  if (practiceSetIndices.length > 0) {
    setStatus("Set practice starting…");
    for (let s = 0; s < practiceSetIndices.length; s++) {
      if (stopRequested) { setStatus("Stopped."); return; }

      const idx = practiceSetIndices[s];
      const v = verses[idx];
      if (!v) continue;

      verseSelect.selectedIndex = idx;
      loadVerse(v);

      setStatus(`Set: verse ${idx + 1} (${s + 1}/${practiceSetIndices.length})…`);
      await runPracticeForCurrentVerse();
    }
    setStatus("Done (set).");
    return;
  }

  setStatus("Playing…");
  await runPracticeForCurrentVerse();
  setStatus("Done.");
}

function stopAll() {
  stopRequested = true;
  player.pause();
  setStatus("Stopped.");
}

// ---------- render ----------
function loadVerse(v) {
  current = v;

  meterBox.textContent = v.meter || "—";
  fullLine.textContent = v.full || "";

  const t = (usePractice.checked && v.practice) ? v.practice : v.text;
  padaEls.forEach((el, i) => {
    const key = "p" + (i + 1);
    el.textContent = t?.[key] || "";
  });

  arthaSa.textContent = v.gloss?.sa || "";
  meaningEn.textContent = v.gloss?.en || "";

  playP12.disabled = !(v.available?.p12 && v.audio?.p12);
  playP34.disabled = !(v.available?.p34 && v.audio?.p34);

  if (v.needsSplitPractice) {
    singleButtons.style.display = "none";
  } else {
    singleButtons.style.display = "flex";
    playP1.disabled = !v.audio?.p1;
    playP2.disabled = !v.audio?.p2;
    playP3.disabled = !v.audio?.p3;
    playP4.disabled = !v.audio?.p4;
  }

  const idx = currentIndex();
  prevVerseBtn.disabled = (idx <= 0);
  nextVerseBtn.disabled = (idx >= verses.length - 1);

  updateSliderBadges();
  updateRunSummary();
  setStatus("Ready.");
}

// ---------- theme ----------
function setTheme(theme, themeKey) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(themeKey, theme);
}

function initTheme(themeKey) {
  const saved = localStorage.getItem(themeKey) || "dark";
  themeSelect.value = saved;
  setTheme(saved, themeKey);
}

// ---------- NEW: loader ----------
async function fetchJSON(path) {
  const resp = await fetch(path, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to load ${path} (${resp.status})`);
  return await resp.json();
}

function getQueryParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

function setQueryParam(name, value) {
  const u = new URL(window.location.href);
  u.searchParams.set(name, value);
  window.history.replaceState({}, "", u.toString());
}

async function loadStotra(stotraId) {
  const entry = stotraIndex.stotras.find(s => s.id === stotraId);
  if (!entry) throw new Error(`Unknown stotra id: ${stotraId}`);

  stotra = await fetchJSON(entry.path);

  // Update header branding
  brandTitleEl.textContent = stotra.title || entry.title || "Learn Stotras";
  brandSubEl.textContent = stotra.subtitle || entry.subtitle || "";

  const themeKey = stotra.themeKey || "learnstotras_theme";
  initTheme(themeKey);

  // Load verses for this stotra
  const versesPath = stotra.versesPath;
  if (!versesPath) throw new Error("stotra.json missing versesPath");
  verses = await fetchJSON(versesPath);

  // stable sort like Nitishatakam
  verses.forEach(v => { v._num = extractVerseNumber(v) ?? null; });
  verses.sort((a, b) => {
    if (a._num != null && b._num != null) return a._num - b._num;
    return String(a.id).localeCompare(String(b.id));
  });

  // rebuild verse dropdown
  verseSelect.innerHTML = "";
  verses.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.title || v.id;
    verseSelect.appendChild(opt);
  });

  // reset set mode when switching stotra (keeps things sane)
  clearPracticeSet();

  if (verses.length > 0) selectVerseByIndex(0);
  else setStatus("No verses found for this stotra.");

  updateSliderBadges();
  updateRunSummary();
}

// ---------- init ----------
async function init() {
  try {
    // Load stotra list
    stotraIndex = await fetchJSON("stotras/index.json");
    if (!stotraIndex?.stotras?.length) {
      setStatus("No stotras found in stotras/index.json");
      return;
    }

    // Populate selector
    stotraSelect.innerHTML = "";
    stotraIndex.stotras.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.title || s.id;
      stotraSelect.appendChild(opt);
    });

    // Choose stotra from URL (?stotra=...), else first
    const fromUrl = getQueryParam("stotra");
    const initialId = (fromUrl && stotraIndex.stotras.some(x => x.id === fromUrl))
      ? fromUrl
      : stotraIndex.stotras[0].id;

    stotraSelect.value = initialId;
    await loadStotra(initialId);

  } catch (e) {
    setStatus(`Init failed: ${e.message}`);
    return;
  }

  // --- events (mostly unchanged) ---
  stotraSelect.addEventListener("change", async () => {
    const id = stotraSelect.value;
    setQueryParam("stotra", id);
    setStatus("Loading…");
    await loadStotra(id);
  });

  verseSelect.addEventListener("change", () => {
    const v = verses[verseSelect.selectedIndex];
    if (v) loadVerse(v);
  });

  prevVerseBtn.addEventListener("click", () => {
    const idx = currentIndex();
    if (idx > 0) selectVerseByIndex(idx - 1);
  });

  nextVerseBtn.addEventListener("click", () => {
    const idx = currentIndex();
    if (idx >= 0 && idx < verses.length - 1) selectVerseByIndex(idx + 1);
  });

  window.addEventListener("keydown", (e) => {
    const tag = (document.activeElement?.tagName || "").toLowerCase();
    if (tag === "select" || tag === "input" || tag === "textarea") return;
    if (e.key === "ArrowLeft") prevVerseBtn.click();
    if (e.key === "ArrowRight") nextVerseBtn.click();
  });

  [repSingle, repPairs, repFull, speed].forEach(el => {
    el.addEventListener("input", () => {
      updateSliderBadges();
      updateRunSummary();
    });
  });

  usePractice.addEventListener("change", () => { if (current) loadVerse(current); });

  startBtn.addEventListener("click", () => runPractice());
  stopBtn.addEventListener("click", stopAll);

  applySetBtn.addEventListener("click", applyPracticeSetFromInput);
  clearSetBtn.addEventListener("click", clearPracticeSet);

  practiceSetInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyPracticeSetFromInput();
  });

  themeSelect.addEventListener("change", () => {
    const themeKey = stotra?.themeKey || "learnstotras_theme";
    setTheme(themeSelect.value, themeKey);
  });

  playP1.addEventListener("click", () => playUnit("p1"));
  playP2.addEventListener("click", () => playUnit("p2"));
  playP3.addEventListener("click", () => playUnit("p3"));
  playP4.addEventListener("click", () => playUnit("p4"));

  playP12.addEventListener("click", () => playUnit("p12"));
  playP34.addEventListener("click", () => playUnit("p34"));
  playFull.addEventListener("click", () => playUnit("full"));

  const canonical = ["p1", "p2", "p3", "p4"];
  padaEls.forEach((el, i) => {
    el.addEventListener("click", async () => {
      if (!current) return;
      stopRequested = false;

      let key = canonical[i];
      if (current.needsSplitPractice) key = (i < 2) ? "p12" : "p34";
      await playUnit(key);
    });
  });

  updateSliderBadges();
  updateRunSummary();
}

init();
