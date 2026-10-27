import { createVTracer } from "/vendor/vtracer/index.js";
import { potrace, init as initPotrace } from "/vendor/potrace/index.js";

const MAX_SIDE = 2048;
const MIN_SIDE = 600; // gambar lebih kecil dari ini diperbesar dulu supaya kurvanya halus
const UPSCALE_TO = 800;
const MAX_UPSCALE = 4;
const MAX_ZOOM = 16;
const ACCEPT = ["image/png", "image/jpeg"];

const drop = document.getElementById("drop");
const input = document.getElementById("file");
const preview = document.getElementById("preview");
const info = document.getElementById("info");
const tools = document.getElementById("tools");
const result = document.getElementById("result");
const out = document.getElementById("out");
const status = document.getElementById("status");
const panes = [...document.querySelectorAll(".pane")];
const zlevel = document.getElementById("zlevel");
const dl = document.getElementById("dl");
const modeEl = document.getElementById("mode");
const sliders = {
  colors: document.getElementById("colors"),
  threshold: document.getElementById("threshold"),
  speckle: document.getElementById("speckle"),
  smooth: document.getElementById("smooth"),
};

const tracer = createVTracer();
const potraceReady = initPotrace();
let runId = 0;
let timer = 0;
let lastSvg = "";
let baseName = "vector";
const view = { s: 1, x: 0, y: 0 };

// Hitung ukuran akhir: sisi panjang dibatasi MAX_SIDE, rasio dijaga.
export function fitSize(w, h, max = MAX_SIDE) {
  const long = Math.max(w, h);
  if (long <= max) return { w, h, scaled: false };
  const k = max / long;
  return { w: Math.round(w * k), h: Math.round(h * k), scaled: true };
}

// Hanya untuk mode B/W: gambar kecil diperbesar dulu supaya kurva Potrace halus.
// Mode warna tidak diperbesar, karena penghalusan membuat pita gradasi di tepi
// bentuk yang membengkakkan jumlah path.
function upscaleFactor(w, h) {
  const long = Math.max(w, h);
  return long < MIN_SIDE ? Math.min(MAX_UPSCALE, Math.ceil(UPSCALE_TO / long)) : 1;
}

function bwPixels() {
  const { width, height } = preview;
  const k = upscaleFactor(width, height);
  if (k === 1) return { id: preview.getContext("2d").getImageData(0, 0, width, height), k };
  const c = document.createElement("canvas");
  c.width = width * k;
  c.height = height * k;
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(preview, 0, 0, c.width, c.height);
  return { id: g.getImageData(0, 0, c.width, c.height), k };
}

async function load(file) {
  if (!ACCEPT.includes(file.type)) {
    info.textContent = "Format tidak didukung. Gunakan PNG atau JPG.";
    return;
  }
  const bmp = await createImageBitmap(file);
  const size = fitSize(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const g = canvas.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, size.w, size.h);
  bmp.close();

  preview.width = size.w;
  preview.height = size.h;
  preview.getContext("2d").drawImage(canvas, 0, 0);
  tools.hidden = false;
  result.hidden = false;
  info.textContent = size.scaled
    ? `${file.name}: diperkecil ke ${size.w}×${size.h}px`
    : `${file.name}: ${size.w}×${size.h}px`;
  baseName = file.name.replace(/\.[^.]+$/, "") || "vector";
  for (const p of panes) p.style.aspectRatio = `${size.w} / ${size.h}`;
  lastSvg = "";
  dl.disabled = true;
  view.s = 1;
  view.x = view.y = 0;
  applyView();
  schedule(0);
}

// Samakan SVG kedua engine: buang DOCTYPE, width/height = ukuran gambar asli,
// viewBox = ruang koordinat hasil trace (beda kalau gambar diperbesar dulu).
// VTracer tidak menulis viewBox sama sekali, tanpanya SVG tidak ikut skala.
function finalizeSvg(svg, tw, th, w, h) {
  return svg
    .replace(/<!DOCTYPE[^>]*>/i, "")
    .replace(/<svg\b[^>]*>/, (tag) =>
      tag
        .replace(/\s(width|height|viewBox)="[^"]*"/g, "")
        .replace(/>$/, ` width="${w}" height="${h}" viewBox="0 0 ${tw} ${th}">`),
    );
}

function applyView() {
  const w = panes[0].clientWidth;
  const h = panes[0].clientHeight;
  view.x = Math.min(0, Math.max(w * (1 - view.s), view.x));
  view.y = Math.min(0, Math.max(h * (1 - view.s), view.y));
  const t = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  preview.style.transform = t;
  out.style.transform = t;
  for (const p of panes) p.style.touchAction = view.s > 1 ? "none" : "pan-y";
  zlevel.textContent = `${Math.round(view.s * 100)}%`;
}

