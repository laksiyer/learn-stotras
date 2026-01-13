// app.js — Learn Stotras (generalized from Nitishatakam)
// - Loads stotras/index.json -> chosen stotra.json -> verses.json per stotra
// - Theme persists globally (or via themeKey from stotra.json)
// - Supports practice sets (e.g., "1,2,7-10") and practice modes (single/pairs/full)
// - NEW: supports v.mode === "full_only" (preface/prose lines with only *_full.mp3)

const qs = (sel) => document.querySelector(sel);

const stotraSelect = document.getElementById("stotraSelect");
const verseSelect = document.getElementById("verseSelect");
const applyPracticeSetBtn = document.getElementById("applyPracticeSet");
const practiceSetInput = document.getElementById("practiceSet");

const titleBox = document.getElementById("stotraTitle");
const subtitleBox = document.getElementById("stotraSubtitle");

const meterBox = document.getElementById("meter");
const verseBox = document.getElementById("verseText");

const p1Box = document.getElementById("p1Text");
const p2Box = document.getElementById("p2Text");
const p3Box = document.getElementById("p3Text");
const p4Box = document.getElementById("p4Text");

const saMeaningBox = document.getElementById("saMeaning");
const enMeaningBox = document.getElementById("enMeaning");

const playP1 = document.getElementById("playP1");
const playP2 = document.getElementById("playP2");
const playP3 = document.getElementById("playP3");
const playP4 = document.getElementById("playP4");
const playP12 = document.getElementById("playP12");
const playP34 = document.getElementById("playP34");
const playFull = document.getElementById("playFull");

const singleButtons = document.getElementById("singleButtons");

const startPractice = document.getElementById("startPractice");
const stopPractice = document.getElementById("stopPractice");

const repSingle = document.getElementById("repSingle");
const repPairs = document.getElementById("repPairs");
const repFull = document.getElementById("repFull");

const totalPlays = document.getElementById("totalPlays");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");

const themeSelect = document.getElementById("themeSelect");
const speed = document.getElementById("speed");
const usePractice = document.getElementById("usePractice");

let stotraIndex = null;
let stotra = null;
let verses = [];
let current = null;

let practiceQueue = [];
let stopRequested = false;

const audio = new Audio();
audio.preload = "auto";

function setStatus(msg) {
  if (progressText) progressText.textContent = msg;
}

function setProgress(done, total) {
  if (!progressBar) return;
  const pct = total ? Math.round((done / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  if (totalPlays) totalPlays.textContent = `${done}/${total} (${pct}%)`;
}

function normalizePath(p) {
  return (p || "").replace(/^\//, "").replace(/\/{2,}/g, "/");
}

async function fetchJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
  return await r.json();
}

function parsePracticeSet(str) {
  // Accepts: "1,2,7-10" or "vsn_001,vsn_007"
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

  // If set has numeric entries, map by verse index (1-based) in the displayed list
  const numericOnly = [...set].every(x => /^\d+$/.test(x));
  if (numericOnly) {
    const ids = [];
    for (const x of set) {
      const i = Number(x);
      if (i >= 1 && i <= versesArr.length) ids.push(versesArr[i - 1].id);
    }
    return ids;
  }

  // Else treat as explicit ids (or titles)
  const byId = new Map(versesArr.map(v => [v.id, v]));
  const ids = [];
  for (const x of set) {
    if (byId.has(x)) ids.push(x);
  }
  return ids.length ? ids : versesArr.map(v => v.id);
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
  const r = Number(speed?.value || 1);
  audio.playbackRate = r;
}

function playSrc(src) {
  return new Promise((resolve, reject) => {
    if (!src) return resolve();
    audio.pause();
    audio.currentTime = 0;
    audio.src = normalizePath(src);
    setPlaybackRate();

    const onEnd = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      resolve(); // don't hard-fail practice runs
    };
    const cleanup = () => {
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onErr);
    };

    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onErr);

    audio.play().catch(() => {
      cleanup();
      resolve();
    });
  });
}

function getSinglesSequence() {
  if (!current) return ["p1", "p2", "p3", "p4"];

  // Full-only lines (preface/prose): treat practice as full playback
  if (current.mode === "full_only") return ["full"];

  if (current.needsSplitPractice) return ["p12", "p34"];
  return ["p1", "p2", "p3", "p4"];
}

