// Motor: kendi Node sunucumuz (src/sunucu.js). Araçlar ve Claude çağrısı sunucuda.
const MOTOR = {
  oturum: { marka: null, influencer: null },
  async baslat() {
    try {
      const s = await (await fetch("/api/saglik")).json();
      $("#veri-ozet").textContent = `${s.influencer} profil · veri ${s.veri_tarihi}`;
      if (!s.llm) not("Sunucuda ANTHROPIC_API_KEY tanımlı değil: sohbet çalışmaz, reklam metni kontrolü çalışır.", true);
    } catch { not("Sunucuya ulaşılamadı.", true); }
  },
  async sor({ rol, turlar, signal, onArac }) {
    let r;
    try {
      r = await fetch("/api/asistan", { method: "POST", headers: { "content-type": "application/json" }, signal,
        body: JSON.stringify({ rol, mesaj: turlar.at(-1).content, oturum: this.oturum[rol] }) });
    } catch (e) { throw e?.name === "AbortError" ? { code: "cancelled" } : { code: "ag", message: "Sunucuya ulaşılamadı." }; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw { code: "http", message: j.hata || `Sunucu hatası (${r.status})` };
    this.oturum[rol] = j.oturum;
    for (const a of j.araclar ?? []) onArac(a.ad, a.girdi, a.sonuc ?? (a.hata ? { hata: a.hata } : null));
    return j.yanit;
  },
  hataMetni(e) { return e?.message || "Bir hata oluştu."; },
};
