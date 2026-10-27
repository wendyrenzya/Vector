// Salin berkas runtime vtracer-browser ke public/ supaya disajikan same-origin.
// index.js memuat worker.js, dan worker.js memuat wasm, semuanya lewat path relatif.
import { cpSync, mkdirSync } from "node:fs";

const src = new URL("../node_modules/vtracer-browser/dist/", import.meta.url);
const dst = new URL("../public/vendor/vtracer/", import.meta.url);

mkdirSync(dst, { recursive: true });
for (const f of ["index.js", "worker.js", "vtracer_bg.wasm"]) {
  cpSync(new URL(f, src), new URL(f, dst));
}
// esm-potrace-wasm: satu berkas, wasm sudah tertanam di dalamnya.
const pSrc = new URL("../node_modules/esm-potrace-wasm/dist/index.js", import.meta.url);
const pDst = new URL("../public/vendor/potrace/", import.meta.url);
mkdirSync(pDst, { recursive: true });
cpSync(pSrc, new URL("index.js", pDst));
console.log("vendor: vtracer-browser dan esm-potrace-wasm disalin ke public/vendor/");