// Zoom di titik (px, py) relatif terhadap pane, titik itu tetap di tempatnya.
function zoomAt(px, py, factor) {
  const s = Math.min(MAX_ZOOM, Math.max(1, view.s * factor));
  const k = s / view.s;
  view.x = px - (px - view.x) * k;
  view.y = py - (py - view.y) * k;
  view.s = s;
  applyView();
}

function zoomCenter(factor) {
  zoomAt(panes[0].clientWidth / 2, panes[0].clientHeight / 2, factor);
}

// Opsi VTracer dari slider. Kehalusan 0 berarti simplify mati.
function optionsFrom(v) {
  return {
    preset: "poster",
    maxColors: v.colors,
    filterSpeckle: v.speckle,
    simplify: v.smooth > 0 ? v.smooth / 10 : null,
  };
}

function schedule(delay = 300) {
  clearTimeout(timer);
  timer = setTimeout(trace, delay);
}

// Potrace tidak punya ambang sendiri: ubah ke hitam/putih dulu.
// Piksel transparan dianggap putih.
function binarize(id, threshold) {
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = lum * a + 255 * (1 - a) < threshold ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  return id;
}

async function trace() {
  const id = ++runId;
  const bw = modeEl.value === "bw";
  const { width, height } = preview;
  const { id: imgData, k } = bw
    ? bwPixels()
    : { id: preview.getContext("2d").getImageData(0, 0, width, height), k: 1 };
  const values = Object.fromEntries(
    Object.entries(sliders).map(([k, el]) => [k, Number(el.value)]),
  );
  status.textContent = "Memproses…";
  const t0 = performance.now();
  try {
    let svg;
    if (bw) {
      await potraceReady;
      svg = await potrace(binarize(imgData, values.threshold), {
        extractcolors: false,
        turdsize: values.speckle * values.speckle, // slider = sisi bintik, turdsize = luas
        alphamax: 1,
        opticurve: 1,
        opttolerance: 0.2,
      });
    } else {
      svg = await tracer.convertPixels(imgData.data, width, height, {
        ...optionsFrom(values),
        onProgress: ({ phase, fraction }) => {
          if (id === runId) status.textContent = `Memproses (${phase}) ${Math.round(fraction * 100)}%`;
        },
      });
    }
    if (id !== runId) return; // hasil basi, ada proses yang lebih baru
    lastSvg = finalizeSvg(svg, imgData.width, imgData.height, width, height);
    URL.revokeObjectURL(out.src);
    out.src = URL.createObjectURL(new Blob([lastSvg], { type: "image/svg+xml" }));
    dl.disabled = false;
    const paths = (lastSvg.match(/<path/g) || []).length;
    status.textContent = `${paths} path, ${(lastSvg.length / 1024).toFixed(1)} KB, ${Math.round(performance.now() - t0)} ms${k > 1 ? `, diperbesar ${k}×` : ""}`;
  } catch (e) {
    if (id === runId) status.textContent = `Gagal: ${e.message}`;
  }
}

for (const [name, el] of Object.entries(sliders)) {
  el.addEventListener("input", () => {
    document.getElementById(`o-${name}`).textContent = el.value;
    schedule();
  });
}

document.getElementById("zin").addEventListener("click", () => zoomCenter(2));
document.getElementById("zout").addEventListener("click", () => zoomCenter(0.5));
document.getElementById("zfit").addEventListener("click", () => {
  view.s = 1;
  view.x = view.y = 0;
  applyView();
});
dl.addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lastSvg], { type: "image/svg+xml" }));
  a.download = `${baseName}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

for (const pane of panes) {
  pane.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = pane.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.002));
  }, { passive: false });
  pane.addEventListener("pointerdown", (e) => {
    pane.setPointerCapture(e.pointerId);
    pane.dataset.drag = `${e.clientX},${e.clientY}`;
  });
  pane.addEventListener("pointermove", (e) => {
    if (!pane.dataset.drag) return;
    const [x0, y0] = pane.dataset.drag.split(",").map(Number);
    view.x += e.clientX - x0;
    view.y += e.clientY - y0;
    pane.dataset.drag = `${e.clientX},${e.clientY}`;
    applyView();
  });
  const end = () => delete pane.dataset.drag;
  pane.addEventListener("pointerup", end);
  pane.addEventListener("pointercancel", end);
  pane.addEventListener("dblclick", () => document.getElementById("zfit").click());
}
window.addEventListener("resize", applyView);

modeEl.addEventListener("change", () => {
  for (const el of document.querySelectorAll("#tools [data-mode]")) {
    el.hidden = el.dataset.mode !== modeEl.value;
  }
  schedule(0);
});

function pick(files) {
  if (files && files[0]) load(files[0]).catch(() => {
    info.textContent = "Gagal membaca gambar.";
  });
}

input.addEventListener("change", () => pick(input.files));
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  pick(e.dataTransfer.files);
});
