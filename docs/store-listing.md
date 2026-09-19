# YAZIT — Store Listing Copy

Copy-paste ready text for the Firefox Add-ons (AMO) and Chrome Web Store
listings. Keep both stores **identical** so they can't drift (treat it like the
CI locale-parity check). EN and TR variants are provided — both stores support
localized listings.

> **Honesty rule:** never claim anything `manifest.json` doesn't back. The whole
> pitch rests on "nothing leaves your browser" — a future network/permission
> change would make this false advertising. Today: `permissions` = storage,
> activeTab, scripting; `host_permissions` = `<all_urls>`; Firefox
> `data_collection_permissions.required = ["none"]`.

---

## 1. Firefox (AMO)

### Name (≤ 50 chars)
```
YAZIT — Local Template Paster
```

### Summary (≤ 250 chars; keep ~130 for the card)
**EN**
```
Paste ready-made text templates into any web form — keyboard shortcuts, slash commands, placeholders. 100% local: no account, no server, no tracking. Free & open source.
```
**TR**
```
Hazır metin şablonlarını herhangi bir web formuna yapıştır — klavye kısayolu, slash komutu, yer tutucular. %100 yerel: hesap yok, sunucu yok, takip yok. Ücretsiz ve açık kaynak.
```

### Description (EN)
```
Write once. Use anywhere. — and nothing leaves your browser.

YAZIT pastes your reusable templates (canned replies, signatures, ticket
macros, boilerplate) into any text field on any site. Built for support, sales,
IT and anyone who types the same things over and over.

WHAT IT DOES
• Save templates once, paste them anywhere with a shortcut.
• Fill-in placeholders pop up a quick form before pasting.
• Works in Gmail, ServiceNow, Zendesk, Jira and ordinary text boxes alike.

FOUR WAYS TO PASTE
• Keyboard shortcut — Ctrl+Shift+1/2/3 for your first three templates.
• Popup menu — click the toolbar icon (or Alt+Shift+Y) and pick one.
• Slash command — type /yourshortcut and a space in any field.
• Slash autocomplete — type / and choose from a fuzzy-matched dropdown.

POWERFUL, STILL PRIVATE
• Dynamic variables: {{date}}, {{date+3d}}, {{time}}, and {{cursor}} to place
  the caret after pasting — all computed locally, no permissions needed.
• Smart placeholder fields: text, dropdown or date inputs, defaults, and
  optional last-value recall (never for password/OTP-type fields).
• Rich-text templates: bold, links and lists paste formatted into rich editors
  and degrade to clean plain text in plain inputs.
• Visual field-builder: configure placeholders with form controls — no syntax
  to memorise.
• Folders, favorites & search, dark mode, automatic local backups, import/export, and
  one-click import from Text Blaze or Magical.

PRIVATE BY DESIGN — VERIFY IT YOURSELF
• No network requests. No analytics. No telemetry. No account. No server.
• Your templates live in your browser's local storage and are never synced or
  transmitted unless YOU export them.
• Every file is plain JavaScript — search the source for fetch(, XMLHttpRequest
  or sendBeacon and you won't find a single external URL.
• Free and open source under the GPLv3.

WORKS EVERYWHERE
Plain <input>/<textarea> and rich editors (CKEditor, Quill, ProseMirror,
TinyMCE, Gmail). Bilingual interface: English and Türkçe (auto-detected).

Source & issues: https://github.com/yfthcn/YAZIT
```

