// Claude Messages API ile araç kullanan asistan döngüsü (manuel döngü,
// beta tool runner'a bağımlı değil). İstemci dışarıdan verilir: testte sahte
// istemci, üretimde `new Anthropic()`.
import { SISTEM } from "./promptlar.js";
import { rolAraclari, aracCalistir } from "./araclar.js";

export const VARSAYILAN_MODEL = "claude-opus-5-5";

/**
 * @param {object} p
 * @param {{beta:{messages:{create:Function}}}} p.client  Anthropic istemcisi
 * @param {object} p.veri        {influencerlar, fiyatRehberi, kampanyalar}
 * @param {"marka"|"influencer"} p.rol
 * @param {Array} p.gecmis       Önceki API mesajları (asistanın döndürdüğü `gecmis`)
 * @param {string} p.mesaj       Kullanıcının yeni mesajı
 * @param {string} [p.model]
 * @param {"low"|"medium"|"high"} [p.effort]
 * @param {boolean} [p.fallback] Sunucu taraflı reddetme yedeği (Claude API)
 * @param {number} [p.maxTur]    En fazla model çağrısı
 * @param {(olay:object)=>void} [p.olay] İlerleme bildirimi (araç başladı/bitti)
 */
export async function asistanCalistir({ client, veri, rol, gecmis = [], mesaj, model = VARSAYILAN_MODEL,
  effort = "medium", fallback = true, maxTur = 8, olay = () => {} }) {
  if (!SISTEM[rol]) throw new Error(`Geçersiz rol: ${rol}`);
  const araclar = rolAraclari(rol);
  const tools = araclar.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const mesajlar = [...gecmis, { role: "user", content: mesaj }];
  const calisanAraclar = [];
  const kullanim = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };

  for (let tur = 0; tur < maxTur; tur++) {
    const istek = {
      model, max_tokens: 16000,
      system: [{ type: "text", text: SISTEM[rol], cache_control: { type: "ephemeral" } }],
      tools, messages: mesajlar,
      output_config: { effort },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    };
    const yanit = await client.beta.messages.create(istek);
    for (const k of Object.keys(kullanim)) kullanim[k] += yanit.usage?.[k] ?? 0;
    // İçeriği olduğu gibi geri ekle (düşünme blokları dahil; değiştirilmemeli).
    mesajlar.push({ role: "assistant", content: yanit.content });

    if (yanit.stop_reason === "pause_turn") continue;
    if (yanit.stop_reason === "refusal") {
      return sonuc("Bu isteğe yardımcı olamıyorum. Lütfen farklı biçimde sorun.", "refusal");
    }
    const aracBloklari = yanit.content.filter((b) => b.type === "tool_use");
    if (yanit.stop_reason !== "tool_use" || !aracBloklari.length) {
      return sonuc(metinAl(yanit.content), yanit.stop_reason);
    }
    const sonuclar = aracBloklari.map((b) => {
      olay({ tur: "arac_basladi", ad: b.name, girdi: b.input });
      const r = aracCalistir(veri, b.name, b.input);
      calisanAraclar.push({ ad: b.name, girdi: b.input, hata: r?.hata ?? null, sonuc: r });
      olay({ tur: "arac_bitti", ad: b.name, hata: r?.hata ?? null });
      return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify(r), ...(r?.hata ? { is_error: true } : {}) };
    });
    // Paralel araç sonuçları tek kullanıcı mesajında döner.
    mesajlar.push({ role: "user", content: sonuclar });
  }
  return sonuc("İşlem çok uzun sürdü; isteği daha küçük parçalara bölebilir misiniz?", "max_tur");

  function sonuc(metin, durma) {
    return { yanit: metin, durma, gecmis: mesajlar, araclar: calisanAraclar, kullanim };
  }
}

export const metinAl = (content) => content.filter((b) => b.type === "text").map((b) => b.text).join("\n\n").trim();
