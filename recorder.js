// Recorder Cockpit for Learn Stotras
// Loads stotras/index.json -> stotra.json -> verses.json
// Records 7 takes per verse: p1 p2 p3 p4 p12 p34 full
// Exports ZIP with filenames: <id>_<take>.webm (or .ogg)
// You can later convert to mp3 in a batch step.

const TAKES = [
  { key: "p1",  label: "P1" },
  { key: "p2",  label: "P2" },
  { key: "p3",  label: "P3" },
  { key: "p4",  label: "P4" },
  { key: "p12", label: "P1+P2" },
  { key: "p34", label: "P3+P4" },
  { key: "full",label: "Full" },
];

const els = {
  stotraSelect: document.getElementById("stotraSelect"),
  verseSelect: document.getElementById("verseSelect"),
  prevVerse: document.getElementById("prevVerse"),
  nextVerse: document.getElementById("nextVerse"),

  verseId: document.getElementById("verseId"),
  verseTitle: document.getElementById("verseTitle"),
  verseFull: document.getElementById("verseFull"),
  p1: document.getElementById("p1"),
  p2: document.getElementById("p2"),
  p3: document.getElementById("p3"),
  p4: document.getElementById("p4"),

  micSelect: document.getElementById("micSelect"),
  formatSelect: document.getElementById("formatSelect"),
  trimSelect: document.getElementById("trimSelect"),
  meterFill: document.getElementById("meterFill"),

  takeGrid: document.getElementById("takeGrid"),
  exportZip: document.getElementById("exportZip"),
  clearVerse: document.getElementById("clearVerse"),
  status: document.getElementById("status"),
};

let stotraIndex = null;
let stotra = null;
let verses = [];
let currentVerse = null;

let audioCtx = null;
let analyser = null;
let meterRAF = null;

let stream = null;
let recorder = null;
let recordingKey = null;
let chunks = [];

let deviceId = null;

// Store takes per verse in-memory: { [verseId]: { [takeKey]: { blob, url, approved, mime } } }
const store = Object.create(null);

function setStatus(msg) { els.status.textContent = msg; }

async function fetchJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
  return await r.json();
}

function setQueryParam(name, value) {
  const u = new URL(window.location.href);
  u.searchParams.set(name, value);
  history.replaceState({}, "", u.toString());
}
function getQueryParam(name) {
  return new URL(window.location.href).searchParams.get(name);
}

function ensureVerseStore(vid) {
  if (!store[vid]) store[vid] = Object.create(null);
  return store[vid];
}

function extFromMime(mime) {
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function makeTakeCard(take) {
  const div = document.createElement("div");
  div.className = "take";
  div.dataset.take = take.key;

  div.innerHTML = `
    <div class="takeHead">
      <div>
        <div class="takeName">${take.label}</div>
        <div class="takeState" id="state-${take.key}">—</div>
      </div>
    </div>

    <div class="takeBtns">
      <button class="btn" data-action="record" data-take="${take.key}">Record</button>
      <button class="btn" data-action="stop" data-take="${take.key}" disabled>Stop</button>
      <button class="btn" data-action="approve" data-take="${take.key}" disabled>Approve</button>
      <button class="btn" data-action="redo" data-take="${take.key}" disabled>Redo</button>
    </div>

    <audio id="audio-${take.key}" controls preload="none"></audio>
  `;

  div.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;
    const key = btn.dataset.take;
    if (action === "record") await startRecording(key);
    if (action === "stop") stopRecording();
    if (action === "approve") approveTake(key);
    if (action === "redo") redoTake(key);
  });

  return div;
}

function renderGrid() {
  els.takeGrid.innerHTML = "";
  TAKES.forEach(t => els.takeGrid.appendChild(makeTakeCard(t)));
  refreshTakeUI();
}

function refreshTakeUI() {
  if (!currentVerse) return;
  const vs = ensureVerseStore(currentVerse.id);

  for (const t of TAKES) {
    const stateEl = document.getElementById(`state-${t.key}`);
    const audioEl = document.getElementById(`audio-${t.key}`);
    const card = els.takeGrid.querySelector(`[data-take="${t.key}"]`);

    const recBtn = card.querySelector(`button[data-action="record"]`);
    const stopBtn = card.querySelector(`button[data-action="stop"]`);
    const approveBtn = card.querySelector(`button[data-action="approve"]`);
    const redoBtn = card.querySelector(`button[data-action="redo"]`);

    const entry = vs[t.key];

    // disable record if another take is recording
    recBtn.disabled = !!recordingKey && recordingKey !== t.key;
    stopBtn.disabled = recordingKey !== t.key;

    if (!entry) {
      stateEl.textContent = "Not recorded";
      audioEl.src = "";
      approveBtn.disabled = true;
      redoBtn.disabled = true;
    } else {
      audioEl.src = entry.url;
      stateEl.textContent = entry.approved ? "Approved ✅" : "Recorded (not approved)";
      approveBtn.disabled = entry.approved;
      redoBtn.disabled = false;
    }
  }

  // enable export only if at least one take exists (or you can require all 7)
  const count = Object.keys(ensureVerseStore(currentVerse.id)).length;
  els.exportZip.disabled = count === 0;
}

