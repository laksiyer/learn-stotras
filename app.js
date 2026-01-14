// app.js — Learn Stotras (with script switching + recorder compare)

const $ = (id) => document.getElementById(id);

// Header
const brandTitle = $("brandTitle");
const brandSub = $("brandSub");

// Top controls
const stotraSelect = $("stotraSelect");
const themeSelect = $("themeSelect");
const scriptSelect = $("scriptSelect"); // NEW

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

// ---------- Compare UI ----------
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

// -------- State --------
let stotraIndex = null;
let stotra = null;
let verses = [];
let current = null;
let stopRequested = false;

// -------- Theme (FIX) --------
function applyTheme(themeValue) {
  // Your CSS: default dark is in :root (no attribute needed)
  // Other themes are in html[data-theme="..."]
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

  themeSelect.addEventListener("change", () => {
    applyTheme(themeSelect.value);
  });
}

// -------- Aksharamukha (lazy) --------
let akInstance = null;
let akLoading = null;
const translitCache = new Map();

async function loadAksharamukha() {
  if (akInstance) return akInstance;
  if (akLoading) return akLoading;

  akLoading = new Promise((resolve, reject) => {
    if (window.Aksharamukha?.new) {
      window.Aksharamukha.new().then(inst => {
        akInstance = inst;
        resolve(inst);
      });
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
    s.onerror = () => reject(new Error("Aksharamukha load failed"));
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

// -------- Helpers --------
function setStatus(msg) {
  if (statusBox) statusBox.textContent = msg;
}
function setCompareStatus(msg) {
  if (compareEnabled) compareStatus.textContent = msg;
}

async function fetchJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load ${path}`);
  return await r.json();
}

function updateBadges() {
  repSingleVal.textContent = `${repSingle.value}×`;
  repPairsVal.textContent = `${repPairs.value}×`;
  repFullVal.textContent = `${repFull.value}×`;
  speedVal.textContent = `${Number(speed.value).toFixed(2)}×`;
}

function audioFor(key) {
  if (!current) return null;
  const f = key === "p12" ? current.audio?.p12 :
            key === "p34" ? current.audio?.p34 :
            key === "full" ? current.audio?.full :
            current.audio?.[key];
  if (!f) return null;
  const base = (stotra?.audioBase || "").replace(/\/$/, "");
  return base ? `${base}/${f}` : f;
}

async function playSrc(src) {
  if (!src) return;
  player.pause();
  player.currentTime = 0;
  player.src = src;
  player.playbackRate = Number(speed.value || 1);
  try { await player.play(); } catch {}
}

// -------- Verse render --------
async function renderVerse(v) {
  const script = scriptSelect?.value || "Devanagari";

  meterBox.textContent = v.meter || "—";

  fullLine.textContent = await translit(v.full || "—", script);

  const base = v.text || {};
  const pr = v.practice || base;
  const t = usePractice.checked ? pr : base;

  pada1.textContent = await translit(t.p1 || "", script);
  pada2.textContent = await translit(t.p2 || "", script);
  pada3.textContent = await translit(t.p3 || "", script);
  pada4.textContent = await translit(t.p4 || "", script);

  arthaSa.textContent = v.gloss?.sa || "";
  meaningEn.textContent = v.gloss?.en || "";
}

// -------- Load verse --------
async function loadVerse(v) {
  current = v;
  current.mode ||= "normal";

  brandTitle.textContent = stotra?.title || "Learn Stotras";
  brandSub.textContent = stotra?.subtitle || "";

  await renderVerse(v);

  const isFullOnly = v.mode === "full_only";
  const split = !!v.needsSplitPractice;

  singleButtons.style.display = (isFullOnly || split) ? "none" : "";

  playP1.disabled = isFullOnly || split || !v.audio?.p1;
  playP2.disabled = isFullOnly || split || !v.audio?.p2;
  playP3.disabled = isFullOnly || split || !v.audio?.p3;
  playP4.disabled = isFullOnly || split || !v.audio?.p4;
  playP12.disabled = isFullOnly || !v.audio?.p12;
  playP34.disabled = isFullOnly || !v.audio?.p34;
  playFull.disabled = !v.audio?.full;

  setStatus("Ready.");
}

// -------- Init --------
async function init() {
  updateBadges();
  initTheme(); // <-- FIX: apply + listen for theme changes

  stotraIndex = await fetchJSON("stotras/index.json");
  stotraIndex.stotras.forEach(s => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.title || s.id;
    stotraSelect.appendChild(o);
  });

  stotraSelect.value = stotraIndex.stotras[0].id;
  stotra = await fetchJSON(stotraIndex.stotras[0].path);
  verses = await fetchJSON(stotra.versesPath);

  verses.forEach(v => {
    const o = document.createElement("option");
    o.value = v.id;
    o.textContent = v.title || v.id;
    verseSelect.appendChild(o);
  });

  // Script preference
  const savedScript = localStorage.getItem("learnstotras_script");
  if (savedScript && scriptSelect) scriptSelect.value = savedScript;

  await loadVerse(verses[0]);

  // Events
  verseSelect.onchange = () =>
    loadVerse(verses.find(v => v.id === verseSelect.value));

  prevVerse.onclick = () =>
    verseSelect.selectedIndex > 0 &&
    loadVerse(verses[--verseSelect.selectedIndex]);

  nextVerse.onclick = () =>
    verseSelect.selectedIndex < verses.length - 1 &&
    loadVerse(verses[++verseSelect.selectedIndex]);

  playP1.onclick = () => playSrc(audioFor("p1"));
  playP2.onclick = () => playSrc(audioFor("p2"));
  playP3.onclick = () => playSrc(audioFor("p3"));
  playP4.onclick = () => playSrc(audioFor("p4"));
  playP12.onclick = () => playSrc(audioFor("p12"));
  playP34.onclick = () => playSrc(audioFor("p34"));
  playFull.onclick = () => playSrc(audioFor("full"));

  scriptSelect?.addEventListener("change", () => {
    localStorage.setItem("learnstotras_script", scriptSelect.value);
    if (current) loadVerse(current);
  });

  setStatus("Loaded.");
}

init().catch(e => {
  console.error(e);
  setStatus("Init failed");
});