function computeTotalPlaysForVerse(v) {
  const nSingle = Number(repSingle.value);
  if (v.mode === "full_only") {
    return nSingle;
  }

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

function loadVerse(v) {
  current = v;

  meterBox.textContent = v.meter || "—";
  titleBox.textContent = stotra?.title || "";
  subtitleBox.textContent = stotra?.subtitle || "";

  verseBox.textContent = v.full || "";

  const t = (usePractice?.checked ? (v.practice || v.text || {}) : (v.text || v.practice || {}));

  p1Box.textContent = t.p1 || "";
  p2Box.textContent = t.p2 || "";
  p3Box.textContent = t.p3 || "";
  p4Box.textContent = t.p4 || "";

  saMeaningBox.textContent = v.gloss?.sa || "";
  enMeaningBox.textContent = v.gloss?.en || "";

  // Button visibility / enablement
  if (v.mode === "full_only" || v.needsSplitPractice) {
    singleButtons.style.display = "none";
  } else {
    singleButtons.style.display = "";
    playP1.disabled = !v.audio?.p1;
    playP2.disabled = !v.audio?.p2;
    playP3.disabled = !v.audio?.p3;
    playP4.disabled = !v.audio?.p4;
  }

  playP12.disabled = !v.audio?.p12;
  playP34.disabled = !v.audio?.p34;

  if (v.mode === "full_only") {
    playP12.disabled = true;
    playP34.disabled = true;
  }

  playFull.disabled = !v.audio?.full;

  // total plays preview for practice
  const ids = resolvePracticeSetToVerseIds(parsePracticeSet(practiceSetInput?.value), verses);
  let total = 0;
  for (const id of ids) {
    const vv = verses.find(x => x.id === id);
    if (vv) total += computeTotalPlaysForVerse(vv);
  }
  setProgress(0, total);
  setStatus("Ready.");
}

async function buildPracticeQueue() {
  const set = parsePracticeSet(practiceSetInput?.value);
  const ids = resolvePracticeSetToVerseIds(set, verses);

  practiceQueue = [];
  let total = 0;

  for (const id of ids) {
    const v = verses.find(x => x.id === id);
    if (!v) continue;

    total += computeTotalPlaysForVerse(v);
    practiceQueue.push(v);
  }

  return { total, idsCount: practiceQueue.length };
}

async function runPracticeForCurrentVerse() {
  if (!current) return;

  // Full-only lines should never stall: just play full, repeated as singles.
  if (current.mode === "full_only") {
    stopRequested = false;
    const src = audioFor("full");
    if (!src) { setStatus("Audio missing."); return; }

    const nSingle = Number(repSingle.value);
    for (let i = 0; i < nSingle; i++) {
      if (stopRequested) { setStatus("Stopped."); return; }
      await playSrc(src);
    }
    return;
  }

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

    for (let i = 0; i < Number(repPairs.value); i++) {
      if (stopRequested) { setStatus("Stopped."); return; }

      const src12 = audioFor("p12");
      if (src12) await playSrc(src12);

      const src34 = audioFor("p34");
      if (src34) await playSrc(src34);
    }

    for (let i = 0; i < Number(repFull.value); i++) {
      if (stopRequested) { setStatus("Stopped."); return; }
      const src = audioFor("full");
      if (src) await playSrc(src);
    }
  } catch (e) {
    // swallow to keep practice robust
  }
}

async function startPracticeRun() {
  stopRequested = false;
  startPractice.disabled = true;
  stopPractice.disabled = false;

  const { total } = await buildPracticeQueue();
  let done = 0;

  for (const v of practiceQueue) {
    if (stopRequested) break;

    // load verse in UI
    loadVerse(v);

    // compute plays for this verse
    const verseTotal = computeTotalPlaysForVerse(v);

    setStatus(`Practicing ${v.title || v.id} …`);
    await runPracticeForCurrentVerse();

    done += verseTotal;
    setProgress(done, total);
  }

  stopPractice.disabled = true;
  startPractice.disabled = false;

  if (stopRequested) setStatus("Stopped.");
  else setStatus("Done.");
}

function stopPracticeRun() {
  stopRequested = true;
  audio.pause();
  audio.currentTime = 0;
  stopPractice.disabled = true;
  startPractice.disabled = false;
  setStatus("Stopping…");
}

function populateVerseDropdown() {
  verseSelect.innerHTML = "";
  verses.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.title || v.id;
    verseSelect.appendChild(opt);
  });
}

function selectVerseById(id) {
  const v = verses.find(x => x.id === id);
  if (!v) return;
  verseSelect.value = v.id;
  loadVerse(v);
}

async function loadStotra(stotraId) {
  const entry = stotraIndex.stotras.find(s => s.id === stotraId);
  if (!entry) throw new Error(`Unknown stotra id: ${stotraId}`);

  stotra = await fetchJSON(entry.path);
  verses = await fetchJSON(stotra.versesPath);

  // theme
  const themeKey = stotra.themeKey || "learnstotras_theme";
  const savedTheme = localStorage.getItem(themeKey);
  if (savedTheme && themeSelect) themeSelect.value = savedTheme;

  populateVerseDropdown();
  selectVerseById(verses[0]?.id);

  titleBox.textContent = stotra.title || "";
  subtitleBox.textContent = stotra.subtitle || "";

  setStatus("Loaded.");
}

async function init() {
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

  // events
  stotraSelect.addEventListener("change", async () => {
    setStatus("Loading…");
    await loadStotra(stotraSelect.value);
  });

  verseSelect.addEventListener("change", () => {
    selectVerseById(verseSelect.value);
  });

  applyPracticeSetBtn?.addEventListener("click", () => {
    // just refresh totals in UI
    if (current) loadVerse(current);
  });

  startPractice.addEventListener("click", startPracticeRun);
  stopPractice.addEventListener("click", stopPracticeRun);

  themeSelect?.addEventListener("change", () => {
    const themeKey = stotra?.themeKey || "learnstotras_theme";
    localStorage.setItem(themeKey, themeSelect.value);
    document.documentElement.setAttribute("data-theme", themeSelect.value);
  });

  speed?.addEventListener("input", () => setPlaybackRate());
  usePractice?.addEventListener("change", () => {
    if (current) loadVerse(current);
  });

  // playback buttons
  playP1?.addEventListener("click", async () => await playSrc(audioFor("p1")));
  playP2?.addEventListener("click", async () => await playSrc(audioFor("p2")));
  playP3?.addEventListener("click", async () => await playSrc(audioFor("p3")));
  playP4?.addEventListener("click", async () => await playSrc(audioFor("p4")));
  playP12?.addEventListener("click", async () => await playSrc(audioFor("p12")));
  playP34?.addEventListener("click", async () => await playSrc(audioFor("p34")));
  playFull?.addEventListener("click", async () => await playSrc(audioFor("full")));

  // init theme attribute
  const themeKey = stotra?.themeKey || "learnstotras_theme";
  const savedTheme = localStorage.getItem(themeKey);
  if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
}

init().catch(err => {
  console.error(err);
  setStatus(`Init failed: ${err.message}`);
});