async function listMics() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const mics = devices.filter(d => d.kind === "audioinput");

  els.micSelect.innerHTML = "";
  mics.forEach((m, i) => {
    const opt = document.createElement("option");
    opt.value = m.deviceId;
    opt.textContent = m.label || `Microphone ${i + 1}`;
    els.micSelect.appendChild(opt);
  });

  if (mics.length) {
    const saved = localStorage.getItem("recorder:deviceId");
    const pick = saved && mics.some(m => m.deviceId === saved) ? saved : mics[0].deviceId;
    els.micSelect.value = pick;
    deviceId = pick;
  }
}

async function getStream() {
  if (stream) return stream;

  const constraints = {
    audio: deviceId ? { deviceId: { exact: deviceId } } : true
  };

  stream = await navigator.mediaDevices.getUserMedia(constraints);

  // meter
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  startMeter();

  return stream;
}

function startMeter() {
  if (!analyser) return;
  const data = new Uint8Array(analyser.fftSize);

  function tick() {
    analyser.getByteTimeDomainData(data);
    // RMS-ish
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    const pct = Math.min(100, Math.max(0, rms * 140)); // simple scaling
    els.meterFill.style.width = `${pct}%`;
    meterRAF = requestAnimationFrame(tick);
  }

  if (!meterRAF) meterRAF = requestAnimationFrame(tick);
}

function stopMeter() {
  if (meterRAF) cancelAnimationFrame(meterRAF);
  meterRAF = null;
}

function stopStream() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  if (audioCtx) audioCtx.close();
  audioCtx = null;
  analyser = null;
  stopMeter();
}

async function startRecording(takeKey) {
  if (!currentVerse) return;
  if (recordingKey) return;

  const mime = els.formatSelect.value;
  if (!MediaRecorder.isTypeSupported(mime)) {
    setStatus(`Format not supported: ${mime}. Try webm.`);
    return;
  }

  await getStream();

  chunks = [];
  recordingKey = takeKey;

  // Visual recording indicator
const card = els.takeGrid.querySelector(`[data-take="${takeKey}"]`);
if (card) {
  const recBtn = card.querySelector(`button[data-action="record"]`);
  const stopBtn = card.querySelector(`button[data-action="stop"]`);
  recBtn.classList.add("recording");
  stopBtn.classList.add("stop-active");
}

  recorder = new MediaRecorder(stream, { mimeType: mime });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: mime });
    const url = URL.createObjectURL(blob);

    const vs = ensureVerseStore(currentVerse.id);
    // revoke prior
    if (vs[takeKey]?.url) URL.revokeObjectURL(vs[takeKey].url);

    vs[takeKey] = { blob, url, approved: false, mime };
    recordingKey = null;
    recorder = null;
    chunks = [];

    setStatus(`Recorded ${takeKey} for ${currentVerse.id}.`);
    // Clear recording indicator
const cards = els.takeGrid.querySelectorAll(".take");
cards.forEach(card => {
  card.querySelectorAll(".btn").forEach(b => {
    b.classList.remove("recording", "stop-active");
  });
});

	refreshTakeUI();
  };

  recorder.start();
setStatus(`● Recording ${takeKey.toUpperCase()} — press Stop to finish`);
  refreshTakeUI();
}

function stopRecording() {
  if (!recorder) return;
  recorder.stop();
  setStatus("Stopping…");
}

function approveTake(takeKey) {
  if (!currentVerse) return;
  const vs = ensureVerseStore(currentVerse.id);
  if (!vs[takeKey]) return;
  vs[takeKey].approved = true;
  setStatus(`Approved ${takeKey}.`);
  refreshTakeUI();
}

function redoTake(takeKey) {
  if (!currentVerse) return;
  const vs = ensureVerseStore(currentVerse.id);
  const entry = vs[takeKey];
  if (!entry) return;

  if (entry.url) URL.revokeObjectURL(entry.url);
  delete vs[takeKey];

  setStatus(`Cleared ${takeKey}.`);
  refreshTakeUI();
}

