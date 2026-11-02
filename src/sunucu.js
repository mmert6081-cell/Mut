// Bağımlılıksız HTTP sunucusu (node:http).
//   GET  /                 -> sohbet arayüzü (public/index.html)
//   GET  /api/saglik       -> durum
//   POST /api/asistan      -> {oturum?, rol, mesaj} => {oturum, yanit, araclar}
//   POST /api/uyum         -> {metin, kategori?, reklam_veren?} => uyum raporu (LLM'siz)
// Ortam: ANTHROPIC_API_KEY, PORT (3000), MODEL, EFFORT, FALLBACK=0 (kapatmak için)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { asistanCalistir, VARSAYILAN_MODEL } from "./asistan.js";
import { uyumKontrol } from "./uyum.js";

const kok = new URL("../", import.meta.url);
export async function veriYukle() {
  const oku = async (f) => JSON.parse(await readFile(new URL(`data/${f}`, kok), "utf8"));
  const [inf, fiyat, kamp] = await Promise.all([oku("influencerlar.json"), oku("fiyat-rehberi.json"), oku("kampanyalar.json")]);
  return { influencerlar: inf.influencerlar, fiyatRehberi: fiyat, kampanyalar: kamp.kampanyalar, cekilme: inf.cekilme };
}

const OTURUM_OMRU = 60 * 60 * 1000;      // 1 saat
const MAKS_MESAJ = 4000;                  // karakter
const DAKIKA_LIMITI = 12;                 // IP başına dakikada istek

export function sunucuOlustur({ client, veri, model = VARSAYILAN_MODEL, effort = "medium", fallback = true }) {
  const oturumlar = new Map();            // id -> {rol, gecmis, son}
  const sayac = new Map();                // ip -> [zamanlar]
  let arayuz = null;

  const temizle = () => {
    const simdi = Date.now();
    for (const [id, o] of oturumlar) if (simdi - o.son > OTURUM_OMRU) oturumlar.delete(id);
  };
  const sinirAsildi = (ip) => {
    const simdi = Date.now();
    const z = (sayac.get(ip) ?? []).filter((t) => simdi - t < 60_000);
    z.push(simdi); sayac.set(ip, z);
    return z.length > DAKIKA_LIMITI;
  };
  const gonder = (res, kod, govde, tur = "application/json; charset=utf-8") => {
    res.writeHead(kod, { "Content-Type": tur, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    res.end(typeof govde === "string" ? govde : JSON.stringify(govde));
  };
  const govdeOku = (req) => new Promise((ok, red) => {
    let b = ""; req.setEncoding("utf8");
    req.on("data", (p) => { b += p; if (b.length > 64_000) { red(new Error("çok büyük")); req.destroy(); } });
    req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { red(new Error("geçersiz JSON")); } });
  });

  return http.createServer(async (req, res) => {
    const yol = new URL(req.url, "http://x").pathname;
    try {
      if (req.method === "GET" && (yol === "/" || yol === "/index.html")) {
        arayuz ??= await readFile(new URL("public/index.html", kok), "utf8");
        return gonder(res, 200, arayuz, "text/html; charset=utf-8");
      }
      if (req.method === "GET" && yol === "/api/saglik") {
        return gonder(res, 200, { durum: "ok", model, llm: Boolean(client), influencer: veri.influencerlar.length, veri_tarihi: veri.cekilme });
      }
      if (req.method === "POST" && yol === "/api/uyum") {
        const g = await govdeOku(req);
        return gonder(res, 200, uyumKontrol({ metin: String(g.metin ?? "").slice(0, MAKS_MESAJ), kategori: g.kategori, reklam_veren: g.reklam_veren }));
      }
      if (req.method === "POST" && yol === "/api/asistan") {
        const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
        if (sinirAsildi(ip)) return gonder(res, 429, { hata: "Çok fazla istek. Bir dakika sonra tekrar deneyin." });
        if (!client) return gonder(res, 503, { hata: "LLM yapılandırılmamış: sunucuda ANTHROPIC_API_KEY tanımlı değil." });
        const g = await govdeOku(req);
        const mesaj = String(g.mesaj ?? "").trim();
        if (!mesaj) return gonder(res, 400, { hata: "mesaj boş" });
        if (mesaj.length > MAKS_MESAJ) return gonder(res, 400, { hata: `mesaj en fazla ${MAKS_MESAJ} karakter olabilir` });
        temizle();
        let id = typeof g.oturum === "string" && oturumlar.has(g.oturum) ? g.oturum : null;
        const rol = g.rol === "influencer" ? "influencer" : "marka";
        if (id && oturumlar.get(id).rol !== rol) id = null;            // rol değişti: yeni sohbet
        if (!id) { id = randomUUID(); oturumlar.set(id, { rol, gecmis: [], son: Date.now(), mesgul: false }); }
        const o = oturumlar.get(id);
        if (o.mesgul) return gonder(res, 409, { hata: "Önceki mesaj hâlâ yanıtlanıyor." });
        o.mesgul = true;
        try {
          const r = await asistanCalistir({ client, veri, rol, gecmis: o.gecmis, mesaj, model, effort, fallback });
          o.gecmis = r.gecmis; o.son = Date.now();
          return gonder(res, 200, { oturum: id, yanit: r.yanit, araclar: r.araclar, durma: r.durma });
        } finally { o.mesgul = false; }
      }
      return gonder(res, 404, { hata: "bulunamadı" });
    } catch (e) {
      const durum = e?.status && e.status >= 400 && e.status < 600 ? (e.status === 429 ? 429 : 502) : 400;
      console.error("[asistan]", e?.status ?? "", e?.message ?? e);
      return gonder(res, durum, { hata: durum === 400 ? String(e.message) : "Yapay zekâ servisine ulaşılamadı, lütfen tekrar deneyin." });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const veri = await veriYukle();
  let client = null;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    client = new Anthropic();
  } else {
    console.warn("ANTHROPIC_API_KEY yok: /api/asistan 503 döner, /api/uyum çalışır.");
  }
  const port = Number(process.env.PORT) || 3000;
  sunucuOlustur({ client, veri, model: process.env.MODEL || VARSAYILAN_MODEL, effort: process.env.EFFORT || "medium",
    fallback: process.env.FALLBACK !== "0" })
    .listen(port, () => console.log(`İşbirliğim AI asistan: http://localhost:${port}  (${veri.influencerlar.length} influencer)`));
}
