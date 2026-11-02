// Asistanın kullandığı araçlar. Saf fonksiyonlar: veri parametreyle gelir,
// hem Node sunucusunda hem tarayıcıda (demo) aynen çalışır.
import { uyumKontrol } from "./uyum.js";

const SITE = "https://isbirligim.com.tr";
export const ICERIK_TURLERI = ["Reels", "Gönderi", "Hikâye", "Video"];
// Sitede bazı profiller "1 ₺", "3 ₺" gibi (muhtemelen "bin ₺" kastıyla) fiyat girmiş.
// Bunlar hesaplamaları bozmasın diye bu eşiğin altı geçersiz sayılır.
export const MIN_GECERLI_FIYAT = 100;
const gf = (inf) => Object.fromEntries(Object.entries(inf.fiyatlar ?? {}).filter(([, v]) => v >= MIN_GECERLI_FIYAT));
const supheli = (inf) => Object.entries(inf.fiyatlar ?? {}).filter(([, v]) => v < MIN_GECERLI_FIYAT).map(([k]) => k);

const sade = (s) => String(s ?? "").toLocaleLowerCase("tr-TR")
  .replace(/[çğıöşüâî]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i" })[c])
  .replace(/&/g, " ").replace(/\s+/g, " ").trim();
const icerikTuru = (t) => {
  const s = sade(t);
  if (!s) return null;
  if (s.startsWith("reel")) return "Reels";
  if (s.startsWith("gon") || s.startsWith("post")) return "Gönderi";
  if (s.startsWith("hik") || s.startsWith("story")) return "Hikâye";
  if (s.startsWith("vid") || s.startsWith("youtube")) return "Video";
  return null;
};
const kategoriEsles = (aranan, kategoriler) => {
  const a = sade(aranan);
  if (!a) return true;
  return kategoriler.some((k) => sade(k).includes(a) || a.includes(sade(k).split(" ")[0]));
};
const yuzdelik = (dizi, p) => {
  if (!dizi.length) return null;
  const s = [...dizi].sort((x, y) => x - y);
  const i = (s.length - 1) * p, a = Math.floor(i), b = Math.ceil(i);
  return Math.round(s[a] + (s[b] - s[a]) * (i - a));
};
const kademe = (takipci) => takipci < 10_000 ? 0 : takipci < 50_000 ? 1 : takipci < 100_000 ? 2 : 3;
const KADEME_ADI = ["10 binin altı (nano/mikro)", "10–50 bin (mikro)", "50–100 bin (orta)", "100 bin ve üzeri"];
const rehberAlani = { Reels: "reels", "Gönderi": "gonderi", "Hikâye": "hikaye" };
const kisa = (inf) => ({
  id: inf.id, ad: inf.ad, kullanici: inf.kullanici, kategoriler: inf.kategoriler, sehir: inf.sehir || null,
  takipci: inf.takipci, platform: inf.platform, dogrulanmis: inf.dogrulanmis, fiyatlar: gf(inf),
  ...(supheli(inf).length ? { gecersiz_fiyat: supheli(inf) } : {}),
  profil_url: `${SITE}/influencer/${inf.id}`,
});

/** Filtrele + puanla. Puan: kategori odağı, şehir, doğrulama, fiyat bilgisi, bütçeye uygunluk, anahtar kelime. */
export function influencerAra(veri, g = {}) {
  const tur = icerikTuru(g.icerik_turu);
  const limit = Math.min(Math.max(Number(g.limit) || 8, 1), 20);
  const maxFiyat = Number(g.max_fiyat) || null;
  const kelimeler = sade(g.anahtar_kelime).split(" ").filter((k) => k.length > 2);
  const adaylar = veri.influencerlar.filter((inf) => {
    if (g.kategori && !kategoriEsles(g.kategori, inf.kategoriler)) return false;
    if (g.sehir && sade(inf.sehir) !== sade(g.sehir)) return false;
    if (g.min_takipci && inf.takipci < Number(g.min_takipci)) return false;
    if (g.max_takipci && inf.takipci > Number(g.max_takipci)) return false;
    if (g.platform && !inf.platform.some((p) => sade(p) === sade(g.platform))) return false;
    if (g.sadece_dogrulanmis && !inf.dogrulanmis) return false;
    if (maxFiyat && tur && !(gf(inf)[tur] <= maxFiyat)) return false;
    return true;
  });
  const sonuclar = adaylar.map((inf) => {
    let puan = 0; const neden = [];
    if (g.kategori) {
      const odak = 1 / Math.max(inf.kategoriler.length, 1);
      puan += 20 + 20 * odak;
      if (inf.kategoriler.length <= 2) neden.push("kategoriye odaklı");
    }
    if (g.sehir) { puan += 15; neden.push(`${inf.sehir}'da`); }
    if (inf.dogrulanmis) { puan += 15; neden.push("doğrulanmış hesap"); }
    if (Object.keys(gf(inf)).length) puan += 10; else neden.push("geçerli fiyat girmemiş");
    if (tur && gf(inf)[tur]) {
      const tlBin = gf(inf)[tur] / Math.max(inf.takipci / 1000, 1);
      puan += Math.max(0, 15 - tlBin); // 1000 takipçi başına ucuz olana artı
    }
    if (kelimeler.length) {
      const h = sade(inf.hakkinda + " " + inf.ad + " " + inf.kullanici);
      const isabet = kelimeler.filter((k) => h.includes(k)).length;
      if (isabet) { puan += 10 * isabet; neden.push("profil açıklaması eşleşiyor"); }
    }
    puan += Math.min(10, Math.log10(Math.max(inf.takipci, 1)) * 2);
    return { ...kisa(inf), uygunluk_puani: Math.round(puan), neden };
  });
  const sirala = g.sirala === "takipci" ? (a, b) => b.takipci - a.takipci
    : g.sirala === "fiyat" && tur ? (a, b) => (a.fiyatlar[tur] ?? 1e12) - (b.fiyatlar[tur] ?? 1e12)
    : (a, b) => b.uygunluk_puani - a.uygunluk_puani || b.takipci - a.takipci;
  sonuclar.sort(sirala);
  return { toplam_eslesen: sonuclar.length, gosterilen: Math.min(limit, sonuclar.length), sonuclar: sonuclar.slice(0, limit),
    not: "Takipçi sayıları influencer beyanıdır; 'doğrulanmış' olanlar platformca kontrol edilmiştir. Fiyatlar liste fiyatıdır, pazarlığa açıktır." };
}

/** Bir takipçi/kategori/içerik türü için fiyat bandı: site rehberi + benzer profillerin dağılımı. */
export function fiyatAnalizi(veri, g = {}) {
  const takipci = Number(g.takipci) || 0;
  const turler = icerikTuru(g.icerik_turu) ? [icerikTuru(g.icerik_turu)] : ICERIK_TURLERI;
  const k = kademe(takipci);
  const kademeSatir = veri.fiyatRehberi.takipciyeGore[k] ?? null;
  const katSatir = g.kategori ? veri.fiyatRehberi.kategoriyeGore.find((r) => kategoriEsles(g.kategori, [r.ad])) ?? null : null;
  const benzer = veri.influencerlar.filter((i) => kademe(i.takipci) === k && (!g.kategori || kategoriEsles(g.kategori, i.kategoriler)));
  const sonuc = {};
  for (const t of turler) {
    const fiyatlar = benzer.map((i) => gf(i)[t]).filter(Boolean);
    const p25 = yuzdelik(fiyatlar, 0.25), p50 = yuzdelik(fiyatlar, 0.5), p75 = yuzdelik(fiyatlar, 0.75);
    const rehber = [kademeSatir?.[rehberAlani[t]], katSatir?.[rehberAlani[t]]].filter(Boolean);
    const rehberOrt = rehber.length ? Math.round(rehber.reduce((a, b) => a + b, 0) / rehber.length) : null;
    const merkez = p50 && rehberOrt ? Math.round((p50 + rehberOrt) / 2) : p50 ?? rehberOrt;
    const yuvarla = (x) => (x == null ? null : Math.round(x / 250) * 250);
    sonuc[t] = {
      onerilen_alt: merkez == null ? null : yuvarla(Math.min(p25 ?? merkez * 0.75, merkez * 0.85)),
      onerilen: yuvarla(merkez),
      onerilen_ust: merkez == null ? null : yuvarla(Math.max(p75 ?? merkez * 1.3, merkez * 1.2)),
      benzer_profil_sayisi: fiyatlar.length,
      benzer_ortanca: p50, rehber_kademe_ortancasi: kademeSatir?.[rehberAlani[t]] ?? null,
      rehber_kategori_ortancasi: katSatir?.[rehberAlani[t]] ?? null,
      bin_takipci_basina_tl: merkez && takipci ? Math.round((merkez / (takipci / 1000)) * 10) / 10 : null,
    };
  }
  return { takipci_kademesi: KADEME_ADI[k], kategori: katSatir?.ad ?? g.kategori ?? null, icerik: sonuc,
    rehber_tarihi: veri.fiyatRehberi.tarih,
    not: "Rehber, influencer'ların kendi girdiği fiyatların ortancasıdır; gerçekleşen işlem fiyatı değildir. Video için site rehberinde satır yok, yalnız benzer profiller kullanıldı." };
}

/** Bütçeye göre influencer karması (açgözlü: TL başına erişimi en yüksek olandan başlar, çeşitliliği korur). */
export function butcePlani(veri, g = {}) {
  const butce = Number(g.butce_tl) || 0;
  const tur = icerikTuru(g.icerik_turu) ?? "Reels";
  if (butce <= 0) throw new Error("butce_tl pozitif bir sayı olmalı");
  const fiyat = (i) => gf(i)[tur];
  const adaylar = veri.influencerlar.filter((i) => fiyat(i) > 0 && i.takipci > 0
    && (!g.kategori || kategoriEsles(g.kategori, i.kategoriler))
    && (!g.sehir || sade(i.sehir) === sade(g.sehir))
    && (!g.sadece_dogrulanmis || i.dogrulanmis)
    && (!g.min_takipci || i.takipci >= Number(g.min_takipci)));
  const maxKisi = Math.min(Number(g.max_kisi) || 10, 25);
  const hedef = g.hedef === "cesitlilik" ? "cesitlilik" : "erisim";
  const deger = (i) => hedef === "erisim" ? i.takipci / fiyat(i) : (1 / fiyat(i)) * (i.dogrulanmis ? 1.5 : 1);
  const sirali = [...adaylar].sort((a, b) => deger(b) - deger(a));
  const secilen = []; let kalan = butce;
  for (const i of sirali) {
    if (secilen.length >= maxKisi) break;
    if (fiyat(i) <= kalan) { secilen.push(i); kalan -= fiyat(i); }
  }
  const toplamTakipci = secilen.reduce((a, i) => a + i.takipci, 0);
  return {
    icerik_turu: tur, butce_tl: butce, harcanan_tl: butce - kalan, kalan_tl: kalan, aday_sayisi: adaylar.length,
    toplam_takipci: toplamTakipci,
    bin_takipci_basina_tl: toplamTakipci ? Math.round(((butce - kalan) / (toplamTakipci / 1000)) * 10) / 10 : null,
    secilenler: secilen.map((i) => ({ ...kisa(i), fiyat: fiyat(i) })),
    not: "Toplam takipçi = toplam erişim değildir (kitle örtüşmesi, etkileşim oranı). Liste fiyatlarıyla hesaplandı; paket/pazarlıkla düşebilir.",
  };
}

/** Bir influencer profilini değerlendirir: eksikler, fiyat konumu, rekabet. */
export function profilAnalizi(veri, g = {}) {
  const ara = sade(g.kullanici ?? g.id ?? g.ad).replace(/^@/, "");
  if (!ara) throw new Error("kullanici, id veya ad verin");
  const inf = veri.influencerlar.find((i) => i.id === g.id || sade(i.kullanici) === ara)
    ?? veri.influencerlar.find((i) => sade(i.ad) === ara || sade(i.kullanici).includes(ara) || sade(i.ad).includes(ara));
  if (!inf) throw new Error(`'${g.kullanici ?? g.id ?? g.ad}' bulunamadı. Profil sitede dolu değilse listede yer almaz.`);
  const eksikler = [];
  const sup = supheli(inf);
  if (sup.length) eksikler.push(`${sup.join(", ")} fiyatı ${MIN_GECERLI_FIYAT} ₺'nin altında (${sup.map((k) => inf.fiyatlar[k] + " ₺").join(", ")}): büyük olasılıkla hatalı girildi; markalar ciddiye almaz, düzeltin.`);
  if (!Object.keys(inf.fiyatlar).length) eksikler.push("Fiyat girilmemiş: markalar bütçe filtresinde bu profili göremez.");
  else for (const t of ICERIK_TURLERI) if (!inf.fiyatlar[t]) eksikler.push(`${t} fiyatı yok.`);
  if (!inf.sehir) eksikler.push("Şehir yok: yerel kampanya aramalarında çıkmaz.");
  if ((inf.hakkinda ?? "").length < 60) eksikler.push("'Hakkında' çok kısa: kitle, içerik tarzı ve önceki iş birliklerini yazın.");
  if (!inf.dogrulanmis) eksikler.push("Hesap doğrulanmamış: doğrulama, aramada öne çıkarır ve güven verir.");
  if (inf.kategoriler.length > 4) eksikler.push(`${inf.kategoriler.length} kategori seçilmiş: 2-3 ana kategoriye inmek uzmanlık algısını artırır.`);
  if (inf.platform.length < 2) eksikler.push("Tek platform: TikTok/YouTube varsa ekleyin (paket teklif fırsatı).");
  const fa = fiyatAnalizi(veri, { takipci: inf.takipci, kategori: inf.kategoriler[0] });
  const konum = {};
  for (const [t, f] of Object.entries(gf(inf))) {
    const b = fa.icerik[t];
    if (!b?.onerilen) continue;
    konum[t] = { fiyatin: f, piyasa_bandi: [b.onerilen_alt, b.onerilen_ust],
      durum: f < b.onerilen_alt ? "piyasanın altında" : f > b.onerilen_ust ? "piyasanın üstünde" : "piyasa bandında" };
  }
  const rakip = veri.influencerlar.filter((i) => i.id !== inf.id && kademe(i.takipci) === kademe(inf.takipci)
    && i.kategoriler.some((k) => inf.kategoriler.includes(k))).length;
  return { profil: { ...kisa(inf), hakkinda: inf.hakkinda }, eksikler, fiyat_konumu: konum, takipci_kademesi: fa.takipci_kademesi,
    ayni_kademe_ve_kategoride_rakip: rakip };
}

export function kampanyaListesi(veri, g = {}) {
  const k = veri.kampanyalar.filter((c) => !g.kategori || sade(c.aciklama + c.baslik).includes(sade(g.kategori)));
  return { aktif_kampanya: k.length, kampanyalar: k.map((c) => ({ ...c, url: `${SITE}/kampanya/${c.id}` })) };
}

// ---- Araç tanımları (Claude tool şeması) ----
const S = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const num = (description) => ({ type: "number", description });
const TUR = str("İçerik türü", { enum: ICERIK_TURLERI });

export const ARACLAR = [
  { name: "influencer_ara", roller: ["marka"], calistir: influencerAra,
    description: "isbirligim.com.tr'deki profili dolu influencer'ları filtreler ve uygunluğa göre sıralar. Ad, kullanıcı adı, kategori, şehir, takipçi, doğrulama, fiyatlar ve profil linkini döndürür. Influencer önerirken HER ZAMAN bunu kullan; isim uydurma.",
    input_schema: S({ kategori: str("Örn. 'Yemek & Mutfak', 'Anne & Çocuk', 'Fitness'"), sehir: str("Örn. 'İstanbul'"),
      min_takipci: num("En az takipçi"), max_takipci: num("En çok takipçi"), icerik_turu: TUR, max_fiyat: num("Seçilen içerik türü için en yüksek fiyat (TL)"),
      platform: str("instagram, tiktok, youtube"), sadece_dogrulanmis: { type: "boolean" }, anahtar_kelime: str("Profil açıklamasında aranacak kelimeler"),
      sirala: str("Sıralama", { enum: ["uygunluk", "takipci", "fiyat"] }), limit: num("1-20, varsayılan 8") }) },
  { name: "butce_plani", roller: ["marka"], calistir: butcePlani,
    description: "Verilen bütçeyle hangi influencer'larla çalışılabileceğini hesaplar (liste fiyatlarıyla). Seçilenleri, harcanan/kalan tutarı ve toplam takipçiyi döndürür.",
    input_schema: S({ butce_tl: num("Toplam bütçe (TL)"), icerik_turu: TUR, kategori: str("Kategori"), sehir: str("Şehir"),
      hedef: str("erisim: TL başına en çok takipçi; cesitlilik: daha çok sayıda küçük hesap", { enum: ["erisim", "cesitlilik"] }),
      sadece_dogrulanmis: { type: "boolean" }, min_takipci: num("En az takipçi"), max_kisi: num("En çok kaç influencer (varsayılan 10)") }, ["butce_tl"]) },
  { name: "fiyat_analizi", roller: ["marka", "influencer"], calistir: fiyatAnalizi,
    description: "Takipçi sayısı ve kategoriye göre içerik türü başına önerilen fiyat bandını (alt/önerilen/üst TL) site fiyat rehberi ve benzer profillerden hesaplar.",
    input_schema: S({ takipci: num("Takipçi sayısı"), kategori: str("Kategori"), icerik_turu: TUR }, ["takipci"]) },
  { name: "profil_analizi", roller: ["influencer", "marka"], calistir: profilAnalizi,
    description: "Sitedeki bir influencer profilini kullanıcı adı/ad ile bulur; eksiklerini, fiyatlarının piyasaya göre konumunu ve rakip sayısını döndürür.",
    input_schema: S({ kullanici: str("Instagram kullanıcı adı (@ olmadan) veya profil adı"), id: str("Profil id (varsa)") }) },
  { name: "kampanya_listesi", roller: ["influencer", "marka"], calistir: kampanyaListesi,
    description: "Sitedeki aktif kampanyaları (başlık, marka, açıklama, link) listeler.",
    input_schema: S({ kategori: str("İsteğe bağlı kategori filtresi") }) },
  { name: "uyum_kontrol", roller: ["marka", "influencer"], calistir: (_veri, g) => uyumKontrol(g),
    description: "Bir paylaşım metnini/brief'i Türkiye influencer reklam kurallarına (Reklam/Tanıtım ibaresi, sağlık beyanı, üstünlük iddiası, çocuk, yapay zekâ, indirim) göre denetler. Yazdığın HER caption/örnek paylaşım metnini son haline getirmeden önce bununla kontrol et.",
    input_schema: S({ metin: str("Kontrol edilecek metin"), kategori: str("Kategori"), reklam_veren: str("Marka adı") }, ["metin"]) },
];

export const rolAraclari = (rol) => ARACLAR.filter((a) => a.roller.includes(rol));

/** Aracı çalıştırır; hata olursa {hata} döndürür (modele geri iletilir). */
export function aracCalistir(veri, ad, girdi) {
  const a = ARACLAR.find((x) => x.name === ad);
  if (!a) return { hata: `Bilinmeyen araç: ${ad}` };
  try { return a.calistir(veri, girdi && typeof girdi === "object" ? girdi : {}); }
  catch (e) { return { hata: String(e?.message ?? e) }; }
}
