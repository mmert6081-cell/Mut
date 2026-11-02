import { test } from "node:test";
import assert from "node:assert/strict";
import { influencerAra, fiyatAnalizi, butcePlani, profilAnalizi, kampanyaListesi, aracCalistir, rolAraclari, ARACLAR } from "../src/araclar.js";

const inf = (o) => ({ id: o.id, ad: o.ad ?? o.id, kullanici: o.id, kategoriler: o.k ?? ["Yemek & Mutfak"], sehir: o.s ?? "İzmir",
  takipci: o.t ?? 20000, platform: o.p ?? ["instagram"], dogrulanmis: o.d ?? false, hakkinda: o.h ?? "", fiyatlar: o.f ?? { Reels: 2000, "Gönderi": 1000, "Hikâye": 500 } });
const veri = {
  influencerlar: [
    inf({ id: "a", t: 50000, d: true, h: "Ege mutfağı tarifleri, kahve ve tatlı", f: { Reels: 3000, "Gönderi": 1500, "Hikâye": 750 } }),
    inf({ id: "b", t: 15000, k: ["Yemek & Mutfak", "Seyahat", "Moda & Güzellik", "Eğitim", "Teknoloji"], f: { Reels: 1500 } }),
    inf({ id: "c", s: "İstanbul", t: 8000, k: ["Anne & Çocuk"], f: { Reels: 800, "Hikâye": 300 } }),
    inf({ id: "d", s: "", t: 120000, k: ["Moda & Güzellik"], f: {} }),
    inf({ id: "e", s: "İzmir", t: 30000, k: ["Anne & Çocuk"], d: true, f: { Reels: 2500, "Hikâye": 1000 } }),
  ],
  fiyatRehberi: { tarih: "2026-11-02",
    takipciyeGore: [{ ad: "<10", reels: 1000, gonderi: 1000, hikaye: 500 }, { ad: "10-50", reels: 2500, gonderi: 2000, hikaye: 1000 },
      { ad: "50-100", reels: 5000, gonderi: 2000, hikaye: 2000 }, { ad: "100+", reels: 5000, gonderi: 5000, hikaye: 2000 }],
    kategoriyeGore: [{ ad: "Yemek & Mutfak", reels: 2000, gonderi: 1000, hikaye: 700 }, { ad: "Anne & Çocuk", reels: 2000, gonderi: 1000, hikaye: 500 }] },
  kampanyalar: [{ id: "k1", baslik: "Lokum kampanyası", marka: "X", aciklama: "Yemek ve kahve" }],
};

test("influencer_ara: kategori + şehir filtresi, aksan/büyük harf duyarsız", () => {
  const r = influencerAra(veri, { kategori: "anne cocuk", sehir: "izmir" });
  assert.deepEqual(r.sonuclar.map((x) => x.id), ["e"]);
  assert.match(r.sonuclar[0].profil_url, /isbirligim\.com\.tr\/influencer\/e$/);
});

test("influencer_ara: odaklı + doğrulanmış + anahtar kelime öne çıkar", () => {
  const r = influencerAra(veri, { kategori: "Yemek", anahtar_kelime: "kahve" });
  assert.equal(r.sonuclar[0].id, "a");
  assert.ok(r.sonuclar[0].neden.includes("doğrulanmış hesap"));
});

test("influencer_ara: max_fiyat içerik türüne göre süzer, fiyatsızları dışlar", () => {
  const r = influencerAra(veri, { icerik_turu: "reels", max_fiyat: 1500 });
  assert.deepEqual(r.sonuclar.map((x) => x.id).sort(), ["b", "c"]);
});

test("fiyat_analizi: kademe ve bant üretir, bant sıralı", () => {
  const r = fiyatAnalizi(veri, { takipci: 20000, kategori: "Yemek & Mutfak", icerik_turu: "Reels" });
  assert.equal(r.takipci_kademesi, "10–50 bin (mikro)");
  const b = r.icerik.Reels;
  assert.ok(b.onerilen_alt <= b.onerilen && b.onerilen <= b.onerilen_ust, JSON.stringify(b));
  assert.equal(b.rehber_kademe_ortancasi, 2500);
  assert.equal(b.rehber_kategori_ortancasi, 2000);
});

test("butce_plani: bütçeyi aşmaz, kalan doğru", () => {
  const r = butcePlani(veri, { butce_tl: 4000, icerik_turu: "Reels" });
  assert.ok(r.harcanan_tl <= 4000);
  assert.equal(r.harcanan_tl + r.kalan_tl, 4000);
  assert.equal(r.harcanan_tl, r.secilenler.reduce((a, s) => a + s.fiyat, 0));
  assert.equal(r.secilenler[0].id, "a"); // TL başına en çok takipçi
});

test("butce_plani: geçersiz bütçe hata verir, aracCalistir hatayı yakalar", () => {
  assert.throws(() => butcePlani(veri, {}));
  assert.match(aracCalistir(veri, "butce_plani", {}).hata, /butce_tl/);
  assert.match(aracCalistir(veri, "yok_boyle", {}).hata, /Bilinmeyen/);
});

test("profil_analizi: eksikleri ve fiyat konumunu bulur", () => {
  const r = profilAnalizi(veri, { kullanici: "@b" });
  assert.ok(r.eksikler.some((e) => e.includes("5 kategori")));
  assert.ok(r.eksikler.some((e) => e.includes("doğrulanmamış")));
  assert.ok(r.fiyat_konumu.Reels);
  const d = profilAnalizi(veri, { kullanici: "d" });
  assert.ok(d.eksikler.some((e) => e.startsWith("Fiyat girilmemiş")));
  assert.throws(() => profilAnalizi(veri, { kullanici: "olmayan" }), /bulunamadı/);
});

test("kampanya_listesi ve rol araçları", () => {
  assert.equal(kampanyaListesi(veri, {}).aktif_kampanya, 1);
  assert.deepEqual(rolAraclari("marka").map((a) => a.name).sort(), ["butce_plani", "fiyat_analizi", "influencer_ara", "kampanya_listesi", "profil_analizi", "uyum_kontrol"]);
  assert.ok(!rolAraclari("influencer").some((a) => a.name === "butce_plani"));
});

test("araç şemaları geçerli ve 4 KB sınırının altında", () => {
  for (const a of ARACLAR) {
    assert.match(a.name, /^[a-z_]+$/);
    assert.equal(a.input_schema.type, "object");
    assert.ok(JSON.stringify(a.input_schema).length < 4096, a.name);
    assert.ok(a.description.length < 1024, a.name);
    for (const r of a.input_schema.required) assert.ok(r in a.input_schema.properties);
  }
});

test("100 ₺ altı fiyatlar geçersiz: bütçe planına girmez, profil analizinde uyarılır", () => {
  const v = { ...veri, influencerlar: [...veri.influencerlar, inf({ id: "z", t: 90000, f: { Reels: 1, "Gönderi": 3, "Hikâye": 2000 } })] };
  const r = butcePlani(v, { butce_tl: 4000, icerik_turu: "Reels" });
  assert.ok(!r.secilenler.some((s) => s.id === "z"));
  const ara = influencerAra(v, { kategori: "Yemek" }).sonuclar.find((x) => x.id === "z");
  assert.deepEqual(ara.fiyatlar, { "Hikâye": 2000 });
  assert.deepEqual(ara.gecersiz_fiyat, ["Reels", "Gönderi"]);
  assert.ok(profilAnalizi(v, { kullanici: "z" }).eksikler[0].includes("100 ₺'nin altında"));
});
