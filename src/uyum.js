// Influencer reklam metni uyum kontrolü (deterministik, LLM'siz).
// Dayanak: Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği md. 23/A
// (RG 01.07.2026 / 33297, yürürlük 01.08.2026) ve Ticaret Bakanlığı
// "Sosyal Medya Etkileyicileri Tarafından Yapılan Ticari Reklam" kılavuzu.
// Bu kontrol bir ön elemedir; hukuki görüş yerine geçmez.

const kucuk = (s) => String(s ?? "").toLocaleLowerCase("tr-TR");
const katla = (s) => s.replace(/[çğıöşüâî]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i" })[c]);

const SAGLIK_KALIPLARI = [
  /tedavi (eder|ediyor|etti)/, /iyileştir/, /şifa/, /zayıflat/, /kilo verdir/, /kilo kaybettir/,
  /yağ yak/, /selülit(i)? (yok|bitir)/, /hastalığ?[ıa] (karşı|iyi)/, /kanser/, /diyabet/, /tansiyon/,
  /bağışıklığ?[ıi] (güçlendir|artır)/, /detoks/, /ilaç gibi/, /ağrıyı? (geçir|keser|bitir)/,
  /mucize/, /\bkesin sonuç/, /garantili sonuç/, /yan etkisi? (yok|olmayan)/,
];
const USTUNLUK_KALIPLARI = [/\ben iyi(si)?\b/, /\ben ucuz(u)?\b/, /1 numara/, /bir numara/, /rakipsiz/, /piyasadaki tek/, /\ben kaliteli/];
const COCUK_CAGRI = [/annene (söyle|aldır)/, /babana (söyle|aldır)/, /ailene aldır/, /hemen (al|satın al)/, /kaçırma/];
const YZ_ANMA = /(yapay zek[aâ]|\bai\b|\byz\b)/;
const YZ_BEYAN = /(yapay zek[aâ] (ile|kullanılarak) (üretil|oluşturul|düzenlen)|#yapayzeka|#yz\b|#aigenerated)/;
const ZAYIF_ETIKET = /(#?i[sş] ?birli[gğ]i|#?sponsorlu|#ad\b|#?gifted|#?hediye)/;
const GUCLU_ETIKET = /(#reklam\b|#tan[ıi]t[ıi]m\b|\breklam\b|\btan[ıi]t[ıi]m\b)/;
const INDIRIM = /(%\s?\d+|\d+\s?%)\s*(indirim|i̇ndirim)|indirim kodu/;

/**
 * @param {{metin:string, kategori?:string, reklam_veren?:string}} girdi
 * @returns {{sonuc:"uygun"|"duzeltilmeli"|"riskli", puan:number, bulgular:Array<{seviye:"hata"|"uyari"|"bilgi", kural:string, aciklama:string, oneri:string}>, not:string}}
 */
export function uyumKontrol(girdi) {
  const metin = String(girdi?.metin ?? "");
  const m = kucuk(metin);
  const kategori = kucuk(girdi?.kategori);
  const bulgular = [];
  const ekle = (seviye, kural, aciklama, oneri) => bulgular.push({ seviye, kural, aciklama, oneri });

  if (!metin.trim()) {
    return { sonuc: "duzeltilmeli", puan: 0, bulgular: [{ seviye: "hata", kural: "bos_metin", aciklama: "Kontrol edilecek metin boş.", oneri: "Paylaşım metnini (caption) girin." }], not: NOT };
  }

  // 1) Reklam ibaresi
  const guclu = m.match(GUCLU_ETIKET);
  if (!guclu) {
    if (ZAYIF_ETIKET.test(m)) {
      ekle("uyari", "reklam_ibaresi", "Yalnızca \"iş birliği/sponsorlu\" gibi bir ibare var. 1 Ağustos 2026 düzenlemesiyle \"Reklam\" veya \"Tanıtım\" ibaresi açıkça aranıyor.",
        "Metnin başına \"Reklam\" veya \"#reklam\" ekleyin.");
    } else {
      ekle("hata", "reklam_ibaresi", "Ücretli/karşılıklı paylaşımda reklam olduğunu belirten ibare yok.",
        "Metnin ilk satırına \"Reklam | @marka\" veya \"#reklam\" ekleyin.");
    }
  } else if (guclu.index > 125) {
    ekle("uyari", "reklam_ibaresi_konumu", "Reklam ibaresi metnin sonlarında; \"devamını gör\" altında kalabilir.",
      "İbareyi ilk satıra, kesilmeden görünecek yere taşıyın.");
  }

  // 2) Reklam verenin adı
  const rv = kucuk(girdi?.reklam_veren).trim();
  if (rv) {
    const sade = katla(rv).replace(/[^a-z0-9]/g, "");
    if (!katla(m).replace(/[^a-z0-9]/g, "").includes(sade)) {
      ekle("uyari", "reklam_veren", `Reklam verenin adı (${girdi.reklam_veren}) metinde geçmiyor.`,
        `\"Reklam | @${sade}\" biçiminde reklam vereni etiketleyin.`);
    }
  }

  // 3) Sağlık beyanı
  const saglik = SAGLIK_KALIPLARI.filter((r) => r.test(m)).map((r) => m.match(r)[0]);
  if (saglik.length) {
    const fitness = /fitness|sağlık|güzellik|anne/.test(kategori);
    ekle(fitness ? "hata" : "uyari", "saglik_beyani",
      `Sağlık beyanı sayılabilecek ifade(ler): ${[...new Set(saglik)].join(", ")}. Influencer'ların mevzuata aykırı sağlık beyanı yapması yasak.`,
      "Tedavi/iyileştirme/zayıflatma vaadi yerine kişisel deneyim ve ürünün onaylı özelliklerini anlatın (\"bana iyi geldi\" değil, \"rutinimde kullanıyorum\").");
  }

  // 4) Üstünlük / karşılaştırma iddiası
  const ust = USTUNLUK_KALIPLARI.filter((r) => r.test(m)).map((r) => m.match(r)[0]);
  if (ust.length) {
    ekle("uyari", "ustunluk_iddiasi", `Kanıtlanması gereken üstünlük iddiası: ${[...new Set(ust)].join(", ")}.`,
      "Belgelenemiyorsa \"en çok sevdiğim\", \"benim favorim\" gibi öznel ifade kullanın.");
  }

  // 5) Yapay zekâ
  if (YZ_ANMA.test(m) && !YZ_BEYAN.test(m)) {
    ekle("bilgi", "yapay_zeka", "Metin yapay zekâdan söz ediyor. Görsel/ses/metin yapay zekâyla üretildiyse bu açıkça belirtilmeli.",
      "Gerekiyorsa \"Bu görsel yapay zekâ ile oluşturulmuştur.\" ekleyin.");
  }

  // 6) Çocuklar
  const cocukBaglam = /anne|çocuk/.test(kategori) || /çocuk|bebek|minik|okul/.test(m);
  if (cocukBaglam) {
    const cagri = COCUK_CAGRI.filter((r) => r.test(m)).map((r) => m.match(r)[0]);
    if (cagri.length) {
      ekle("hata", "cocuk_dogrudan_cagri", `Çocuklara doğrudan satın alma çağrısı gibi okunabilecek ifade: ${[...new Set(cagri)].join(", ")}.`,
        "Çağrıyı ebeveyne yönelik ve bilgilendirici yapın; çocukları ebeveynlerini ikna etmeye yönlendirmeyin.");
    } else {
      ekle("bilgi", "cocuk_hassasiyet", "Çocukların yer aldığı/hedeflendiği içerik: kişisel veriyle çocuklara hedefli reklam yasak ve çocukların deneyimsizliği istismar edilmemeli.",
        "Çocuğun yüzünü/bilgisini paylaşmadan önce veli rızasını ve KVKK'yı gözetin.");
    }
  }

  // 7) İndirim
  if (INDIRIM.test(m) && !/(geçerli|son gün|tarih|kadar)/.test(m)) {
    ekle("bilgi", "indirim_kosullari", "İndirim/kod var ama süre veya koşul belirtilmemiş.",
      "\"…tarihine kadar geçerli\" gibi süre ve koşulu ekleyin.");
  }

  const hata = bulgular.filter((b) => b.seviye === "hata").length;
  const uyari = bulgular.filter((b) => b.seviye === "uyari").length;
  const puan = Math.max(0, 100 - hata * 35 - uyari * 12 - (bulgular.length - hata - uyari) * 3);
  const sonuc = hata ? "riskli" : uyari ? "duzeltilmeli" : "uygun";
  return { sonuc, puan, bulgular, not: NOT };
}

const NOT = "Otomatik ön kontroldür, hukuki görüş değildir. Güncel metin: Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği md. 23/A (RG 33297).";
