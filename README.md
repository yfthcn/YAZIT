<div align="center">

<img src="icons/icon128.png" width="96" height="96" alt="YAZIT logo" />

# YAZIT

**Write once. Use anywhere.**

_Bir kez yaz. Her yerde kullan._

A small, framework-free browser extension that pastes ready-made text templates
into any web form — ServiceNow, Zendesk, Jira, Gmail, a GitHub issue box, or a
plain `<textarea>`. Keyboard shortcuts, slash commands, fill-in forms.
No account, no server, no telemetry.

[![Version](https://img.shields.io/badge/version-2.7.0-e8a33d)](CHANGELOG.md)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![License: GPL v3](https://img.shields.io/badge/License-GPL_v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Browsers](https://img.shields.io/badge/browsers-Chrome%20%7C%20Edge%20%7C%20Firefox-success)](#installation)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](#privacy)

[Website](https://yfthcn.github.io/yazit/) ·
[User guide](docs/USAGE.md) ·
[Install](#installation) ·
[Usage](#usage) ·
[Privacy](#privacy) ·
[Development](#development) ·
**[Türkçe ↓](#türkçe)**

</div>

---

## Table of contents

- [What it does](#what-it-does)
- [Installation](#installation)
- [Usage](#usage)
- [Template syntax](#template-syntax)
- [Privacy](#privacy)
- [Permissions](#permissions)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)
- [Türkçe](#türkçe)

---

## What it does

You keep a list of templates. You paste one wherever your caret is.

| | |
|---|---|
| **Four ways to paste** | `Ctrl+Shift+1…3` for the first three templates, the toolbar popup, a `/shortcut` + <kbd>Space</kbd> slash command, or the fuzzy `/` autocomplete dropdown |
| **Fill-in forms** | `{{customer_name}}` opens a small form before pasting — text, multiline, dropdown, date and checkbox fields |
| **Dynamic values** | `{{date}}`, `{{date+3d}}`, `{{date\|dd.MM.yyyy}}`, `{{time}}`, `{{datetime}}`, and `{{cursor}}` to place the caret |
| **Conditionals** | `{{#if urgent}}…{{else}}…{{/if}}` |
| **Rich text** | Bold, italic, headings, lists, code, tables and links paste as real formatting into rich editors, and degrade to clean plain text in `<input>` / `<textarea>` |
| **Visual field builder** | Configure fields with form controls instead of memorising the pipe syntax |
| **Folders & favorites** | One-level folders and starred templates — a sidebar in settings, filter chips in the popup, favorites first everywhere |
| **Search** | Full-text search across names, shortcuts, bodies and search keywords |
| **Automatic backups** | A rolling 5-snapshot local safety net, taken before every destructive action |
| **Import / export** | JSON in and out, plus one-click import from **Text Blaze** and **Magical** exports |
| **Secret-aware** | Fields named like credentials (`password`, `şifre`, `kart_no`, `api_key`, `iban`…) can never have their value remembered |
| **Light / dark theme** | System (default), Light or Dark from the settings page — applies everywhere, including the in-page form |
| **Bilingual** | English and Turkish, auto-detected or chosen manually |

Works in `<textarea>`, `<input>`, and contenteditable editors such as TinyMCE,
CKEditor, Quill, ProseMirror and Gmail. IME-safe, so it stays out of the way of
Turkish, Japanese, Chinese and Korean input.

---

## Installation

One source tree, two packages — pick the one for your browser.

### Chrome · Edge · Brave · Opera · Vivaldi

1. Download `yazit-chrome.zip` from [Releases](https://github.com/yfthcn/yazit/releases).
2. Extract it to a **permanent** folder (the browser loads it from there every start).
3. Open `chrome://extensions` (or `edge://extensions`).
4. Turn on **Developer mode**.
5. **Load unpacked** → select the extracted folder.
6. Pin it: 🧩 → pin “YAZIT”.

Requires Chrome / Edge **105+**.

### Firefox

**From AMO:** install from
[addons.mozilla.org](https://addons.mozilla.org/firefox/addon/yazit/).

**Temporary install (for testing):**

1. Download `yazit-firefox.zip` from [Releases](https://github.com/yfthcn/yazit/releases) and extract it.
2. Open `about:debugging#/runtime/this-firefox`.
3. **Load Temporary Add-on** → select `manifest.json`.

Requires Firefox **140+** (Firefox for Android **142+**).
Temporary add-ons are removed when Firefox restarts.

---

## Usage

**Paste**

- <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>1…3</kbd> — the first three templates, in list order.
  The popup shows your real bindings, including macOS `⌘` and any remap you made.
- **Toolbar popup** (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>) — search and click.
- **Slash command** — type `/greeting` then <kbd>Space</kbd>, <kbd>Enter</kbd> or <kbd>Tab</kbd>.
- **Slash autocomplete** — type `/` and a letter or two; pick from the dropdown with
  <kbd>↑</kbd> <kbd>↓</kbd> and <kbd>Enter</kbd>. You do not have to remember shortcuts.

**Manage** — open the options page from the popup. Add, edit, reorder by dragging
the **⠿** handle, tag, search, select several and export them, or restore a backup.

---

## Template syntax

**A placeholder** is anything in double braces. The short form is just a name:

```
Hi {{customer_name}}, your ticket {{ticket_id}} is resolved.
```

**The long form** adds a label, a type, a default, options and flags:

```
{{name|label|type|default|options|flags}}
```

| Slot | Values |
|---|---|
| `type` | `text` · `multiline` · `dropdown` · `date` · `checkbox` |
| `default` | any text; for `date`: `today`, `+3d`, `-2w`, `+1m`, or an ISO date |
| `options` | for `dropdown`: `a,b,c` (add `*` for a free-text “Other…” entry); for `date`: the output format |
| `flags` | `remember` (pre-fill with the last value used), `required` (block pasting while empty) |

```
{{priority|Priority|dropdown|Normal|Low,Normal,High,*|required}}
{{due|Due date|date|+3d|dd.MM.yyyy}}
{{notes|Internal notes|multiline}}
{{signature|Sign off?|checkbox|true}}
```

**Dynamic values** need no form and no permissions — they resolve locally at paste time:

```
{{date}}  {{date+3d}}  {{date-2w}}  {{date|d MMM yyyy}}
{{time}}  {{datetime}}  {{cursor}}
```

Date formats: `yyyy-MM-dd` · `dd.MM.yyyy` · `dd/MM/yyyy` · `MM/dd/yyyy` · `d MMM yyyy`.

**Conditionals** keep one template instead of three:

```
{{#if urgent}}This is urgent — please prioritise.{{else}}No rush.{{/if}}
{{#if plan=pro}}Your Pro plan includes phone support.{{/if}}
```

An `{{#if}}` on a name you never declared becomes a checkbox in the form automatically.
No need to type the markers: select text and click **{ if } Condition** — YAZIT writes them for you and warns if a template's markers don't pair up.

**`{{cursor}}`** marks where the caret lands after pasting.

Prefer clicking? The **{ } Fields** panel on each template builds all of this with
form controls and writes the syntax for you.

---

## Privacy

YAZIT has no backend, because it has nothing to send anywhere.

- **No network requests.** The only `fetch()` in the codebase loads the
  extension's own bundled locale file via `chrome.runtime.getURL()`.
- **No analytics, no telemetry, no crash reporting, no remote config.**
- **No third-party code.** Zero runtime dependencies, no bundled libraries, no
  CDN, no remote script — everything in the package is plain JavaScript you can read.
- **Local storage only.** Templates live in `chrome.storage.local` on your machine.
  Nothing is synced unless you export a file yourself.
- **Credential fields are never remembered.** A field whose name looks like a
  secret — `password`, `pwd`, `otp`, `cvv`, `iban`, `api_key`, `şifre`, `parola`,
  `kart_no`, `güvenlik_kodu`, `kimlik_no` and more, in English and Turkish — has
  its `remember` flag refused, both when the template is parsed and again at the
  storage layer.
- **Password inputs are never a paste target.** `<input type="password">` is
  excluded on purpose.
- The Firefox package declares `data_collection_permissions: { required: ["none"] }`.

Don't take our word for it — grep the source for `fetch(`, `XMLHttpRequest`,
`WebSocket` or `sendBeacon`. There is no external URL anywhere in the extension.

**Rich text is sanitized, twice.** HTML templates go through a strict
allowlist — a fixed set of formatting tags, no attributes except a protocol-checked
`href` — on write, on read, and once more immediately before pasting. Values you
type into a fill-in form are HTML-escaped before they are substituted.

---

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Saving your templates, settings and local backups |
| `scripting` | Re-injecting the content script into a tab that was already open when the extension was installed or updated |
| `host_permissions: <all_urls>` | The slash command and the `/` autocomplete have to work in the field you are typing in, on any site — a content script cannot be limited to “the page you clicked from” |

There is no `tabs` permission: the extension reads a tab's URL only to refuse
pasting into browser-internal and extension-store pages.

---

## Development

Requires **Node 24+** (Active LTS) and **Python 3** for the packaging script.

```bash
git clone https://github.com/yfthcn/yazit.git
cd yazit

# Dev tooling only. The extension ships ZERO runtime dependencies;
# nothing installed here is ever packaged.
npm ci

npm test           # unit tests (node:test)
npm run typecheck  # tsc --noEmit over all JS, via jsconfig.json + JSDoc types
npm run build      # -> dist/yazit-chrome.zip + dist/yazit-firefox.zip
npm run lint:ext   # web-ext lint (the official AMO validator)
npm run check      # all four, in order — run this before opening a PR
```

**Loading it unpacked while developing** — no build step needed:

- Chrome / Edge: `chrome://extensions` → Developer mode → **Load unpacked** → the project folder.
- Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `manifest.json`.

### Project structure

```
yazit/
├── manifest.json        MV3 manifest (Chrome shape; build.py derives the Firefox one)
├── build.py             Produces both store packages from this single source
│
├── common.js            Core, shared by EVERY context — i18n, the HTML sanitizer,
│                        storage + schema migration, dynamic variables, placeholder
│                        parsing, the fuzzy scorer
├── common-ui.js         Extension-page half — tab-paste helpers, backups, import
│                        adapters, debounce, full-text search, field-token builder.
│                        Loaded by the popup, options page and background ONLY, so
│                        none of it is injected into the pages you browse.
├── background.js        Service worker (Chrome) / background script (Firefox)
├── content.js           Injected into pages — paste logic, slash detection, in-page UI
├── popup.html  popup.js       Template picker
├── options.html options.js    Settings — CRUD, tags, search, backups, import/export
│
├── _locales/en|tr/messages.json   UI strings (key sets are kept in sync by a test)
├── icons/               16 / 48 / 128 px
├── docs/                GitHub Pages product site (not part of the extension)
│
├── test/common.test.js  node:test unit tests
├── test/dom-shim.js     A DOMParser over parse5, so the tests can exercise the
│                        sanitizer's DOM path as well as its DOM-free one
├── types/globals.d.ts   Ambient types — the public TL contract
└── jsconfig.json        ts-check configuration
```

`test/`, `types/`, `docs/`, `jsconfig.json` and the npm files are dev-only and are
never included in a package.

### A few conventions worth knowing

- **No build step for the extension itself.** The files you edit are the files
  that ship. No bundler, no transpiler, no framework.
- **`TL` is one global assembled by script order**, not an import graph. A test
  derives every context's script list from the real configs (`manifest.json`, both
  HTML pages, `build.py`) and fails if any context calls a `TL` member the files it
  loads do not define. Add a function to the wrong half and the test says so.
- **`TL.sanitizeHtml` has two implementations** and both run in production:
  `DOMParser` is `[Exposed=Window]`, so page contexts get the DOM path while
  Chrome's MV3 service worker falls back to the DOM-free one. The test suite runs
  both.
- **One HTML insertion path.** Everything else builds UI with `createElement` +
  `textContent`. There is no `innerHTML` write in the codebase.
- **`document.execCommand` is reached only through `TL.editorAdapter`**, so the
  editing backend can be replaced in one place when browsers drop it.
- **The version lives in `manifest.json`.** `package.json`, the badge above and
  the docs landing page mirror it, and a test fails the build if any copy drifts.

### Why two packages?

Chrome MV3 requires `background.service_worker`; Firefox MV3 wants
`background.scripts`. One manifest would warn in one browser or the other, so
`build.py` emits a browser-specific manifest from a single source while the code
stays byte-identical.

### Adding a language

1. Copy `_locales/en/messages.json` to `_locales/<code>/messages.json` and translate
   every `"message"` value.
2. Add the option to the language `<select>` in `options.html`.
3. Extend the `"tr"` check in `TL.loadLocale` (`common.js`) so `auto` can resolve to it.

`npm test` fails if the locale key sets diverge.

---

## Contributing

Pull requests welcome. Please keep them focused — one subject per PR — and run
`npm run check` first. The codebase is deliberately small and framework-free;
let's keep it that way. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Free and open-source software under the
[GNU General Public License v3.0](LICENSE).

Copyright © 2026 yfthcn ([kaktusdev.net](https://kaktusdev.net))

This program is distributed in the hope that it will be useful, but **without any
warranty**; without even the implied warranty of merchantability or fitness for a
particular purpose. See the GNU General Public License for details.

---
---

# Türkçe

<div align="center">

**Bir kez yaz. Her yerde kullan.**

</div>

YAZIT, hazır metin şablonlarını herhangi bir web formuna yapıştıran küçük bir
tarayıcı eklentisidir — ServiceNow, Zendesk, Jira, Gmail, bir GitHub issue kutusu
ya da düz bir `<textarea>`. Klavye kısayolları, slash komutları, doldurma formları.
Hesap yok, sunucu yok, telemetri yok.

## Ne yapar

| | |
|---|---|
| **Dört yoldan yapıştırma** | İlk üç şablon için `Ctrl+Shift+1…3`, araç çubuğu açılır menüsü, `/kısayol` + <kbd>Boşluk</kbd>, ya da bulanık eşleşmeli `/` otomatik tamamlama |
| **Doldurma formu** | `{{musteri_adi}}` yapıştırmadan önce küçük bir form açar — metin, çok satırlı, açılır liste, tarih ve onay kutusu alanları |
| **Dinamik değerler** | `{{date}}`, `{{date+3d}}`, `{{date\|dd.MM.yyyy}}`, `{{time}}`, `{{datetime}}` ve imleci konumlandıran `{{cursor}}` |
| **Koşullu bloklar** | `{{#if acil}}…{{else}}…{{/if}}` |
| **Zengin metin** | Kalın, italik, başlık, liste, kod, tablo ve bağlantılar zengin editörlere gerçek biçimlendirme olarak girer; `<input>` / `<textarea>` içinde temiz düz metne iner |
| **Görsel alan oluşturucu** | Boru (`\|`) sözdizimini ezberlemek yerine form denetimleriyle yapılandır |
| **Klasörler ve favoriler** | Tek seviyeli klasörler ve yıldızlı şablonlar — ayarlarda kenar çubuğu, açılır menüde filtre çipleri, favoriler her yerde önde |
| **Arama** | Ad, kısayol, gövde ve arama anahtar kelimelerinde tam metin arama |
| **Otomatik yedek** | Her yıkıcı işlemden önce alınan, 5 anlık görüntülük yerel güvenlik ağı |
| **İçe / dışa aktarma** | JSON giriş-çıkış, ayrıca **Text Blaze** ve **Magical** dışa aktarımlarından tek tıkla içe aktarma |
| **Sır farkındalığı** | Kimlik bilgisi gibi adlandırılmış alanların (`şifre`, `parola`, `kart_no`, `api_key`, `iban`…) değeri asla hatırlanmaz |
| **Karanlık kip** | Sayfa içi form dâhil her yerde işletim sistemi temasını izler |
| **İki dilli** | İngilizce ve Türkçe; otomatik algılanır veya elle seçilir |

`<textarea>`, `<input>` ve TinyMCE, CKEditor, Quill, ProseMirror, Gmail gibi
contenteditable editörlerde çalışır. IME uyumludur — Türkçe, Japonca, Çince ve
Korece giriş yöntemlerinin önüne geçmez.

## Kurulum

**Chrome · Edge · Brave · Opera · Vivaldi** (105+)

1. [Releases](https://github.com/yfthcn/yazit/releases) sayfasından `yazit-chrome.zip` dosyasını indir.
2. **Kalıcı** bir klasöre çıkar — tarayıcı her açılışta oradan yükler.
3. `chrome://extensions` adresini aç, **Geliştirici modu**'nu etkinleştir.
4. **Paketlenmemiş öğe yükle** → çıkardığın klasörü seç.
5. 🧩 simgesinden "YAZIT"ı sabitle.

**Firefox** (140+, Android'de 142+)

[addons.mozilla.org](https://addons.mozilla.org/firefox/addon/yazit/) üzerinden
kur. Geçici kurulum için: `yazit-firefox.zip` indir ve çıkar,
`about:debugging#/runtime/this-firefox` adresinde **Geçici Eklenti Yükle** → `manifest.json`.
Geçici eklentiler Firefox yeniden başlayınca kaldırılır.

## Kullanım

- <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>1…3</kbd> — liste sırasına göre ilk üç şablon.
  Açılır menü, macOS `⌘` dâhil gerçek tuş atamalarını gösterir.
- **Açılır menü** (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>) — ara ve tıkla.
- **Slash komutu** — `/selam` yazıp <kbd>Boşluk</kbd>, <kbd>Enter</kbd> veya <kbd>Tab</kbd>.
- **Otomatik tamamlama** — `/` ve bir iki harf yaz, <kbd>↑</kbd> <kbd>↓</kbd> ile seç,
  <kbd>Enter</kbd> ile yapıştır. Kısayolları ezberlemene gerek yok.

Şablonları yönetmek için açılır menüden ayarlar sayfasını aç: ekle, düzenle,
**⠿** tutamacından sürükleyerek sırala, etiketle, ara, birkaçını seçip dışa aktar
veya bir yedeği geri yükle.

## Şablon sözdizimi

Kısa biçim yalnızca bir addır: `Merhaba {{musteri_adi}}`.
Uzun biçim etiket, tip, varsayılan, seçenek ve bayrak ekler:

```
{{ad|etiket|tip|varsayılan|seçenekler|bayraklar}}
```

- **tip** — `text` · `multiline` · `dropdown` · `date` · `checkbox`
- **varsayılan** — herhangi bir metin; `date` için `today`, `+3d`, `-2w`, `+1m` veya ISO tarih
- **seçenekler** — `dropdown` için `a,b,c` (serbest metin girişi eklemek için `*`); `date` için çıktı biçimi
- **bayraklar** — `remember` (son kullanılan değerle doldur), `required` (boşken yapıştırmayı engelle)

```
{{oncelik|Öncelik|dropdown|Normal|Düşük,Normal,Yüksek,*|required}}
{{tarih|Son tarih|date|+3d|dd.MM.yyyy}}
{{notlar|İç notlar|multiline}}
```

Dinamik değerler form açmaz, izin gerektirmez, yapıştırma anında yerel olarak çözülür:
`{{date}}` `{{date+3d}}` `{{date|d MMM yyyy}}` `{{time}}` `{{datetime}}` `{{cursor}}`

Koşullu bloklar üç şablon yerine bir şablon tutmanı sağlar:

```
{{#if acil}}Bu talep acil — lütfen önceliklendirin.{{else}}Acelesi yok.{{/if}}
{{#if plan=pro}}Pro planınız telefon desteği içerir.{{/if}}
```

Hiç tanımlamadığın bir ada `{{#if}}` yazarsan forma otomatik olarak bir onay kutusu gelir.
İşaretleri elle yazman gerekmez: metni seçip **{ if } Koşul**'a tıkla — YAZIT onları senin yerine yazar, eşleşmeyen işaretler olursa uyarır.
Sözdizimini ezberlemek istemiyorsan her şablondaki **{ } Alanlar** paneli bunların
hepsini form denetimleriyle kurar.

## Gizlilik

YAZIT'ın sunucusu yoktur, çünkü gönderecek bir şeyi yoktur.

- **Ağ isteği yok.** Kodda geçen tek `fetch()` çağrısı, `chrome.runtime.getURL()`
  ile eklentinin kendi paket içi dil dosyasını okur.
- **Analitik, telemetri, çökme raporu, uzak yapılandırma yok.**
- **Üçüncü taraf kod yok.** Sıfır çalışma zamanı bağımlılığı; paketlenmiş kütüphane,
  CDN veya uzaktan yüklenen script yok. Pakete giren her şey okunabilir düz JavaScript.
- **Yalnızca yerel depolama.** Şablonlar `chrome.storage.local` içinde, senin
  makinende durur. Kendin bir dosya dışa aktarmadıkça hiçbir şey eşitlenmez.
- **Kimlik bilgisi alanları hatırlanmaz.** Adı sır gibi görünen alanlar — `şifre`,
  `parola`, `kart_no`, `güvenlik_kodu`, `kimlik_no`, `password`, `otp`, `cvv`,
  `iban`, `api_key` ve dahası — `remember` bayrağını hem şablon ayrıştırılırken
  hem de depolama katmanında reddeder.
- **Parola alanları hedef değildir.** `<input type="password">` bilinçli olarak dışarıda bırakılmıştır.
- Firefox paketi `data_collection_permissions: { required: ["none"] }` beyan eder.

Sözümüze güvenme, kaynakta `fetch(`, `XMLHttpRequest`, `WebSocket` veya
`sendBeacon` ara — eklentide hiçbir dış URL yok.

**Zengin metin iki kez temizlenir.** HTML şablonlar sıkı bir izin listesinden
geçer (sabit bir biçimlendirme etiketi kümesi, protokolü denetlenen `href` dışında
hiç öznitelik yok): yazarken, okurken ve yapıştırmadan hemen önce bir kez daha.
Doldurma formuna yazdığın değerler yerine konmadan önce HTML olarak kaçırılır.

## İzinler

| İzin | Neden gerekli |
|---|---|
| `storage` | Şablonları, ayarları ve yerel yedekleri saklamak |
| `scripting` | Eklenti kurulduğunda veya güncellendiğinde zaten açık olan sekmelere content script'i yeniden enjekte etmek |
| `host_permissions: <all_urls>` | Slash komutu ve `/` otomatik tamamlama, hangi sitede olursan ol yazdığın alanda çalışmak zorunda — content script "tıkladığın sayfa" ile sınırlanamaz |

`tabs` izni yoktur: sekmenin adresi yalnızca tarayıcı iç sayfalarına ve eklenti
mağazası sayfalarına yapıştırmayı reddetmek için okunur.

## Geliştirme

**Node 24+** (Active LTS) ve paketleme betiği için **Python 3** gerekir.

```bash
npm ci             # yalnızca geliştirme araçları; hiçbiri pakete girmez
npm test           # birim testleri (node:test)
npm run typecheck  # JSDoc tipleriyle tsc --noEmit
npm run build      # dist/yazit-chrome.zip + dist/yazit-firefox.zip
npm run lint:ext   # web-ext lint (resmî AMO doğrulayıcısı)
npm run check      # dördü de sırayla — PR açmadan önce bunu çalıştır
```

Eklentinin kendisi için derleme adımı yoktur: düzenlediğin dosyalar, yayınlanan
dosyalardır. Bundler yok, transpiler yok, framework yok.

Katkı için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bak; PR'ları tek konuya
odaklı tut ve önce `npm run check` çalıştır.

## Lisans

[GNU Genel Kamu Lisansı v3.0](LICENSE) altında özgür ve açık kaynak yazılım.

Telif © 2026 yfthcn ([kaktusdev.net](https://kaktusdev.net))

Bu program faydalı olacağı umuduyla dağıtılmaktadır, ancak **hiçbir garanti
verilmez**; satılabilirlik veya belirli bir amaca uygunluk zımni garantisi dahi
verilmez. Ayrıntılar için GNU Genel Kamu Lisansı'na bakın.
