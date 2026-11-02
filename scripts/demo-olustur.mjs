// demo/sablon.html'den iki çıktı üretir:
//   dist/isbirligim-asistan.html : claude.ai'de yayınlanan canlı test sayfası (veri gömülü)
//   public/index.html            : Node sunucusunun arayüzü (/api/asistan kullanır)
import { readFile, writeFile, mkdir } from "node:fs/promises";

const kok = new URL("../", import.meta.url);
const oku = (p) => readFile(new URL(p, kok), "utf8");
const modul = (s) => s.replace(/^import .*$/gm, "").replace(/^export (const|function|async function|let) /gm, "$1 ");
const cekirdek = [await oku("src/uyum.js"), await oku("src/araclar.js"), await oku("src/promptlar.js")].map(modul).join("\n");
const sablon = await oku("demo/sablon.html");
const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

const inf = JSON.parse(await oku("data/influencerlar.json"));
const veri = { influencerlar: inf.influencerlar, fiyatRehberi: JSON.parse(await oku("data/fiyat-rehberi.json")),
  kampanyalar: JSON.parse(await oku("data/kampanyalar.json")).kampanyalar, cekilme: inf.cekilme };

const yap = (motor, ek = "") => sablon
  .replace("/*@@CEKIRDEK@@*/", () => ek + cekirdek)
  .replace("/*@@MOTOR@@*/", () => motor);

const sayfa = yap(await oku("demo/motor/claude-sayfa.js"), `const VERI = ${json(veri)};\n`);
const sunucu = yap(await oku("demo/motor/sunucu-api.js"));
await mkdir(new URL("dist/", kok), { recursive: true });
await writeFile(new URL("dist/isbirligim-asistan.html", kok), sayfa);
await writeFile(new URL("public/index.html", kok),
  `<!doctype html>\n<html lang="tr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>[hidden]{display:none!important}body{margin:0}</style>\n</head>\n<body>\n${sunucu}\n</body>\n</html>\n`);
console.log(`dist/isbirligim-asistan.html ${(sayfa.length / 1024).toFixed(0)} KB, public/index.html ${(sunucu.length / 1024).toFixed(0)} KB`);