### Description (TR)
```
Bir kez yaz. Her yerde kullan. — ve hiçbir şey tarayıcından çıkmaz.

YAZIT, tekrar kullandığın şablonları (hazır yanıtlar, imzalar, talep
makroları, kalıp metinler) herhangi bir sitedeki herhangi bir metin alanına
yapıştırır. Destek, satış, BT ve aynı şeyleri sürekli yazan herkes için.

NE YAPAR
• Şablonu bir kez kaydet, her yere kısayolla yapıştır.
• Doldurmalı yer tutucular yapıştırmadan önce küçük bir form açar.
• Gmail, ServiceNow, Zendesk, Jira ve sıradan metin kutularında çalışır.

DÖRT YAPIŞTIRMA YOLU
• Klavye kısayolu — ilk üç şablon için Ctrl+Shift+1/2/3.
• Açılır menü — araç çubuğu simgesine tıkla (veya Alt+Shift+Y), seç.
• Slash komutu — herhangi bir alanda /kısayolun yazıp boşluk bırak.
• Slash otomatik tamamlama — / yaz, bulanık eşleşen listeden seç.

GÜÇLÜ AMA GİZLİ
• Dinamik değişkenler: {{date}}, {{date+3d}}, {{time}} ve yapıştırma sonrası
  imleci konumlayan {{cursor}} — hepsi yerelde hesaplanır, izin gerekmez.
• Akıllı yer tutucu alanları: metin, açılır liste veya tarih girişi,
  varsayılanlar ve isteğe bağlı son-değer hatırlama (şifre/OTP alanlarında asla).
• Zengin metin şablonları: kalın, bağlantı ve listeler zengin editörlere biçimli
  yapışır, düz alanlarda temiz düz metne döner.
• Görsel alan oluşturucu: yer tutucuları form denetimleriyle ayarla — ezberlenecek
  söz dizimi yok.
• Klasörler, favoriler ve arama, koyu tema, otomatik yerel yedek, içe/dışa aktarma ve Text
  Blaze veya Magical'dan tek tıkla içe aktarma.

TASARIM GEREĞİ GİZLİ — KENDİN DOĞRULA
• Ağ isteği yok. Analitik yok. Telemetri yok. Hesap yok. Sunucu yok.
• Şablonların tarayıcının yerel deposunda durur; sen dışa aktarmadıkça asla
  senkronlanmaz veya iletilmez.
• Her dosya düz JavaScript — kaynakta fetch(, XMLHttpRequest veya sendBeacon ara,
  tek bir dış URL bulamazsın.
• GPLv3 altında ücretsiz ve açık kaynak.

HER YERDE ÇALIŞIR
Düz <input>/<textarea> ve zengin editörler (CKEditor, Quill, ProseMirror,
TinyMCE, Gmail). İki dilli arayüz: İngilizce ve Türkçe (otomatik algılanır).

Kaynak ve sorunlar: https://github.com/yfthcn/YAZIT
```

### Notes to reviewer (private — pastes into the "Notes for reviewers" box)
```
YAZIT is a local-only template paster. It makes ZERO network requests; the
only fetch() loads the bundled _locales/<lang>/messages.json via
chrome.runtime.getURL (extension-internal). No analytics, no remote code, no
external connections.

Permission justification:
• storage    — persist the user's templates in chrome.storage.local. Never
               synced, never transmitted.
• activeTab  — deliver the paste only to the tab the user explicitly triggered.
• scripting  — inject the content script on demand as an MV3 fallback when it is
               not already present. No remote code is ever loaded.
• <all_urls> — the user pastes templates into a form on whatever site THEY are
               using. The content script is passive (tracks focus, expands a
               typed /shortcut) and makes no network requests.

Firefox manifest declares data_collection_permissions.required = ["none"].
The add-on is open source (GPLv3) and reproducibly built from build.py:
https://github.com/yfthcn/YAZIT
```

### Categories / tags
- Category: **Productivity** (secondary: Privacy & Security)
- Tags: `template`, `text-expander`, `snippets`, `productivity`, `privacy`,
  `servicenow`, `gmail`, `local`

---

## 2. Chrome Web Store

Reuse the **same** Name, Summary, Description (EN + TR) and the same reviewer
permission justification. Chrome-specific notes:

- **Category:** Productivity
- **Single page** description field; paste the EN/TR description above.
- **One-time US$5** developer registration fee applies to the Chrome Web Store
  (AMO and GitHub Pages are free). Submit AMO first while registering for Chrome.
- Chrome has no `data_collection_permissions` field; instead complete the
  **Privacy practices** tab: declare that no user data is collected or
  transmitted, and that permissions are used solely for local pasting (mirror
  the reviewer note above). Privacy-policy URL:
  `https://yfthcn.github.io/YAZIT/privacy.html`.

---

## 3. Asset checklist (required before submitting)

- [ ] 1280×800 screenshots (Chrome + AMO spec), light **and** dark variants
- [ ] < 3 MB looping hero GIF
- [ ] Promo / marquee tile if you want featured placement (optional)
- [ ] Shot list: (1) slash autocomplete (2) placeholder form (3) options CRUD +
      drag reorder (4) import from Text Blaze (5) dynamic date/cursor (6)
      rich-text pasting into CKEditor/Gmail (7) visual field-builder panel

See the repo README "Development" section and the GitHub Pages product page for
where these assets live (`docs/assets/`).
