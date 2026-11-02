# İşbirliğim AI Asistan

[isbirligim.com.tr](https://isbirligim.com.tr) için hem **markalara** hem **influencer'lara** hizmet eden yapay zekâ asistanı. Claude, platformun gerçek verisi üzerinde araç kullanarak çalışır; influencer adı veya fiyat uydurmaz.

| Marka modu | Influencer modu |
|---|---|
| Kampanya brief'i hazırlama | Profil analizi ve "Hakkında" metni |
| Kategori/şehir/bütçeye göre influencer bulma | Benzer profillere göre fiyat önerisi |
| Bütçe planı (kimlerle, toplam kaça) | Teklife cevap ve pazarlık mesajı |
| Teklif mesajı yazma | Aktif kampanyalara başvuru metni |
| Reklam metni uyum kontrolü | İçerik fikri ve uyumlu caption |

## Araçlar (`src/araclar.js`)

LLM'siz, deterministik ve test edilmiş fonksiyonlar. Claude bunları çağırır:

- `influencer_ara`: kategori, şehir, takipçi aralığı, içerik türü, en yüksek fiyat, platform ve doğrulama filtresiyle arar. Sonuçları kategori odağı, doğrulama, fiyat bilgisi ve profil açıklamasına göre puanlar.
- `butce_plani`: bütçeyle seçilebilecek influencer karmasını açgözlü bir algoritmayla kurar. Hedef "TL başına erişim" ya da "çeşitlilik" olabilir.
- `fiyat_analizi`: sitedeki fiyat rehberi ortancalarını ve aynı kademe ile kategorideki profillerin fiyat dağılımını (25./50./75. yüzdelik) birleştirerek bir fiyat bandı önerir.
- `profil_analizi`: profilin eksiklerini, fiyatlarının piyasaya göre konumunu ve rakip sayısını çıkarır.
- `kampanya_listesi`: aktif kampanyaları listeler.
- `uyum_kontrol` (`src/uyum.js`): Ticari Reklam Yönetmeliği md. 23/A'ya göre ön kontrol yapar. Bakılan konular:
  - "Reklam/Tanıtım" ibaresi ve metindeki konumu,
  - reklam verenin adı,
  - sağlık beyanı,
  - üstünlük iddiası,
  - çocuklara doğrudan çağrı,
  - yapay zekâ beyanı,
  - indirim koşulları.

  Hukuki görüş değildir.

100 ₺'nin altındaki fiyatlar geçersiz sayılır. Sitede 14 profil "1 ₺" veya "3 ₺" gibi fiyatlar girmiş. Muhtemelen "bin ₺" kastedilmiş. Asistan bu profillere düzeltme önerir.

## Çalıştırma

```bash
npm install
npm test                      # 26 test, API anahtarı gerekmez (sahte LLM istemcisi)
npm run veri                  # data/ klasörünü siteden günceller
npm run demo                  # dist/ (claude.ai sayfası) ve public/index.html üretir
ANTHROPIC_API_KEY=... npm start   # http://localhost:3000
```

Ortam değişkenleri:

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `ANTHROPIC_API_KEY` | (yok) | Tanımlı değilse `/api/asistan` 503 döner, `/api/uyum` yine çalışır. |
| `MODEL` | `claude-opus-5-5` | Kullanılacak model. |
| `EFFORT` | `medium` | Düşünme derinliği. |
| `FALLBACK` | açık | `0` yapılırsa sunucu taraflı reddetme yedeği kapanır. |
| `PORT` | `3000` | Sunucu portu. |

## API

| Uç | Gövde | Yanıt |
|---|---|---|
| `POST /api/asistan` | `{rol: "marka"\|"influencer", mesaj, oturum?}` | `{oturum, yanit, araclar[]}` |
| `POST /api/uyum` | `{metin, kategori?, reklam_veren?}` | `{sonuc, puan, bulgular[]}` |
| `GET /api/saglik` | (yok) | durum |

Sunucunun korumaları:

- Oturum geçmişi sunucuda tutulur ve 1 saat sonra silinir.
- IP başına dakikada en fazla 12 istek kabul edilir.
- Bir mesaj en fazla 4.000 karakter olabilir.
- Aynı oturumda aynı anda tek istek işlenir.
- Hata mesajları dışarıya iç ayrıntı sızdırmaz.

## Siteye entegrasyon (nginx + SPA)

1. Asistanı aynı sunucuda bir servis olarak çalıştırın (`systemd` ya da `pm2` ile `npm start`).
2. nginx'te SPA geri dönüşünden **önce** şu bloğu ekleyin:
   ```nginx
   location /api/asistan { proxy_pass http://127.0.0.1:3000; proxy_set_header X-Forwarded-For $remote_addr; proxy_read_timeout 180s; }
   location /api/uyum    { proxy_pass http://127.0.0.1:3000; }
   ```
3. React tarafında `/api/asistan`'a POST atan bir sohbet bileşeni ekleyin. Hazır referans: `public/index.html` ve `demo/motor/sunucu-api.js`.
   - Marka panelinde `rol: "marka"` kullanın.
   - Influencer panelinde `rol: "influencer"` kullanın.
   - Giriş yapmış kullanıcının kendi profil kullanıcı adını ilk mesaja ekleyebilirsiniz.
4. `uyum_kontrol`'ü anlaşma kartına ve kampanya formuna doğrudan bağlayabilirsiniz. LLM gerektirmez.
5. Verinin güncel kalması için `npm run veri` komutunu günlük bir cron ile çalıştırın. Daha iyisi: araçları doğrudan veritabanınıza bağlayın. `veri` nesnesinin yapısını (`influencerlar`, `fiyatRehberi`, `kampanyalar`) koruyun.

## Canlı test sayfası

`dist/isbirligim-asistan.html` claude.ai'de yayınlanır. Claude'u, sayfayı açan kişinin kendi hesabıyla çağırır. Araçlar tarayıcıda, gömülü veriyle çalışır. API anahtarı gerekmez.

## Dosyalar

```
src/uyum.js         reklam uyum kuralları
src/araclar.js      araçlar + Claude araç şemaları
src/promptlar.js    marka / influencer sistem talimatları
src/asistan.js      Claude araç kullanım döngüsü
src/sunucu.js       HTTP sunucusu
scripts/            veri güncelleme, demo derleme
demo/               arayüz şablonu ve iki motor (claude.ai sayfası / sunucu API)
data/               siteden çekilen herkese açık veri (2026-11-02)
test/               node:test testleri
```