function clearCurrentVerse() {
  if (!currentVerse) return;
  const vs = ensureVerseStore(currentVerse.id);
  for (const k of Object.keys(vs)) {
    if (vs[k]?.url) URL.revokeObjectURL(vs[k].url);
  }
  store[currentVerse.id] = Object.create(null);
  setStatus(`Cleared all takes for ${currentVerse.id}.`);
  refreshTakeUI();
}

function renderVerse(v) {
  currentVerse = v;
  els.verseId.textContent = v.id;
  els.verseTitle.textContent = v.title || "";
  els.verseFull.textContent = v.full || "";

  // show practice text padas if available, else canonical
  const t = v.practice || v.text || {};
  els.p1.textContent = t.p1 || "";
  els.p2.textContent = t.p2 || "";
  els.p3.textContent = t.p3 || "";
  els.p4.textContent = t.p4 || "";

  refreshTakeUI();
}

function selectVerseByIndex(i) {
  if (!verses.length) return;
  const idx = Math.max(0, Math.min(i, verses.length - 1));
  els.verseSelect.selectedIndex = idx;
  renderVerse(verses[idx]);
}

async function loadStotra(stotraId) {
  const entry = stotraIndex.stotras.find(s => s.id === stotraId);
  if (!entry) throw new Error(`Unknown stotra id: ${stotraId}`);

  stotra = await fetchJSON(entry.path);
  verses = await fetchJSON(stotra.versesPath);

  // populate verse list
  els.verseSelect.innerHTML = "";
  verses.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.title || v.id;
    els.verseSelect.appendChild(opt);
  });

  selectVerseByIndex(0);
  setStatus(`Loaded ${stotra.title || entry.title}.`);
}

async function exportVerseZip() {
  if (!currentVerse) return;
  const vs = ensureVerseStore(currentVerse.id);
  const keys = Object.keys(vs);

  if (!keys.length) {
    setStatus("Nothing to export for this verse.");
    return;
  }

  // Optional: require approval before export
  // const notApproved = TAKES.filter(t => vs[t.key] && !vs[t.key].approved);
  // if (notApproved.length) { setStatus("Approve all recorded takes before exporting."); return; }

  const zip = new JSZip();
  const mime = els.formatSelect.value;
  const ext = extFromMime(mime);

  // Put files in a folder named "audio" to match your repo structure
  const folder = zip.folder("audio");
  for (const t of TAKES) {
    const entry = vs[t.key];
    if (!entry) continue;
    const fn = `${currentVerse.id}_${t.key}.${ext}`;
    folder.file(fn, entry.blob);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${currentVerse.id}_takes.zip`;
  a.click();
  URL.revokeObjectURL(a.href);

  setStatus(`Exported ZIP for ${currentVerse.id}.`);
}

async function init() {
  // Ask permission early so mic labels show up
  try { await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { /* ignore; user will allow when recording */ }

  await listMics();
  renderGrid();

  stotraIndex = await fetchJSON("stotras/index.json");

  // stotra selector
  els.stotraSelect.innerHTML = "";
  stotraIndex.stotras.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.title || s.id;
    els.stotraSelect.appendChild(opt);
  });

  const fromUrl = getQueryParam("stotra");
  const initial = fromUrl && stotraIndex.stotras.some(x => x.id === fromUrl)
    ? fromUrl
    : stotraIndex.stotras[0].id;

  els.stotraSelect.value = initial;
  setQueryParam("stotra", initial);
  await loadStotra(initial);

  // events
  els.micSelect.addEventListener("change", async () => {
    deviceId = els.micSelect.value;
    localStorage.setItem("recorder:deviceId", deviceId);
    stopStream();
    setStatus("Mic changed. Ready.");
  });

  els.stotraSelect.addEventListener("change", async () => {
    if (recordingKey) return;
    const id = els.stotraSelect.value;
    setQueryParam("stotra", id);
    setStatus("Loading…");
    await loadStotra(id);
  });

  els.verseSelect.addEventListener("change", () => {
    selectVerseByIndex(els.verseSelect.selectedIndex);
  });

  els.prevVerse.addEventListener("click", () => selectVerseByIndex(els.verseSelect.selectedIndex - 1));
  els.nextVerse.addEventListener("click", () => selectVerseByIndex(els.verseSelect.selectedIndex + 1));

  els.exportZip.addEventListener("click", exportVerseZip);
  els.clearVerse.addEventListener("click", clearCurrentVerse);

  window.addEventListener("beforeunload", () => {
    // cleanup
    stopStream();
    for (const vid of Object.keys(store)) {
      for (const k of Object.keys(store[vid])) {
        if (store[vid][k]?.url) URL.revokeObjectURL(store[vid][k].url);
      }
    }
  });
}

init().catch(err => {
  console.error(err);
  setStatus(`Init failed: ${err.message}`);
});
