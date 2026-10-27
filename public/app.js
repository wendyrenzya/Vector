import { createVTracer } from "/vendor/vtracer/index.js";
import { potrace, init as initPotrace } from "/vendor/potrace/index.js";

const MAX_SIDE = 2048;
const MIN_SIDE = 600; // gambar lebih kecil dari ini diperbesar dulu supaya kurvanya halus
const UPSCALE_TO = 800;
const MAX_UPSCALE = 4;
const ACCEPT = ["image/png", "image/jpeg"];

const drop = document.getElementById("drop");
const input = document.getElementById("file");
const preview = document.getElementById("preview");
const info = document.getElementById("info");
const tools = document.getElementById("tools");
const result = document.getElementById("result");
const out = document.getElementById("out");
const status = document.getElementById("status");
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
  schedule(0);
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
    URL.revokeObjectURL(out.src);
    out.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const paths = (svg.match(/<path/g) || []).length;
    status.textContent = `${paths} path, ${(svg.length / 1024).toFixed(1)} KB, ${Math.round(performance.now() - t0)} ms${k > 1 ? `, diperbesar ${k}×` : ""}`;
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
