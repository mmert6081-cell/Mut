// isbirligim.com.tr'nin herkese açık (sunucuda önceden oluşturulmuş) sayfalarından
// influencer, fiyat rehberi ve kampanya verisini çekip data/ altına yazar.
// Kullanım: node scripts/veri-guncelle.mjs
import { writeFile } from "node:fs/promises";

const B = "https://isbirligim.com.tr";
const UA = { "User-Agent": "isbirligim-ai-asistan/1.0" };
const get = async (u) => {
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error(`${u} -> HTTP ${r.status}`);
  return r.text();
};
const ENT = { "&amp;": "&", "&#39;": "'", "&quot;": '"', "&lt;": "<", "&gt;": ">" };
const txt = (s) => s.replace(/<[^>]+>/g, " ").replace(/&(amp|#39|quot|lt|gt);/g, (m) => ENT[m]).replace(/[ \t]+/g, " ").trim();
const kok = (h) => h.split('<div id="root">')[1] ?? "";

export function takipciSayisi(s) {
  const m = s.trim().match(/^([\d.,]+)\s*(B|M|Mn)?/);
  if (!m) return 0;
  const v = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  return Math.round(m[2] === "B" ? v * 1e3 : m[2] ? v * 1e6 : v);
}

export function profilAyristir(id, html) {
  const body = kok(html);
  const ad = txt(body.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? "");
  const ps = [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => txt(m[1]));
  let kullanici = ps[0]?.startsWith("@") ? ps[0].slice(1) : "";
  if (kullanici.startsWith("http")) kullanici = kullanici.replace(/.*instagram\.com\/([^/?]+).*/, "$1");
  const meta = ps.find((p) => p.includes("takipçi") && p.includes("·")) ?? "";
  const seg = meta.split("·").map((s) => s.trim());
  const fi = seg.findIndex((s) => /takipçi/.test(s));
  const pre = fi >= 0 ? seg.slice(0, fi) : seg;
  let kategoriler = [], sehir = "";
  if (pre.length === 2) { kategoriler = pre[0].split(",").map((s) => s.trim()); sehir = pre[1]; }
  else if (pre.length === 1) { if (pre[0].includes("&") || pre[0].includes(",")) kategoriler = pre[0].split(",").map((s) => s.trim()); else sehir = pre[0]; }
  const takipci = fi >= 0 ? takipciSayisi(seg[fi]) : 0;
  const platform = fi >= 0 && seg[fi + 1] ? seg[fi + 1].split(",").map((s) => s.trim()) : [];
  const hakkinda = (body.match(/Hakkında<\/h2>\s*<p>([\s\S]*?)<\/p>/)?.[1] ?? "");
  const fiyatlar = {};
  for (const m of body.matchAll(/<li>\s*([^:<]+):\s*([\d.]+)\s*₺/g)) fiyatlar[m[1].trim()] = Number(m[2].replace(/\./g, ""));
  return {
    id, ad, kullanici, kategoriler: kategoriler.filter(Boolean), sehir, takipci, platform,
    dogrulanmis: body.includes("Doğrulanmış hesap"),
    hakkinda: txt(hakkinda).slice(0, 400), fiyatlar,
  };
}

export function fiyatRehberiAyristir(html) {
  const body = kok(html);
  const tarih = body.match(/\((\d{4}-\d{2}-\d{2})\)/)?.[1] ?? null;
  const tablolar = [...body.matchAll(/<table>([\s\S]*?)<\/table>/g)].map((t) =>
    [...t[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[dh]>([\s\S]*?)<\/t[dh]>/g)].map((c) => txt(c[1]))));
  const tl = (s) => Number(String(s).replace(/[^\d]/g, "")) || null;
  const satir = (r) => ({ ad: r[0], adet: Number(r[1]) || null, reels: tl(r[2]), gonderi: tl(r[3]), hikaye: tl(r[4]) });
  const veri = tablolar.map((t) => t.filter((r) => r.length >= 5 && !/^(Takipçi|Kategori)$/.test(r[0])).map(satir));
  return { tarih, takipciyeGore: veri[0] ?? [], kategoriyeGore: veri[1] ?? [] };
}

async function havuz(isler, n, fn) {
  const out = new Array(isler.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < isler.length) { const k = i++; out[k] = await fn(isler[k]); } }));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sitemap = await get(`${B}/sitemap.xml`);
  const ids = [...new Set([...sitemap.matchAll(/\/influencer\/([0-9a-f-]{36})/g)].map((m) => m[1]))];
  const influencerlar = (await havuz(ids, 6, async (id) => profilAyristir(id, await get(`${B}/influencer/${id}`))))
    .sort((a, b) => b.takipci - a.takipci);
  const fiyatRehberi = fiyatRehberiAyristir(await get(`${B}/influencer-fiyatlari`));
  const kIds = [...new Set([...sitemap.matchAll(/\/kampanya\/([0-9a-f-]{36})/g)].map((m) => m[1]))];
  const kampanyalar = await havuz(kIds, 4, async (id) => {
    const b = kok(await get(`${B}/kampanya/${id}`));
    const ps = [...b.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => txt(m[1]));
    return { id, baslik: txt(b.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? ""), marka: ps[0] ?? "", aciklama: (ps.slice(1).join("\n")).slice(0, 1200) };
  });
  const meta = { kaynak: B, cekilme: new Date().toISOString().slice(0, 10) };
  await writeFile(new URL("../data/influencerlar.json", import.meta.url), JSON.stringify({ ...meta, influencerlar }, null, 1));
  await writeFile(new URL("../data/fiyat-rehberi.json", import.meta.url), JSON.stringify({ ...meta, ...fiyatRehberi }, null, 1));
  await writeFile(new URL("../data/kampanyalar.json", import.meta.url), JSON.stringify({ ...meta, kampanyalar }, null, 1));
  console.log(`${influencerlar.length} influencer (${influencerlar.filter((x) => Object.keys(x.fiyatlar).length).length} fiyatlı), ` +
    `${fiyatRehberi.takipciyeGore.length}+${fiyatRehberi.kategoriyeGore.length} fiyat satırı, ${kampanyalar.length} kampanya`);
}
