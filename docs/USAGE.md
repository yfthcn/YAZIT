# YAZIT — User Guide

Everything you can do with YAZIT. (Türkçe hızlı başlangıç en altta.)

- [Pasting a template](#pasting-a-template)
- [Placeholders](#placeholders)
- [Dynamic variables](#dynamic-variables)
- [Smart fields & the field-builder](#smart-fields--the-field-builder)
- [Rich-text templates](#rich-text-templates)
- [Organising: folders, favorites & search](#organising-folders-favorites--search)
- [Backups, import & export](#backups-import--export)
- [Importing from Text Blaze / Magical](#importing-from-text-blaze--magical)
- [Settings](#settings)
- [Türkçe hızlı başlangıç](#türkçe-hızlı-başlangıç)

---

## Pasting a template

Focus any text field on any page, then use one of four methods:

| Method | How |
|---|---|
| **Keyboard shortcut** | `Ctrl+Shift+1`, `2`, `3` → your first three templates |
| **Popup menu** | Click the YAZIT toolbar icon (or `Alt+Shift+Y`), then click a template |
| **Slash command** | Type `/yourshortcut` then a space/Enter/Tab |
| **Slash autocomplete** | Type `/` then a letter — a dropdown of fuzzy matches appears; `↑`/`↓` to move, `Enter`/`Tab` to paste, `Esc` to dismiss |

> Shortcuts may contain letters, numbers, `_` and `-` (e.g. `/client-reply`).

---

## Placeholders

Put `{{name}}` anywhere in a template body. When you paste, a small form asks
for each one:

```
Hi {{customer_name}},

Your ticket {{ticket_no}} has been resolved.
```

Pasting prompts for `customer_name` and `ticket_no`, then fills them in.

---

## Dynamic variables

These resolve automatically at paste time — locally, with no permissions:

| Variable | Result |
|---|---|
| `{{date}}` | Today, `YYYY-MM-DD` |
| `{{date+3d}}` / `{{date-2w}}` | Offset by **d**ays, **w**eeks, **m**onths, **y**ears |
| `{{time}}` | `HH:MM` |
| `{{datetime}}` | `YYYY-MM-DD HH:MM` |
| `{{date\|dd.MM.yyyy}}` / `{{date+3d\|d MMM yyyy}}` | Formatted: `yyyy-MM-dd` (default), `dd.MM.yyyy`, `dd/MM/yyyy`, `MM/dd/yyyy`, `d MMM yyyy` |
| `{{cursor}}` | Where the caret lands after pasting |

Example: `Follow up by {{date+3d}}. {{cursor}}`

---

## Smart fields & the field-builder

A placeholder can be more than a text box. Full pipe syntax:

```
{{name|Label|type|default|options|flags}}
```

- **type** — `text` (default), `multiline`, `dropdown`, `date`, `checkbox`
- **default** — pre-filled value. A default may reference another field
  (`{{subject|Subject|text|Update on {{ticket}}}}`) and updates live until you
  edit it. For `date`: `today`, `+3d`, `-1w`, `+1m` or an ISO date.
- **options** — `dropdown`: comma-separated list; add `*` for a free-text
  **Other…** entry. `date`: the output format (see dynamic variables).
- **flags** — comma-separated: `remember` (pre-fills with your last value;
  ignored for secret-looking names like `password`, `otp`, `cvv`, `token`),
  `required` (paste is blocked while the field is empty).

Examples:

```
{{priority|Priority|dropdown|Normal|Low,Normal,High,*}}
{{ticket|Ticket #|text|||required,remember}}
{{due|Follow-up|date|+3d|dd.MM.yyyy}}
```

Text fields have a **📋 paste-from-clipboard** button in the form. Forms with
six or more fields switch to a two-column layout.

### Conditional blocks

```
{{#if resolved}}Your issue has been resolved.{{else}}Work is still in progress.{{/if}}
{{#if priority=High}}Escalated to on-call.{{/if}}
```

`{{#if name}}` shows a checkbox in the form (or uses the field if `name` is
already declared); `{{#if name=value}}` compares a dropdown/text value
case-insensitively. Dropped branches never leak their placeholders. One level —
no nesting.

In the editor every field shows in its own colour, the same colour its row
has in the **Fields** panel; condition markers are amber and dynamic variables
grey, so a long template's structure is visible at a glance.

**Easiest way:** select the text that should appear only sometimes and click
**{ if } Condition** above the body. Pick the field, choose *is ticked / filled
in* or *equals* a value, optionally add text for the other case, and **Insert** —
the markers are written around your selection (formatting inside it is kept).
If a template's markers don't pair up (a missing `{{/if}}`, a stray `{{else}}`,
a nested block), a warning under the body says what is wrong before it can leak
into a paste.

**You don't have to memorise this.** In the options page, open a template's
**Fields** panel: it lists every `{{placeholder}}` and lets you set its label,
type, default, options/date format and the remember / required flags with form controls — writing the
syntax back into the body for you. Use **+ Add field** to insert a new one, or
the **Insert variable ▾** menu to drop a dynamic variable at the cursor.

---

## Rich-text templates

By default a template is plain text. Switch a template to **Rich text** (toggle
above the body) to format it:

- Toolbar: **Bold**, *Italic*, Underline, ~~Strike~~ · Heading 2/3, bulleted and
  numbered lists · inline `code`, code block, table (rows × columns, optional
  header row), link (URL + text; click inside an existing link to edit or
  remove it).
- `{{placeholders}}` are highlighted in the editor so they're easy to spot.
- Pasting from Word / Outlook / Google Docs is sanitized **and tidied**: empty
  paragraphs, `&nbsp;` ladders and empty formatting shells are dropped.
- Tables degrade to `a | b` rows and headings to their own line in plain text.
- Pastes **formatted** into rich editors (Gmail, CKEditor, Quill, ProseMirror,
  TinyMCE).
- **Degrades to clean plain text** automatically in `<input>`/`<textarea>`.

For safety, rich content is always passed through a strict sanitizer: only basic
formatting tags survive, scripts/styles/handlers are removed, and unsafe link
schemes (`javascript:` etc.) are stripped. This is also why typing raw `<b>`
tags into a **plain** template shows them literally — that's the safety
guarantee, not a bug. Use Rich mode + the toolbar to format.

---

## Organising: folders, favorites & search

- **Folders** are one level deep. Create one with **+ New folder** (sidebar on
  the settings page, or the *Folder* dropdown on any template), then move a
  template with that dropdown or by dragging its **⠿** handle onto a folder in
  the sidebar. Hover a folder to rename (✎) or delete (×) it — deleting a
  folder moves its templates to *Uncategorized*; it never deletes them.
- **Favorites**: click the ☆ on a template. Favorites are listed first in the
  popup and win ties in the `/` autocomplete.
- In the **popup**, the chips under the search box narrow the list to a folder
  or to favorites.
- The **search** box (settings page and popup) always searches *every*
  template — by name, shortcut, body and **search keywords** (comma-separated
  extra words; this field was called *Tags* before 2.6). Picking a folder
  clears the search.
- Exports store a template's folder by **name**, so importing on another
  machine files it into a folder of the same name (created if missing).
- Reorder by dragging the **⠿** handle, or with the up/down buttons. The first
  three templates get the `Ctrl+Shift+1/2/3` hotkeys.

---

## Backups, import & export

- **Automatic local backups:** a rolling set of the last 5 snapshots is saved
  before any destructive action. Open **Import / Export ▾ → ⟲ Backups** to restore one.
- **Export:** **Import / Export ▾** downloads everything as JSON or copies it
  to the clipboard; select templates for *Export Selected*, or use a card's
  own **Export** button.
- **Import:** choose a JSON file. Merge (with a conflict resolver:
  keep-both / overwrite / skip) or replace. A backup is taken first.

Nothing is uploaded anywhere — sharing a template means handing someone the JSON.

---

## Importing from Text Blaze / Magical

Export your snippets from Text Blaze or Magical as JSON, then use **Import** —
YAZIT auto-detects the format and converts them into templates (vendor
placeholder tokens become `{{placeholders}}` where possible). Everything is
sanitized and validated on the way in.

---

## Settings

Open **⚙ Settings ▾** at the top right of the options page:

- **Language:** Auto / English / Türkçe.
- **Theme:** System / Light / Dark. *System* is the default and follows your OS, switching live; the choice also applies to the popup and the in-page form.
- **Keyboard shortcuts:** the popup and the three paste hotkeys are configured
  in your browser's extension-shortcuts page (`about:addons` →  Manage Extension
  Shortcuts in Firefox; `chrome://extensions/shortcuts` in Chrome).

---

## Türkçe hızlı başlangıç

1. Bir metin alanına tıkla.
2. `/kısayol` yaz + boşluk, ya da `/` yazıp listeden seç, ya da `Ctrl+Shift+1`.
3. Gövdeye `{{ad}}` koyarsan yapıştırırken form açılır.
4. Dinamik: `{{date}}`, `{{date+3d}}`, `{{time}}`, `{{cursor}}`.
5. **Zengin metin** için şablonu Zengin moda al, araç çubuğunu kullan.
6. **Alanlar** panelinden yer tutucuları görsel olarak ayarla.
7. **⟲ Yedekler** ile geri yükle; **İçe aktar** ile Text Blaze/Magical'dan getir.

Hiçbir veri tarayıcı dışına çıkmaz.
