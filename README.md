# Vector

Konversi gambar raster (PNG/JPG) ke vektor SVG dan PDF, sepenuhnya di browser.
Live di https://vector.qilo.one

## Stack
- Cloudflare Workers (static assets)
- VTracer (WASM, MIT) untuk mode warna
- Potrace (WASM, GPL) untuk mode hitam-putih
- svg2pdf.js + jsPDF (MIT) untuk ekspor PDF

## Dev
```
npm install
npm run dev
```

## Deploy
Push ke `main` menjalankan `.github/workflows/deploy.yml` (npm ci + wrangler deploy ke vector.qilo.one).
Secret repo yang dibutuhkan: `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID`.

## Lisensi
GPL-2.0 (karena memakai Potrace lewat esm-potrace-wasm, berlisensi GPL-2.0). Lihat file LICENSE.
