import { test } from "node:test";
import assert from "node:assert/strict";
import { uyumKontrol } from "../src/uyum.js";

const kurallar = (r) => r.bulgular.map((b) => b.kural);

test("uygun metin: başta Reklam ibaresi + marka", () => {
  const r = uyumKontrol({ metin: "Reklam | @ertokusefendi Kahvenin yanına lokum yakışır, misafirlerime ikram ettim ☕", reklam_veren: "Ertokuş Efendi" });
  assert.equal(r.sonuc, "uygun");
  assert.equal(r.puan, 100);
});

test("ibare yok -> riskli", () => {
  const r = uyumKontrol({ metin: "Bu kremi çok sevdim, siz de deneyin!" });
  assert.equal(r.sonuc, "riskli");
  assert.ok(kurallar(r).includes("reklam_ibaresi"));
});

test("yalnızca #işbirliği -> uyarı (Reklam/Tanıtım aranır)", () => {
  const r = uyumKontrol({ metin: "Yeni sezon çantalar geldi #işbirliği" });
  const b = r.bulgular.find((x) => x.kural === "reklam_ibaresi");
  assert.equal(b.seviye, "uyari");
});

test("sağlık beyanı fitness kategorisinde hata, üstünlük iddiası uyarı", () => {
  const r = uyumKontrol({ metin: "#reklam Bu çay 1 haftada zayıflatıyor, piyasadaki en iyi çay!", kategori: "Fitness & Sağlık" });
  assert.equal(r.sonuc, "riskli");
  assert.equal(r.bulgular.find((x) => x.kural === "saglik_beyani").seviye, "hata");
  assert.ok(kurallar(r).includes("ustunluk_iddiasi"));
});

test("ibare sonda kalırsa konum uyarısı", () => {
  const r = uyumKontrol({ metin: "a".repeat(200) + " #reklam" });
  assert.ok(kurallar(r).includes("reklam_ibaresi_konumu"));
});

test("çocuğa doğrudan çağrı -> hata", () => {
  const r = uyumKontrol({ metin: "Tanıtım: Bu oyuncağı annene söyle hemen al!", kategori: "Anne & Çocuk" });
  assert.equal(r.bulgular.find((x) => x.kural === "cocuk_dogrudan_cagri").seviye, "hata");
});

test("reklam veren adı eksik, yapay zekâ ve indirim bilgisi", () => {
  const r = uyumKontrol({ metin: "#reklam Yapay zeka ile çektiğim bu kare çok tuttu, %20 indirim kodu: ABC", reklam_veren: "Marka X" });
  assert.deepEqual(new Set(kurallar(r)), new Set(["reklam_veren", "yapay_zeka", "indirim_kosullari"]));
});

test("boş metin", () => {
  assert.equal(uyumKontrol({ metin: "  " }).sonuc, "duzeltilmeli");
});
