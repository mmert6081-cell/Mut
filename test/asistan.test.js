import { test } from "node:test";
import assert from "node:assert/strict";
import { asistanCalistir } from "../src/asistan.js";
import { sunucuOlustur, veriYukle } from "../src/sunucu.js";

// Sıralı yanıtlar döndüren sahte Anthropic istemcisi; gelen istekleri kaydeder.
function sahteIstemci(yanitlar) {
  const istekler = [];
  return { istekler, beta: { messages: { create: async (istek) => {
    istekler.push(structuredClone(istek));
    const y = yanitlar.shift();
    if (!y) throw new Error("beklenmeyen çağrı");
    if (y instanceof Error) throw y;
    return { usage: { input_tokens: 10, output_tokens: 5 }, ...y };
  } } } };
}
const metin = (t) => ({ type: "text", text: t });
const arac = (id, name, input) => ({ type: "tool_use", id, name, input });

const veri = await veriYukle();

test("araç çağrısı -> sonuç -> son yanıt; paralel sonuçlar tek mesajda", async () => {
  const c = sahteIstemci([
    { stop_reason: "tool_use", content: [{ type: "thinking", thinking: "", signature: "imza" }, metin("Bakıyorum."),
      arac("t1", "influencer_ara", { kategori: "Yemek & Mutfak", limit: 3 }), arac("t2", "fiyat_analizi", { takipci: 20000 })] },
    { stop_reason: "end_turn", content: [metin("İşte öneriler.")] },
  ]);
  const olaylar = [];
  const r = await asistanCalistir({ client: c, veri, rol: "marka", mesaj: "yemek influencer öner", olay: (o) => olaylar.push(o.tur) });
  assert.equal(r.yanit, "İşte öneriler.");
  assert.deepEqual(r.araclar.map((a) => a.ad), ["influencer_ara", "fiyat_analizi"]);
  assert.deepEqual(olaylar, ["arac_basladi", "arac_bitti", "arac_basladi", "arac_bitti"]);
  const ikinci = c.istekler[1];
  // Asistan içeriği (düşünme bloğu dahil) değiştirilmeden geri gönderilir
  assert.equal(ikinci.messages[1].content[0].type, "thinking");
  assert.equal(ikinci.messages[1].content[0].signature, "imza");
  const sonuclar = ikinci.messages[2].content;
  assert.equal(sonuclar.length, 2);
  assert.deepEqual(sonuclar.map((s) => s.tool_use_id), ["t1", "t2"]);
  const bulunan = JSON.parse(sonuclar[0].content);
  assert.equal(bulunan.sonuclar.length, 3);
  assert.ok(bulunan.sonuclar.every((s) => s.kategoriler.includes("Yemek & Mutfak")));
  // İstek yapısı
  assert.equal(ikinci.model, "claude-opus-5-5");
  assert.equal(ikinci.system[0].cache_control.type, "ephemeral");
  assert.deepEqual(ikinci.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(ikinci.fallbacks, "default");
  assert.ok(!ikinci.tools.some((t) => "calistir" in t || "roller" in t));
  assert.equal(r.kullanim.input_tokens, 20);
});

test("araç hatası is_error ile modele iletilir, döngü sürer", async () => {
  const c = sahteIstemci([
    { stop_reason: "tool_use", content: [arac("x", "profil_analizi", { kullanici: "kesinlikle-olmayan-hesap" })] },
    { stop_reason: "end_turn", content: [metin("Profil bulunamadı.")] },
  ]);
  const r = await asistanCalistir({ client: c, veri, rol: "influencer", mesaj: "profilim?" });
  const tr = c.istekler[1].messages.at(-1).content[0];
  assert.equal(tr.is_error, true);
  assert.match(JSON.parse(tr.content).hata, /bulunamadı/);
  assert.equal(r.araclar[0].hata.length > 0, true);
});

test("rol araçları: influencer bütçe planı görmez; fallback kapatılabilir", async () => {
  const c = sahteIstemci([{ stop_reason: "end_turn", content: [metin("Merhaba")] }]);
  await asistanCalistir({ client: c, veri, rol: "influencer", mesaj: "selam", fallback: false, effort: "low" });
  const i = c.istekler[0];
  assert.ok(!i.tools.some((t) => t.name === "butce_plani"));
  assert.ok(!("betas" in i) && !("fallbacks" in i));
  assert.equal(i.output_config.effort, "low");
  assert.match(i.system[0].text, /INFLUENCER/);
});

test("pause_turn devam ettirilir; refusal ve maxTur güvenli biter", async () => {
  let c = sahteIstemci([{ stop_reason: "pause_turn", content: [metin("…")] }, { stop_reason: "end_turn", content: [metin("Tamam")] }]);
  assert.equal((await asistanCalistir({ client: c, veri, rol: "marka", mesaj: "a" })).yanit, "Tamam");
  c = sahteIstemci([{ stop_reason: "refusal", content: [] }]);
  assert.equal((await asistanCalistir({ client: c, veri, rol: "marka", mesaj: "a" })).durma, "refusal");
  c = sahteIstemci(Array.from({ length: 3 }, (_, i) => ({ stop_reason: "tool_use", content: [arac("t" + i, "kampanya_listesi", {})] })));
  const r = await asistanCalistir({ client: c, veri, rol: "marka", mesaj: "a", maxTur: 3 });
  assert.equal(r.durma, "max_tur");
});

test("geçmiş sonraki mesajda korunur", async () => {
  const c = sahteIstemci([{ stop_reason: "end_turn", content: [metin("1")] }, { stop_reason: "end_turn", content: [metin("2")] }]);
  const r1 = await asistanCalistir({ client: c, veri, rol: "marka", mesaj: "ilk" });
  await asistanCalistir({ client: c, veri, rol: "marka", mesaj: "ikinci", gecmis: r1.gecmis });
  assert.deepEqual(c.istekler[1].messages.map((m) => m.role), ["user", "assistant", "user"]);
});

// ---- HTTP ----
async function sunucuyla(client, fn) {
  const s = sunucuOlustur({ client, veri });
  await new Promise((ok) => s.listen(0, ok));
  const url = `http://127.0.0.1:${s.address().port}`;
  try { await fn(url); } finally { s.close(); }
}
const post = (u, g) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(g) });

