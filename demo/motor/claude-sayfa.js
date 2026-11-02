// Motor: claude.ai yayınlanmış sayfa. Claude'u görüntüleyenin hesabıyla çağırır
// (claude.use("sample")); araçlar sayfada, gömülü veriyle çalışır.
const MOTOR = {
  sample: null, araclarVar: false,
  async baslat() {
    $("#veri-ozet").textContent = `${VERI.influencerlar.length} profil · ${VERI.kampanyalar.length} aktif kampanya · veri ${VERI.cekilme}`;
    let s = null;
    try { s = await window.claude?.use?.("sample"); } catch {}
    this.sample = s;
    if (!s) {
      not("Canlı yapay zekâ bu görünümde kullanılamıyor (sayfayı claude.ai'de açın). Reklam metni kontrolü burada da çalışır.", true);
      $("#gonder").disabled = true;
      return;
    }
    const lim = await s.limits().catch(() => null);
    this.araclarVar = Boolean(lim?.tools);
    if (!this.araclarVar) not("Bu görünümde araç kullanımı kapalı: asistan genel tavsiye verir, platform verisini çekemez.");
  },
  async sor({ rol, turlar, signal, onText, onArac }) {
    if (!this.sample) throw { code: "yok" };
    const ek = this.araclarVar
      ? "Platform verisine yalnızca araçlarla eriş. Kullanıcının mesajları aşağıda."
      : "Şu an araçlara erişimin yok: belirli influencer adı, fiyat veya kampanya verme; kullanıcıyı isbirligim.com.tr/influencers sayfasına yönlendir.";
    const giris = [{ role: "user", content: SISTEM[rol] + "\n\n" + ek }, ...turlar.slice(-20)];
    const tools = this.araclarVar ? rolAraclari(rol).map((a) => ({
      name: a.name, description: a.description, inputSchema: a.input_schema,
      execute: (input) => {
        const r = aracCalistir(VERI, a.name, input);
        onArac(a.name, input, r);
        if (r?.hata) throw new Error(r.hata);
        return r;
      },
    })) : undefined;
    const { text, truncated } = await this.sample(giris, { signal, tools, ...(tools ? {} : { cache: false }), onText: ({ text }) => onText(text) });
    return truncated ? text + "\n\n*(Yanıt uzunluk sınırında kesildi; daha dar bir soru sorun.)*" : text;
  },
  hataMetni(e) {
    return ({
      not_granted: "Bu sayfanın Claude'u kullanmasına izin verilmedi. Sayfayı yenileyip izin verebilirsiniz.",
      sampling_disabled: "Claude bu hesapta kullanılamıyor.",
      rate_limited: "Kullanım sınırına ulaşıldı. Biraz sonra tekrar deneyin.",
      session_expired: "Oturumunuz kapanmış; claude.ai'ye yeniden giriş yapın.",
      refused: "Claude bu isteği yanıtlamadı. Soruyu farklı biçimde yazın.",
      empty_completion: "Boş yanıt geldi. Soruyu biraz daha açık yazın.",
      prompt_too_large: "Sohbet çok uzadı. Rolü değiştirip geri dönerek yeni sohbet başlatın.",
      tools_unavailable: "Bu görünümde araç kullanımı yok.",
      yok: "Canlı yapay zekâ yalnızca sayfa claude.ai içinde açıldığında çalışır.",
    })[e?.code] ?? "Yapay zekâ servisine ulaşılamadı. Tekrar deneyin.";
  },
};