test("HTTP: arayüz, sağlık, uyum, asistan oturumu", async () => {
  const c = sahteIstemci([{ stop_reason: "end_turn", content: [metin("Merhaba marka")] }, { stop_reason: "end_turn", content: [metin("Devam")] }]);
  await sunucuyla(c, async (u) => {
    const html = await (await fetch(u + "/")).text();
    assert.match(html, /<html/);
    const s = await (await fetch(u + "/api/saglik")).json();
    assert.equal(s.influencer, veri.influencerlar.length);
    const uy = await (await post(u + "/api/uyum", { metin: "Bu çay zayıflatır" })).json();
    assert.equal(uy.sonuc, "riskli");
    const r1 = await (await post(u + "/api/asistan", { rol: "marka", mesaj: "selam" })).json();
    assert.equal(r1.yanit, "Merhaba marka");
    const r2 = await (await post(u + "/api/asistan", { rol: "marka", mesaj: "devam", oturum: r1.oturum })).json();
    assert.equal(r2.oturum, r1.oturum);
    assert.equal(c.istekler[1].messages.length, 3);
    assert.equal((await post(u + "/api/asistan", { rol: "marka", mesaj: "" })).status, 400);
    assert.equal((await post(u + "/api/asistan", { rol: "marka", mesaj: "x".repeat(5000) })).status, 400);
    assert.equal((await fetch(u + "/yok")).status, 404);
  });
});

test("HTTP: API anahtarı yoksa 503, servis hatası 502", async () => {
  await sunucuyla(null, async (u) => {
    assert.equal((await post(u + "/api/asistan", { rol: "marka", mesaj: "a" })).status, 503);
  });
  const hata = Object.assign(new Error("overloaded"), { status: 529 });
  await sunucuyla(sahteIstemci([hata]), async (u) => {
    const r = await post(u + "/api/asistan", { rol: "marka", mesaj: "a" });
    assert.equal(r.status, 502);
    assert.doesNotMatch((await r.json()).hata, /overloaded/);
  });
});

test("HTTP: dakikalık istek sınırı", async () => {
  const c = sahteIstemci(Array.from({ length: 20 }, () => ({ stop_reason: "end_turn", content: [metin("ok")] })));
  await sunucuyla(c, async (u) => {
    const kodlar = [];
    for (let i = 0; i < 13; i++) kodlar.push((await post(u + "/api/asistan", { rol: "marka", mesaj: "a" })).status);
    assert.equal(kodlar.at(-1), 429);
    assert.equal(kodlar.filter((k) => k === 200).length, 12);
  });
});
