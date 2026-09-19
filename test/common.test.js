// ==============================
// YAZIT — Unit tests (node:test, zero-dependency)
// Run: npm test   (or: node --test)
// Exercises only the pure helpers in common.js — nothing touches chrome.*
// ==============================
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const TL = require("../common.js");
require("../common-ui.js"); // extends the same TL object
const { withDom } = require("./dom-shim.js");

// --- Shortcut char-class (plan step 1) ---
test("stripShortcut keeps the allowed class, drops the rest, trims hyphens", () => {
  assert.equal(TL.stripShortcut("my-temp"), "my-temp");
  assert.equal(TL.stripShortcut("şifre"), "ifre");        // Turkish stripped (ASCII class)
  assert.equal(TL.stripShortcut("a b!c@"), "abc");
  assert.equal(TL.stripShortcut("trail-"), "trail");       // trailing hyphen trimmed
});

test("stripShortcut caps first, so an over-long value can't end in a hyphen", () => {
  const max = TL.LIMITS.MAX_SHORTCUT;
  // Cut exactly ON a hyphen: trimming before the cap left the hyphen behind.
  const onHyphen = TL.stripShortcut("a".repeat(max - 1) + "--b");
  assert.equal(onHyphen, "a".repeat(max - 1));
  // A value that is all hyphens past the cap collapses to the kept prefix.
  assert.equal(TL.stripShortcut("ab" + "-".repeat(max)), "ab");
  for (const s of ["x".repeat(max + 10), "-".repeat(max + 5), "a-".repeat(max)]) {
    const out = TL.stripShortcut(s);
    assert.ok(out.length <= max, `capped: ${out.length} <= ${max}`);
    assert.ok(!out.endsWith("-"), `no trailing hyphen: ${JSON.stringify(out)}`);
  }
});

test("slashRegex matches hyphenated shortcuts (the original bug)", () => {
  assert.ok(TL.slashRegex().test("hello /my-temp"));
  assert.equal(TL.slashRegex().exec("x /pass")[1], "pass");
  assert.equal(TL.slashRegex().exec("/a-b-c")[1], "a-b-c");
});

// --- Schema migration (plan step 7) ---
test("migrate v1 → current assigns stable ids, order and schemaVersion", () => {
  const v1 = { templates: [{ name: "A", body: "x" }, { name: "B", body: "y" }], uiLang: "tr" };
  const m = TL.migrate(v1);
  assert.equal(m.schemaVersion, TL.CURRENT_SCHEMA);
  assert.equal(TL.CURRENT_SCHEMA, 4);
  assert.equal(m.uiLang, "tr");                  // unknown/other keys preserved
  assert.equal(m.templates[0].order, 0);
  assert.ok(m.templates[0].id.startsWith("t_"));
});

test("migrate v2 → v3 strips the retired per-template fields array", () => {
  const v2 = { templates: [{ id: "t_1", order: 0, name: "A", body: "{{x}}", fields: [{ name: "x" }] }] };
  const m = TL.migrate(v2);
  assert.equal("fields" in m.templates[0], false);
  assert.equal(m.templates[0].id, "t_1");
  assert.deepEqual(TL.parseFields(m.templates[0].body).map((f) => f.name), ["x"]); // still derived from body
});

test("fnv1a is deterministic, 8 hex chars, and feeds template ids", () => {
  assert.match(TL.fnv1a("abc"), /^[0-9a-f]{8}$/);
  assert.equal(TL.fnv1a("abc"), TL.fnv1a("abc"));
  assert.notEqual(TL.fnv1a("abc"), TL.fnv1a("abd"));
  const [t] = TL.migrate({ templates: [{ name: "N", body: "B" }] }).templates;
  assert.equal(t.id, "t_" + TL.fnv1a("N B"));
});

test("slotKeysHint collapses a shared prefix, otherwise joins bound keys", () => {
  assert.equal(TL.slotKeysHint(["Ctrl+Shift+1", "Ctrl+Shift+2", "Ctrl+Shift+3"]), "Ctrl+Shift+1..3");
  assert.equal(TL.slotKeysHint(["⌘⇧1", "⌘⇧2", "⌘⇧3"]), "⌘⇧1..3");
  assert.equal(TL.slotKeysHint(["Alt+1", "", "Ctrl+Shift+3"]), "Alt+1 / Ctrl+Shift+3");
  assert.equal(TL.slotKeysHint(["", "", ""]), "");
  assert.equal(TL.slotKeysHint(/** @type {any} */ (null)), "");
});

test("migrate is deterministic across contexts and idempotent", () => {
  const input = { templates: [{ name: "A", body: "x" }, { name: "B", body: "y" }] };
  const a = TL.migrate(input);
  const b = TL.migrate(input);
  assert.deepEqual(a.templates.map((t) => t.id), b.templates.map((t) => t.id));
  const again = TL.migrate(a);
  assert.deepEqual(again.templates.map((t) => t.id), a.templates.map((t) => t.id));
});

test("migrate disambiguates identical templates deterministically", () => {
  const m = TL.migrate({ templates: [{ name: "A", body: "x" }, { name: "A", body: "x" }] });
  assert.notEqual(m.templates[0].id, m.templates[1].id);
});

test("migrate tolerates garbage input", () => {
  assert.equal(TL.migrate(null).templates.length, 0);
  assert.equal(TL.migrate({ templates: "nope" }).templates.length, 0);
  assert.equal(TL.migrate([]).templates.length, 0);
});

// --- Dynamic variables (plan step 10) ---
test("applyDynamicVars resolves date/time/datetime with injected clock", () => {
  const d = new Date(2026, 5, 20, 9, 5); // Jun 20 2026, 09:05 (month is 0-based)
  assert.equal(TL.applyDynamicVars("{{date}}", d), "2026-06-20");
  assert.equal(TL.applyDynamicVars("{{time}}", d), "09:05");
  assert.equal(TL.applyDynamicVars("{{datetime}}", d), "2026-06-20 09:05");
});

test("applyDynamicVars supports +/- day/week/month/year offsets", () => {
  const d = new Date(2026, 5, 20, 9, 5);
  assert.equal(TL.applyDynamicVars("{{date+3d}}", d), "2026-06-23");
  assert.equal(TL.applyDynamicVars("{{date-1w}}", d), "2026-06-13");
  assert.equal(TL.applyDynamicVars("{{date+1m}}", d), "2026-07-20");
  assert.equal(TL.applyDynamicVars("{{date+1y}}", d), "2027-06-20");
});

test("applyDynamicVars converts {{cursor}} to the sentinel", () => {
  const out = TL.applyDynamicVars("a{{cursor}}b");
  assert.equal(out, "a" + TL.CURSOR_TOKEN + "b");
});

// --- Field parsing (plan step 11) ---
test("parseFields reads pipe syntax and skips dynamic + duplicate names", () => {
  const f = TL.parseFields("Hi {{name|Customer|text|Guest}} pri {{p|Pri|dropdown||low,high}} on {{date}} {{name}}");
  assert.equal(f.length, 2);
  assert.equal(f[0].label, "Customer");
  assert.equal(f[0].def, "Guest");
  assert.equal(f[1].type, "dropdown");
  assert.deepEqual(f[1].options, ["low", "high"]);
});

test("parseFields remember flag respects secret-name opt-out", () => {
  assert.equal(TL.parseFields("{{email|E|text||  |remember}}")[0].remember, true);
  assert.equal(TL.parseFields("{{password|P|text||  |remember}}")[0].remember, false);
});

test("fillTemplate substitutes values, ignoring pipe metadata", () => {
  assert.equal(TL.fillTemplate("Hi {{name|Customer|text}}", { name: "Bob" }), "Hi Bob");
  assert.equal(TL.fillTemplate("{{a}}-{{b}}", { a: "1", b: "2" }), "1-2");
});

// --- Import validation summary + caps (plan steps 6/7) ---
test("validateTemplates reports accepted/rejected/truncated", () => {
  const v = TL.validateTemplates([
    { name: "ok", body: "hello" },
    { name: "bad" },                       // no body → rejected
    { body: "z".repeat(TL.LIMITS.MAX_BODY + 100) }, // truncated
  ]);
  assert.equal(v.accepted.length, 2);
  assert.equal(v.rejected, 1);
  assert.equal(v.truncated, 1);
  assert.equal(v.accepted[1].body.length, TL.LIMITS.MAX_BODY);
});

test("validateTemplates caps at MAX_TEMPLATES", () => {
  const many = Array.from({ length: TL.LIMITS.MAX_TEMPLATES + 50 }, (_, i) => ({ body: "b" + i }));
  assert.equal(TL.validateTemplates(many).accepted.length, TL.LIMITS.MAX_TEMPLATES);
});

// --- Backup ring (plan step 14) ---
test("ringPush keeps newest first and caps length", () => {
  let r = [];
  for (let i = 1; i <= 7; i++) r = TL.ringPush(r, i, 5);
  assert.deepEqual(r, [7, 6, 5, 4, 3]);
});

// --- Debounce flush/cancel (data-loss window fix) ---
test("debounce.flush runs the pending call immediately with the latest args", () => {
  let calls = [];
  const d = TL.debounce((x) => calls.push(x), 10_000);
  d("a"); d("b");
  assert.deepEqual(calls, []); // nothing fired yet
  d.flush();
  assert.deepEqual(calls, ["b"]); // latest args, fired synchronously
  d.flush();
  assert.deepEqual(calls, ["b"]); // idle flush is a no-op
});

test("debounce.cancel drops the pending call", () => {
  let calls = 0;
  const d = TL.debounce(() => calls++, 10_000);
  d();
  d.cancel();
  d.flush();
  assert.equal(calls, 0);
});

// --- Competitor adapters (plan step 16) ---
test("adaptTextBlaze maps snippets and converts {formtext} tokens", () => {
  const r = TL.detectAndAdapt([{ shortcut: "/hi", snippet: "Hello {formtext: name=Customer}" }]);
  assert.equal(r.source, "textblaze");
  assert.equal(r.items[0].shortcut, "hi");
  assert.equal(r.items[0].body, "Hello {{Customer}}");
});

test("adaptMagical maps expansions and keeps {{tokens}}", () => {
  const r = TL.detectAndAdapt({ expansions: [{ trigger: "-sig", expansion: "Best, {{me}}" }] });
  assert.equal(r.source, "magical");
  assert.equal(r.items[0].shortcut, "sig");
  assert.equal(r.items[0].body, "Best, {{me}}");
});

test("detectAndAdapt returns null for native YAZIT JSON", () => {
  assert.equal(TL.detectAndAdapt([{ name: "x", body: "native" }]), null);
});

// --- Fuzzy + search (plan step 17) ---
test("fuzzyScore matches subsequences and rejects non-matches", () => {
  assert.ok(TL.fuzzyScore("pw", "password") >= 0);
  assert.ok(TL.fuzzyScore("pas", "password") > TL.fuzzyScore("swd", "password"));
  assert.equal(TL.fuzzyScore("zzz", "password"), -1);
});

test("fuzzySearch ranks shortcut matches and limits results", () => {
  const tpls = [
    { id: "1", shortcut: "pass", name: "Password" },
    { id: "2", shortcut: "info", name: "Info" },
    { id: "3", shortcut: "para", name: "Paragraph" },
  ];
  const r = TL.fuzzySearch("pa", tpls, 8);
  assert.ok(r.length >= 2);
  assert.ok(["pass", "para"].includes(r[0].shortcut));
});

test("searchTemplates does full-text over name/shortcut/body/tags", () => {
  const tpls = [
    { id: "1", name: "Greeting", shortcut: "hi", body: "Hello", tags: ["welcome"] },
    { id: "2", name: "Bye", shortcut: "bye", body: "Goodbye", tags: [] },
  ];
  assert.equal(TL.searchTemplates("welcome", tpls).length, 1);
  assert.equal(TL.searchTemplates("good", tpls)[0].id, "2");
  assert.equal(TL.searchTemplates("", tpls).length, 2);
});

test("isSecretName flags credential-like field names", () => {
  for (const n of ["password", "otp", "cvv", "api_key", "secret", "pin", "token",
                   "iban", "credit_card", "card_number", "customer_ssn", "passport_no", "tc_kimlik"]) {
    assert.equal(TL.isSecretName(n), true, n);
  }
  for (const n of ["customer_name", "account_manager", "ticket", "company"]) {
    assert.equal(TL.isSecretName(n), false, n);
  }
});

// ============================================================
// Rich-text sanitizer (the trust boundary) — XSS corpus
// ============================================================
test("sanitizeHtml keeps the formatting allowlist", () => {
  assert.equal(TL.sanitizeHtml("<b>a</b><i>b</i><u>c</u><s>d</s>"), "<b>a</b><i>b</i><u>c</u><s>d</s>");
  assert.equal(TL.sanitizeHtml("<p>x</p><ul><li>a</li></ul>"), "<p>x</p><ul><li>a</li></ul>");
  assert.equal(TL.sanitizeHtml("line<br>break"), "line<br>break");
});

test("sanitizeHtml unwraps non-allowlisted formatting elements", () => {
  assert.equal(TL.sanitizeHtml("<div>x<span>y</span><font>z</font></div>"), "xyz");
  assert.equal(TL.sanitizeHtml("<h1>Title</h1>"), "Title");
});

test("sanitizeHtml removes dangerous elements with their subtree", () => {
  assert.equal(TL.sanitizeHtml("a<script>alert(1)</script>b"), "ab");
  assert.equal(TL.sanitizeHtml("a<style>* {}</style>b"), "ab");
  assert.equal(TL.sanitizeHtml("a<iframe src=x></iframe>b"), "ab");
  assert.equal(TL.sanitizeHtml("<object data=x></object>ok"), "ok");
});

test("sanitizeHtml: void kill-tags drop only themselves, keep trailing content", () => {
  // Regression: <base>/<meta>/<link>/<frame> are void; they must not swallow
  // everything after them in the DOM-free fallback.
  assert.equal(TL.sanitizeHtml("text<base href=x>more"), "textmore");
  assert.equal(TL.sanitizeHtml("a<meta charset=utf-8>b<link rel=x>c"), "abc");
  assert.equal(TL.sanitizeHtml("<b>x</b><base>after"), "<b>x</b>after");
});

test("sanitizeHtml drops all attributes including event handlers", () => {
  assert.equal(TL.sanitizeHtml('<b onclick="x" style="color:red" class="y" id="z">t</b>'), "<b>t</b>");
  assert.equal(TL.sanitizeHtml('<img src=x onerror=alert(1)>hi'), "hi");
});

test("sanitizeHtml neutralizes dangerous href schemes, keeps link text", () => {
  assert.equal(TL.sanitizeHtml('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(TL.sanitizeHtml('<a href="data:text/html,<script>">x</a>'), "<a>x</a>");
  assert.equal(TL.sanitizeHtml('<a href="vbscript:msgbox">x</a>'), "<a>x</a>");
  assert.equal(TL.sanitizeHtml('<a href="//evil.com">x</a>'), "<a>x</a>"); // scheme-relative
  assert.equal(TL.sanitizeHtml('<a href="java\tscript:x">y</a>'), "<a>y</a>"); // tab-split
});

test("sanitizeHtml keeps safe hrefs and forces rel", () => {
  const s = TL.sanitizeHtml('<a href="https://example.com">x</a>');
  assert.ok(s.includes('href="https://example.com"'));
  assert.ok(s.includes('rel="noopener noreferrer nofollow"'));
  assert.ok(TL.sanitizeHtml('<a href="mailto:a@b.com">m</a>').includes('href="mailto:a@b.com"'));
});

test("fillTemplate escape:true blocks markup injection at the HTML sink", () => {
  const out = TL.fillTemplate("Hi {{n}}", { n: '<img src=x onerror=alert(1)>' }, { escape: true });
  assert.ok(!out.includes("<img"));
  assert.equal(out, "Hi &lt;img src=x onerror=alert(1)&gt;");
  // and the full pipeline (fill->sanitize) yields no executable markup —
  // the payload survives only as inert, escaped text (no real <img> tag).
  const sanitized = TL.sanitizeHtml(out);
  assert.ok(!sanitized.includes("<img"));
});

test("htmlToPlainText degrades formatting readably and keeps the cursor sentinel", () => {
  assert.equal(TL.htmlToPlainText("<p>Hi</p><ul><li>a</li><li>b</li></ul>"), "Hi\n- a\n- b");
  assert.equal(TL.htmlToPlainText('<a href="https://x.com">site</a>'), "site (https://x.com)");
  assert.equal(TL.htmlToPlainText("x<br>y"), "x\ny");
  const withCursor = "a" + TL.CURSOR_TOKEN + "b";
  assert.ok(TL.htmlToPlainText("<b>" + withCursor + "</b>").includes(TL.CURSOR_TOKEN));
});

// ============================================================
// Field-builder serializer (plan: body-rewrite)
// ============================================================
test("buildFieldToken emits the minimal canonical token", () => {
  assert.equal(TL.buildFieldToken({ name: "city", type: "text", label: "city", def: "", options: [], remember: false }), "{{city}}");
  assert.equal(
    TL.buildFieldToken({ name: "p", label: "Priority", type: "dropdown", def: "", options: ["low", "high"], remember: false }),
    "{{p|Priority|dropdown||low,high}}"
  );
  assert.ok(TL.buildFieldToken({ name: "email", label: "email", type: "text", def: "", options: [], remember: true }).endsWith("|remember}}"));
  assert.ok(!TL.buildFieldToken({ name: "password", type: "text", remember: true, label: "password", def: "", options: [] }).includes("remember"));
});

test("buildFieldToken strips pipe/brace/comma metacharacters from values", () => {
  const tok = TL.buildFieldToken({ name: "x", label: "a|b}c{", type: "text", def: "p,q", options: [], remember: false });
  // The label/default metachars are gone; only the canonical pipe separators remain.
  assert.ok(tok.includes("abc"), tok);
  assert.ok(!tok.includes("a|b"), tok);
  assert.ok(!tok.includes("}c{"), tok);
  assert.ok(tok.includes("pq") && !tok.includes("p,q"), tok);
  // re-parses cleanly (no broken field)
  assert.equal(TL.parseFields(tok).length, 1);
});

test("parseFields(buildFieldToken(f)) is a stable round-trip for every field shape", () => {
  const bodies = [
    "{{name}}",
    "{{name|Customer}}",
    "{{when|Date|date}}",
    "{{note|Note|multiline|hi}}",
    "{{p|Pri|dropdown|low|low,med,high}}",
    "{{email|Email|text||x|remember}}",
  ];
  for (const body of bodies) {
    const f = TL.parseFields(body)[0];
    const reparsed = TL.parseFields(TL.buildFieldToken(f))[0];
    assert.deepEqual(reparsed, f, body);
  }
});

// ============================================================
// format flag threading
// ============================================================
test("migrate preserves format:html and omits it for plain templates", () => {
  const m = TL.migrate({ templates: [{ name: "h", body: "<b>x</b>", format: "html" }, { name: "p", body: "plain" }] });
  assert.equal(m.templates[0].format, "html");
  assert.equal("format" in m.templates[1], false);
});

test("validateTemplates re-sanitizes an imported html body", () => {
  const v = TL.validateTemplates([{ name: "evil", body: "<b>ok</b><script>alert(1)</script>", format: "html" }]);
  assert.equal(v.accepted[0].format, "html");
  assert.equal(v.accepted[0].body, "<b>ok</b>");
  assert.ok(!v.accepted[0].body.includes("script"));
});

// --- Regression: fuzzySearch false positive (v2.1.2) ---
test("fuzzySearch returns nothing when neither shortcut nor name matches", () => {
  const templates = [{ name: "Greeting", shortcut: "gr" }, { name: "Zebra", shortcut: "zz" }];
  assert.deepEqual(TL.fuzzySearch("qx", templates), []);
  // Shortcut weighting still works when it DOES match.
  const ranked = TL.fuzzySearch("gr", templates);
  assert.equal(ranked[0].name, "Greeting");
});

// --- Regression: month/year offset clamping (v2.1.2) ---
test("applyDynamicVars clamps month-end overflow instead of rolling over", () => {
  const jan31 = new Date(2026, 0, 31);
  assert.equal(TL.applyDynamicVars("{{date+1m}}", jan31), "2026-02-28");
  const may31 = new Date(2026, 4, 31);
  assert.equal(TL.applyDynamicVars("{{date+1m}}", may31), "2026-06-30");
  const leap = new Date(2024, 1, 29); // Feb 29 2024
  assert.equal(TL.applyDynamicVars("{{date+1y}}", leap), "2025-02-28");
  // Plain day arithmetic is unaffected.
  assert.equal(TL.applyDynamicVars("{{date+3d}}", jan31), "2026-02-03");
});

// --- Regression: import truncation keeps HTML well-formed (v2.1.2) ---
test("validateTemplates truncation of an html body stays well-formed", () => {
  // Build a body whose MAX_BODY cut lands inside a tag.
  const chunk = "<b>bold</b>";
  let body = chunk.repeat(Math.ceil((TL.LIMITS.MAX_BODY + 20) / chunk.length));
  const { accepted, truncated } = TL.validateTemplates([{ name: "big", body, format: "html" }]);
  assert.equal(truncated, 1);
  const out = accepted[0].body;
  // Well-formed sanitized HTML is a fixed point of the sanitizer.
  assert.equal(TL.sanitizeHtml(out), out);
});

// --- migrate clamps oversized bodies on read (v2.2.0) ---
test("migrate clamps body to MAX_BODY and repairs an html mid-tag cut", () => {
  const big = "x".repeat(TL.LIMITS.MAX_BODY + 5000);
  const m = TL.migrate({ templates: [{ name: "a", body: big }] });
  assert.equal(m.templates[0].body.length, TL.LIMITS.MAX_BODY);

  const chunk = "<b>bold</b>";
  const bigHtml = chunk.repeat(Math.ceil((TL.LIMITS.MAX_BODY + 20) / chunk.length));
  const mh = TL.migrate({ templates: [{ name: "h", body: bigHtml, format: "html" }] });
  const out = mh.templates[0].body;
  assert.equal(TL.sanitizeHtml(out), out); // well-formed fixed point
});

// --- mergeImport conflict strategies (v2.2.0) ---
test("mergeImport: keepboth / skip / overwrite (incl. format flag)", () => {
  const existing = [{ id: "1", name: "Old", shortcut: "hi", body: "old", format: "html" }];
  const incoming = [{ name: "New", shortcut: "HI", body: "new" }, { name: "Other", shortcut: "yo", body: "y" }];

  assert.equal(TL.mergeImport(existing, incoming, "keepboth").length, 3);

  const skipped = TL.mergeImport(existing, incoming, "skip");
  assert.equal(skipped.length, 2);
  assert.equal(skipped[0].body, "old"); // conflicting "hi" skipped

  const over = TL.mergeImport(existing, incoming, "overwrite");
  assert.equal(over.length, 2);
  assert.equal(over[0].body, "new");
  assert.equal(over[0].id, "1");            // identity preserved
  assert.equal("format" in over[0], false); // plain incoming clears the html flag
});

// --- isSystemUrl (v2.2.0) ---
test("isSystemUrl blocks system pages and store fronts, allows the web", () => {
  assert.equal(TL.isSystemUrl(undefined), true);
  assert.equal(TL.isSystemUrl("chrome://extensions"), true);
  assert.equal(TL.isSystemUrl("about:addons"), true);
  assert.equal(TL.isSystemUrl("https://chrome.google.com/webstore/detail/x"), true);
  assert.equal(TL.isSystemUrl("https://addons.mozilla.org/x"), true);
  assert.equal(TL.isSystemUrl("https://example.com"), false);
});

// --- searchTemplates haystack cache correctness (v2.2.0) ---
test("searchTemplates cache invalidates when a field is edited in place", () => {
  const t = { id: "1", name: "Alpha", shortcut: "", body: "hello world" };
  assert.equal(TL.searchTemplates("hello", [t]).length, 1);
  t.body = "goodbye"; // in-place edit assigns a new string → new reference
  assert.equal(TL.searchTemplates("hello", [t]).length, 0);
  assert.equal(TL.searchTemplates("goodbye", [t]).length, 1);
});

// ============================================================
// 2.4.0 — conditionals, flags, date formats, richer sanitizer
// ============================================================
test("parseFields: flags slot accepts remember,required in any order", () => {
  const a = TL.parseFields("{{t|Ticket|text|||required,remember}}")[0];
  assert.equal(a.required, true);
  assert.equal(a.remember, true);
  const b = TL.parseFields("{{t|Ticket|text|||REMEMBER , required}}")[0];
  assert.equal(b.required, true);
  assert.equal(b.remember, true);
  assert.equal(TL.parseFields("{{t}}")[0].required, false);
});

test("parseFields: checkbox type and implicit checkbox from {{#if}}", () => {
  const f = TL.parseFields("{{vip|VIP|checkbox|true}} {{#if urgent}}!{{/if}} {{#if vip}}x{{/if}}");
  assert.deepEqual(f.map((x) => [x.name, x.type]), [["vip", "checkbox"], ["urgent", "checkbox"]]);
  assert.equal(f[0].def, "true");
});

test("parseFields: {{else}} / {{/if}} / {{#if a=b}} never become fields", () => {
  const f = TL.parseFields("{{#if p=high}}A{{else}}B{{/if}} {{p|Pri|dropdown||low,high}}");
  assert.deepEqual(f.map((x) => x.name), ["p"]);
});

test("applyConditionals: truthiness, else branch, equality, nesting-free", () => {
  const tpl = "a{{#if vip}}V{{else}}S{{/if}}b {{#if p=High}}!{{/if}}{{#if p=low}}?{{/if}}";
  assert.equal(TL.applyConditionals(tpl, { vip: "true", p: "high" }), "aVb !");
  assert.equal(TL.applyConditionals(tpl, { vip: "", p: "low" }), "aSb ?");
  assert.equal(TL.applyConditionals(tpl, { vip: "false", p: "" }), "aSb ");
  assert.equal(TL.applyConditionals("{{#if x}}open", {}), "{{#if x}}open"); // unterminated → untouched
});

test("conditionals + fillTemplate: dropped branch leaks no placeholder", () => {
  const tpl = "{{#if resolved}}Closed {{ticket}}{{else}}Working on {{ticket}} ({{eta}}){{/if}}";
  const values = { resolved: "true", ticket: "INC1" };
  assert.equal(TL.fillTemplate(TL.applyConditionals(tpl, values), values), "Closed INC1");
});

test("date field: default resolution and format", () => {
  const now = new Date(2026, 0, 31);
  assert.equal(TL.resolveDateDefault("today", now), "2026-01-31");
  assert.equal(TL.resolveDateDefault("+3d", now), "2026-02-03");
  assert.equal(TL.resolveDateDefault("+1m", now), "2026-02-28");
  assert.equal(TL.resolveDateDefault("2026-05-05", now), "2026-05-05");
  assert.equal(TL.resolveDateDefault("garbage", now), "");
  assert.equal(TL.formatIsoDate("2026-02-03", "dd.MM.yyyy"), "03.02.2026");
  assert.equal(TL.formatIsoDate("2026-02-03", "d MMM yyyy"), "3 Feb 2026");
  assert.equal(TL.formatIsoDate("2026-02-03", "nope"), "2026-02-03"); // unknown → ISO
  const f = TL.parseFields("{{d|Due|date|+3d|dd.MM.yyyy}}")[0];
  assert.deepEqual(f.options, ["dd.MM.yyyy"]);
  assert.equal(TL.buildFieldToken(f), "{{d|Due|date|+3d|dd.MM.yyyy}}");
});

test("applyDynamicVars: |format on date/datetime, offsets still clamp", () => {
  const d = new Date(2026, 0, 31, 9, 5);
  assert.equal(TL.applyDynamicVars("{{date|dd.MM.yyyy}}", d), "31.01.2026");
  assert.equal(TL.applyDynamicVars("{{date+1m|dd.MM.yyyy}}", d), "28.02.2026");
  assert.equal(TL.applyDynamicVars("{{datetime|d MMM yyyy}}", d), "31 Jan 2026 09:05");
  assert.equal(TL.applyDynamicVars("{{date|bogus}}", d), "2026-01-31");
});

test("buildFieldToken round-trips checkbox, required and dropdown '*'", () => {
  for (const body of ["{{ok|OK|checkbox|true}}", "{{t|T|text|||required}}", "{{r|Reason|dropdown|Net|Net,HW,*|remember,required}}"]) {
    const f = TL.parseFields(body)[0];
    assert.deepEqual(TL.parseFields(TL.buildFieldToken(f))[0], f, body);
  }
});

test("sanitizeHtml: new allowlist (h2/h3/code/pre/table) and h1 still unwrapped", () => {
  assert.equal(TL.sanitizeHtml("<h2>T</h2><h3>S</h3><h1>no</h1>"), "<h2>T</h2><h3>S</h3>no");
  assert.equal(TL.sanitizeHtml("<pre>a  b</pre><code onclick=x>c</code>"), "<pre>a  b</pre><code>c</code>");
  assert.equal(
    TL.sanitizeHtml('<table border=1><thead><tr><th>h</th></tr></thead><tbody><tr><td style=x>1</td></tr></tbody></table>'),
    "<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>"
  );
});

test("htmlToPlainText: headings, tables and pre degrade readably", () => {
  assert.equal(TL.htmlToPlainText("<h2>T</h2><p>x</p>"), "T\n\nx");
  assert.equal(TL.htmlToPlainText("<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>"), "a | b\n1 | 2");
  assert.equal(TL.htmlToPlainText("<pre>x\ny</pre>z"), "x\ny\n\nz");
});

test("tidyHtml: removes Word/Outlook residue, idempotent", () => {
  const dirty = "<p>&nbsp;</p><p><b></b></p><br><p>a&nbsp;&nbsp;&nbsp;b</p><br><br><br><br><p>c</p><br>";
  const once = TL.tidyHtml(dirty);
  assert.equal(once, "<p>a b</p><br><br><p>c</p>");
  assert.equal(TL.tidyHtml(once), once);
  assert.equal(TL.tidyHtml(""), "");
});

// ============================================================
// 2.4.2 — review fixes
// ============================================================
test("setTemplates-style id dedupe: identical name+body never share an id", async () => {
  // Exercised through the storage mock: two identical templates in, unique ids out.
  const stored = {};
  globalThis.chrome = /** @type {any} */ ({
    storage: { local: {
      get: async () => ({}),
      set: async (obj) => { Object.assign(stored, obj); },
      remove: async () => {},
    } },
  });
  await TL.setTemplates([
    { name: "Test", body: "Hello" },
    { name: "Test", body: "Hello" },
    { name: "Test", body: "Hello" },
  ]);
  const ids = stored.templates.map((t) => t.id);
  assert.equal(new Set(ids).size, 3, ids.join(","));
  assert.ok(ids[1].endsWith("x") && ids[2].endsWith("xx"));
  delete globalThis.chrome;
});

test("lastValues: per-template keys only; save merges; clear removes the key", async () => {
  const store = { "lastValues:t_1": { name: "old" }, lastValues: { t_1: { name: "legacy" } } };
  globalThis.chrome = /** @type {any} */ ({
    storage: { local: {
      get: async (keys) => {
        const want = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(want.filter((k) => k in store).map((k) => [k, store[k]]));
      },
      set: async (obj) => { Object.assign(store, obj); },
      remove: async (k) => { delete store[k]; },
    } },
  });
  assert.deepEqual(await TL.getLastValues("t_1"), { name: "old" });
  assert.deepEqual(await TL.getLastValues("t_none"), {});   // legacy blob is NOT consulted
  // save writes ONLY the per-template key, merging with the current value
  await TL.saveLastValues("t_1", { city: "Bp" });
  assert.deepEqual(store["lastValues:t_1"], { name: "old", city: "Bp" });
  assert.deepEqual(store.lastValues, { t_1: { name: "legacy" } }); // untouched (migrateLastValues owns it)
  await TL.clearLastValues("t_1");
  assert.equal(store["lastValues:t_1"], undefined);
  delete globalThis.chrome;
});

test("migrateLastValues: blob → per-template keys once; per-key wins; blob removed", async () => {
  const store = {
    lastValues: { t_1: { name: "legacy" }, t_2: { city: "Bp" } },
    "lastValues:t_1": { name: "newer" }, // pre-existing per-key must not be overwritten
  };
  globalThis.chrome = /** @type {any} */ ({
    storage: { local: {
      get: async (keys) => {
        const want = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(want.filter((k) => k in store).map((k) => [k, store[k]]));
      },
      set: async (obj) => { Object.assign(store, obj); },
      remove: async (k) => { delete store[k]; },
    } },
  });
  await TL.migrateLastValues();
  assert.deepEqual(store["lastValues:t_1"], { name: "newer" });
  assert.deepEqual(store["lastValues:t_2"], { city: "Bp" });
  assert.equal(store.lastValues, undefined);
  await TL.migrateLastValues(); // idempotent on an already-clean store
  assert.deepEqual(store["lastValues:t_2"], { city: "Bp" });
  delete globalThis.chrome;
});

// ============================================================
// 2.5.1 — echo fingerprint, stale-frame recovery, lastValues GC
// ============================================================
test("normalizeTemplates matches what setTemplates writes (echo fingerprint source)", async () => {
  const stored = {};
  globalThis.chrome = /** @type {any} */ ({
    storage: { local: { get: async () => ({}), set: async (obj) => { Object.assign(stored, obj); }, remove: async () => {} } },
  });
  // In-memory drift the options page produces while typing:
  //  - a trailing hyphen the live-strip keeps (storage trims it)
  //  - `tags` added to a rich template AFTER `format` (storage orders tags first)
  const inMemory = [{ id: "t_a", order: 0, name: "A", shortcut: "pw-", body: "<b>x</b>", format: "html", tags: ["ops"] }];
  const written = await TL.setTemplates(inMemory);
  assert.equal(JSON.stringify(written), JSON.stringify(stored.templates));
  assert.equal(JSON.stringify(written), JSON.stringify(TL.normalizeTemplates(inMemory)));
  assert.notEqual(JSON.stringify(written), JSON.stringify(inMemory)); // the drift is real
  assert.equal(written[0].shortcut, "pw");
  assert.deepEqual(Object.keys(written[0]), ["id", "order", "name", "shortcut", "body", "tags", "format"]);
  delete globalThis.chrome;
});

test("SHORTCUT_STRIP_RE is global and stateless across reuse", () => {
  assert.equal("a b!c".replace(TL.SHORTCUT_STRIP_RE, ""), "abc");
  assert.equal("x-y_z".replace(TL.SHORTCUT_STRIP_RE, ""), "x-y_z");
  assert.equal(TL.slashRegex(), TL.slashRegex()); // shared non-global instance
  assert.equal(TL.slashRegex().exec("/a")[1], "a");
  assert.equal(TL.slashRegex().exec("/b")[1], "b");
});

test("pasteToTab: stale frame record → broadcast, no script injection", async () => {
  const calls = [];
  let session = { "focus:7": 42 };
  globalThis.chrome = /** @type {any} */ ({
    storage: { session: {
      get: async (k) => (k in session ? { [k]: session[k] } : {}),
      remove: async (k) => { delete session[k]; },
    } },
    tabs: { sendMessage: async (_tab, _msg, opts) => {
      calls.push(opts);
      if (opts.frameId === 42) throw new Error("no frame"); // frame navigated away
      return { ok: true };
    } },
    scripting: { executeScript: async () => { calls.push("inject"); } },
  });
  await TL.pasteToTab(7, /** @type {any} */ ({ id: "t", body: "" }), 0);
  assert.deepEqual(calls, [{ frameId: 42 }, {}]);
  assert.equal(session["focus:7"], undefined); // stale record dropped
  delete globalThis.chrome;
});

test("pasteToTab: no listener anywhere → inject once, then broadcast", async () => {
  const calls = [];
  let loaded = false;
  globalThis.chrome = /** @type {any} */ ({
    storage: { session: { get: async () => ({}), remove: async () => {} } },
    tabs: { sendMessage: async (_tab, _msg, opts) => {
      calls.push(opts);
      if (!loaded) throw new Error("no receiver");
      return { ok: true };
    } },
    scripting: { executeScript: async () => { loaded = true; calls.push("inject"); } },
  });
  await TL.pasteToTab(7, /** @type {any} */ ({ id: "t", body: "" }), 0);
  assert.deepEqual(calls, [{}, "inject", {}]);
  delete globalThis.chrome;
});

test("gcLastValues removes only orphaned per-template keys", async () => {
  const store = {
    templates: [], backups: [], uiLang: "auto",
    "lastValues:t_keep": { a: "1" }, "lastValues:t_gone": { b: "2" }, "lastValues:t_gone2": {},
  };
  globalThis.chrome = /** @type {any} */ ({
    storage: { local: {
      get: async (k) => (k === null ? { ...store } : {}),
      remove: async (keys) => { for (const k of keys) delete store[k]; },
    } },
  });
  await TL.gcLastValues(["t_keep"]);
  assert.deepEqual(Object.keys(store).sort(), ["backups", "lastValues:t_keep", "templates", "uiLang"]);
  await TL.gcLastValues(["t_keep"]); // idempotent
  assert.ok("lastValues:t_keep" in store);
  delete globalThis.chrome;
});

// ============================================================
// 2.5.2 — sanitizer backtracking, dual-path parity, context coverage
// ============================================================

// The DOM-free sanitizer's tag-attribute group used `[^>]`, which also matches
// a quote and therefore overlaps the `"..."` / `'...'` alternatives. An
// unterminated tag made the engine try every partition of the quote run —
// exponential. Chrome's MV3 service worker has no DOMParser ([Exposed=Window]),
// so this path is reachable outside the test suite.
test("sanitizeHtml (DOM-free path) does not backtrack exponentially", () => {
  const evil = '<a ' + '"'.repeat(40); // no ">" ever arrives
  const started = Date.now();
  TL.sanitizeHtml(evil);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 500, `sanitizeHtml took ${elapsed}ms on 40 quote chars`);
});

// A bare "<" matched none of the regex alternatives, so the DOM-free path
// silently DROPPED it while the DOM path escapes it. Since that path runs in
// the Chrome service worker — and migrate() can write its output back to
// storage — the difference is real data loss, not a test-only quirk.
test("sanitizeHtml (DOM-free path) escapes a bare '<' instead of dropping it", () => {
  assert.equal(TL.sanitizeHtml("a < b & c > d"), "a &lt; b &amp; c &gt; d");
  assert.equal(TL.sanitizeHtml("5 < 6"), "5 &lt; 6");
  assert.equal(TL.sanitizeHtml("<b>x</b> < <i>y</i>"), "<b>x</b> &lt; <i>y</i>");
});

// --- Both sanitizer paths are production paths ---
// Page contexts get the DOMParser path; the Chrome MV3 service worker has no
// DOMParser and gets the DOM-free one. Everything below therefore runs twice.

/** Inputs whose sanitized form the two paths must agree on character for character. */
const SANITIZER_CASES = [
  ["<b>a</b><i>b</i><u>c</u><s>d</s>", "<b>a</b><i>b</i><u>c</u><s>d</s>"],
  ["<p>x</p><ul><li>a</li></ul>", "<p>x</p><ul><li>a</li></ul>"],
  ["line<br>break", "line<br>break"],
  ["<div>x<span>y</span><font>z</font></div>", "xyz"],
  ["<h1>Title</h1>", "Title"],
  ["<h2>T</h2><h3>S</h3><h1>no</h1>", "<h2>T</h2><h3>S</h3>no"],
  ["a<script>alert(1)</script>b", "ab"],
  ["a<style>* {}</style>b", "ab"],
  ["a<iframe src=x></iframe>b", "ab"],
  ["<object data=x></object>ok", "ok"],
  ["text<base href=x>more", "textmore"],
  ["a<meta charset=utf-8>b<link rel=x>c", "abc"],
  ['<b onclick="x" style="color:red" class="y" id="z">t</b>', "<b>t</b>"],
  ["<img src=x onerror=alert(1)>hi", "hi"],
  ['<a href="javascript:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="data:text/html,<script>">x</a>', "<a>x</a>"],
  ['<a href="vbscript:msgbox">x</a>', "<a>x</a>"],
  ['<a href="//evil.com">x</a>', "<a>x</a>"],
  ['<a href="java\tscript:x">y</a>', "<a>y</a>"],
  ["a < b & c > d", "a &lt; b &amp; c &gt; d"],
  ["<pre>a  b</pre><code onclick=x>c</code>", "<pre>a  b</pre><code>c</code>"],
];

test("sanitizeHtml: the DOM (production) path meets the same expectations", () => {
  withDom(() => {
    for (const [input, expected] of SANITIZER_CASES) {
      assert.equal(TL.sanitizeHtml(input), expected, `DOM path: ${input}`);
    }
    // Safe hrefs survive and are hardened, on this path too.
    const link = TL.sanitizeHtml('<a href="https://example.com">x</a>');
    assert.ok(link.includes('href="https://example.com"'));
    assert.ok(link.includes('rel="noopener noreferrer nofollow"'));
  });
});

test("sanitizeHtml: both paths agree character for character on these inputs", () => {
  for (const [input] of SANITIZER_CASES) {
    const domFree = TL.sanitizeHtml(input);
    const dom = withDom(() => TL.sanitizeHtml(input));
    assert.equal(dom, domFree, `paths disagree on: ${input}`);
  }
});

// Structure may legitimately differ between the paths (an HTML tree builder
// re-parents an orphan <td>; a regex cannot). The SECURITY properties may not.
test("sanitizeHtml: both paths hold the allowlist invariants on hostile input", () => {
  const hostile = [
    "<svg><desc><b>x</b></desc></svg>tail",
    "<math><mtext><script>alert(1)</script></mtext></math>",
    "<form><input name=x><b>y</b></form>",
    "<template><script>alert(1)</script></template>t",
    "<noscript><b>x</b></noscript>y",
    "<td>orphan</td>",
    "<tr><td>orphan row</td></tr>",
    "<ul><li>1<li>2</ul>",
    "<table><tr><td>a<td>b</table>",
    "<p>a<div>b</div>c</p>",
    "<b>bold<i>both</b>italic</i>",
    "<frameset><frame src=x></frameset>tail",
    "<!-- <script>alert(1)</script> -->ok",
    "<b><!--c-->t</b>",
    '<p title="<b>">x</p>',
    "<b>unclosed",
    "</b>stray",
    '<a href=" javascript:alert(1)">x</a>',
    '<a href="jav&#x61;script:alert(1)">x</a>',
    '<a href="">empty</a>',
    "<title>t</title>body",
    "<b>a</b\n>b",
    "<xmp><script>alert(1)</script></xmp>",
    "<plaintext><script>alert(1)</script>",
  ];
  const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  const check = (out, label) => {
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(out)) !== null) {
      const tag = m[1].toLowerCase();
      assert.ok(TL.ALLOWED_TAGS.has(tag), `${label}: non-allowlisted <${tag}> in ${out}`);
      const attrs = m[2].trim();
      if (attrs) {
        assert.ok(
          /^href="[^"]*" rel="noopener noreferrer nofollow"$/.test(attrs),
          `${label}: unexpected attributes ${JSON.stringify(attrs)} in ${out}`
        );
        const href = /href="([^"]*)"/.exec(attrs)[1];
        assert.ok(
          /^(https?:|mailto:|tel:)/i.test(href),
          `${label}: unsafe protocol ${JSON.stringify(href)}`
        );
      }
    }
    assert.ok(!/on[a-z]+\s*=/i.test(out), `${label}: event handler survived in ${out}`);
    assert.ok(!/<script|<iframe|javascript:/i.test(out), `${label}: dangerous token in ${out}`);
  };
  for (const input of hostile) {
    check(TL.sanitizeHtml(input), `DOM-free "${input}"`);
    check(withDom(() => TL.sanitizeHtml(input)), `DOM "${input}"`);
  }
});

// --- Secret-name detection: language coverage + token boundaries ---
// The extension ships a Turkish locale and its Turkish first-run template is
// literally shortcut "sifre" (background.js), yet SECRET_RE only ever knew
// English stems. A Turkish user writing {{sifre|Şifre|text|||remember}} got the
// password written to chrome.storage.local in the clear — the exact opposite of
// what README promises. Separately, the un-anchored stems made "shipping",
// "passenger" and "bypass" look like secrets.
test("isSecretName covers Turkish credential words", () => {
  for (const n of ["sifre", "şifre", "Şifre", "parola", "kart_no", "kartNo", "kredi_karti",
                   "kredi kartı", "pasaport", "kimlik_no", "tc_kimlik_no", "guvenlik_kodu",
                   "güvenlik kodu", "dogrulama_kodu", "doğrulama kodu", "sms_kod", "gizli_anahtar"]) {
    assert.equal(TL.isSecretName(n), true, n);
  }
});

test("isSecretName covers the English credential words it was missing", () => {
  for (const n of ["pwd", "2fa", "mfa", "totp", "seed", "mnemonic", "recovery_phrase",
                   "private_key", "privateKey", "security_code", "cvn", "bearer_token",
                   "session_id", "cookie"]) {
    assert.equal(TL.isSecretName(n), true, n);
  }
});

test("isSecretName matches whole tokens, not substrings", () => {
  for (const n of ["shipping", "shipping_address", "passenger", "passenger_name", "compass",
                   "bypass", "spinner", "pinned", "kampanya"]) {
    assert.equal(TL.isSecretName(n), false, n);
  }
});

// Widening isSecretName only stops FUTURE writes. Values a Turkish user
// already had remembered under the old, English-only rule are still sitting in
// chrome.storage.local in the clear, so the update has to sweep them out.
test("saveLastValues refuses to store a secret-named value", async () => {
  const store = {};
  globalThis.chrome = /** @type {any} */ ({
    storage: { local: {
      get: async (k) => (store[k] ? { [k]: store[k] } : {}),
      set: async (obj) => { Object.assign(store, obj); },
    } },
  });
  await TL.saveLastValues("t_1", { sifre: "hunter2", sehir: "Ankara" });
  assert.deepEqual(store["lastValues:t_1"], { sehir: "Ankara" });

  await TL.saveLastValues("t_2", { parola: "x", api_key: "y" }); // all secret
  assert.equal("lastValues:t_2" in store, false);
  delete globalThis.chrome;
});

test("purgeSecretLastValues sweeps already-stored secrets, keeps the rest", async () => {
  const store = {
    templates: [], uiLang: "auto",
    "lastValues:t_1": { sifre: "hunter2", sehir: "Ankara" },
    "lastValues:t_2": { parola: "x", kart_no: "4111" }, // nothing left afterwards
    "lastValues:t_3": { sehir: "İzmir" },               // untouched
  };
  const removed = [];
  globalThis.chrome = /** @type {any} */ ({
    storage: { local: {
      get: async (k) => (k === null ? { ...store } : {}),
      set: async (obj) => { Object.assign(store, obj); },
      remove: async (keys) => { for (const k of [].concat(keys)) { removed.push(k); delete store[k]; } },
    } },
  });
  await TL.purgeSecretLastValues();
  assert.deepEqual(store["lastValues:t_1"], { sehir: "Ankara" });
  assert.equal("lastValues:t_2" in store, false, "an all-secret record is removed outright");
  assert.deepEqual(store["lastValues:t_3"], { sehir: "İzmir" });
  assert.deepEqual(store.templates, []); // other store keys untouched

  const before = JSON.stringify(store);
  await TL.purgeSecretLastValues(); // idempotent
  assert.equal(JSON.stringify(store), before);
  delete globalThis.chrome;
});

// --- Every context must load the files that define the TL members it uses ---
// TL is a global assembled by script order, not an import graph, so nothing
// but this test stops a context from calling a member its file list never
// defines. It reads the real configs (manifest, the two HTML pages, build.py,
// the executeScript list) so it cannot drift from them.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/** Drop comments so a `// see TL.foo` note is not mistaken for a call. */
function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      if (c === "\\") { out += c + (next ?? ""); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && next === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && next === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

const definedBy = (file) =>
  [...stripComments(read(file)).matchAll(/\bTL\.([A-Za-z0-9_]+)\s*=[^=]/g)].map((m) => m[1]);
const usedBy = (file) =>
  [...stripComments(read(file)).matchAll(/\bTL\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);

/** Script srcs of an extension HTML page, in load order. */
const pageScripts = (file) =>
  [...read(file).matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);

test("every context loads the files defining the TL members it uses", () => {
  const manifest = JSON.parse(read("manifest.json"));

  // Chrome loads background.js as a service worker and it pulls common.js in
  // itself; Firefox gets an explicit background.scripts list from build.py.
  const importScriptsFiles = [...stripComments(read("background.js"))
    .matchAll(/importScripts\(([^)]*)\)/g)]
    .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((a) => a[1]));
  const firefoxBackground = JSON.parse(
    /"scripts": (\[[^\]]*\])/.exec(read("build.py"))[1].replace(/'/g, '"')
  );
  // The re-injection fallback (pasteToTab) must ship the same file list as the
  // manifest; it lives in whichever half of common currently holds pasteToTab.
  const injectSource = ["common.js", "common-ui.js"]
    .map(read)
    .map(stripComments)
    .find((s) => /executeScript\(/.test(s));
  const injectFiles = JSON.parse(/files: (\[[^\]]*\])/.exec(injectSource)[1]);

  const contexts = {
    "content script": [...manifest.content_scripts[0].js],
    "content script (executeScript re-injection)": injectFiles,
    "background (chrome service worker)": [...importScriptsFiles, "background.js"],
    "background (firefox)": [...firefoxBackground, "background.js"],
    popup: pageScripts("popup.html"),
    options: pageScripts("options.html"),
  };

  for (const [label, files] of Object.entries(contexts)) {
    const available = new Set(files.flatMap(definedBy));
    const missing = [...new Set(files.flatMap(usedBy))].filter((m) => !available.has(m));
    assert.deepEqual(missing, [], `${label} loads ${files.join(" + ")} but uses undefined TL.${missing.join(", TL.")}`);
  }

  // The manifest's content-script list and the injection fallback must agree,
  // or a re-injected frame would get a different TL than a natural load.
  assert.deepEqual(injectFiles, manifest.content_scripts[0].js);
});

// Both extension pages left <html> with no lang attribute, and the options
// page has a language switcher — so a screen reader announced Turkish UI with
// an English voice. Setting it needs the RESOLVED locale ("auto" -> tr/en),
// and loadLocale is the only place that resolution lives; duplicating it in
// the pages would give it a second source of truth.
test("loadLocale returns the locale it resolved to", async () => {
  globalThis.chrome = /** @type {any} */ ({
    i18n: { getUILanguage: () => "tr-TR" },
    runtime: { getURL: (p) => "file:///" + p },
  });
  assert.equal(await TL.loadLocale("en"), "en");
  assert.equal(await TL.loadLocale("tr"), "tr");
  assert.equal(await TL.loadLocale("auto"), "tr", "auto follows the browser UI language");

  globalThis.chrome.i18n.getUILanguage = () => "de-DE";
  assert.equal(await TL.loadLocale("auto"), "en", "unsupported UI language falls back to en");
  delete globalThis.chrome;
});

// manifest.json is the version source of truth. THREE other files carry their
// own copy that nothing derives from it — package.json, the README badge and
// the docs landing page — and they drifted silently until a release. Each copy
// is pinned here, so a bump that misses one fails before it ships.
// (CHANGELOG.md is deliberately absent: its newest heading is [Unreleased]
// until the release commit, so pinning it would fail on every bump.)
test("every declared version matches manifest.json", () => {
  const version = JSON.parse(read("manifest.json")).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);

  assert.equal(JSON.parse(read("package.json")).version, version, "package.json");

  // README badge — shields.io encodes it as .../badge/version-<v>-<colour>
  const badge = /img\.shields\.io\/badge\/version-([\d.]+)-/.exec(read("README.md"));
  assert.ok(badge, "README.md carries no version badge to check");
  assert.equal(badge[1], version, "README.md badge");

  // docs landing page — first chip of the badge strip: <span>v2.6.0</span>
  const chip = /<span>v([\d.]+)<\/span>/.exec(read("docs/index.html"));
  assert.ok(chip, "docs/index.html carries no version chip to check");
  assert.equal(chip[1], version, "docs/index.html chip");
});

// --- Folders & favorites (schema v4) ---
test("migrate v3 → v4 is a no-op on data and carries folderId/favorite", () => {
  const v3 = { schemaVersion: 3, templates: [{ id: "t_1", order: 0, name: "A", shortcut: "", body: "x" }] };
  const m = TL.migrate(v3);
  assert.equal(m.schemaVersion, 4);
  assert.deepEqual(Object.keys(m.templates[0]), ["id", "order", "name", "shortcut", "body"]);
  assert.equal("folders" in m, false); // absent stays absent

  const v4 = TL.migrate({ templates: [{ id: "t_2", name: "B", body: "y", folderId: "f_a", favorite: true }] });
  assert.equal(v4.templates[0].folderId, "f_a");
  assert.equal(v4.templates[0].favorite, true);
  const falsy = TL.normalizeTemplates([{ name: "C", body: "z", folderId: "", favorite: false }])[0];
  assert.equal("folderId" in falsy, false); // only meaningful values serialize
  assert.equal("favorite" in falsy, false);
});

test("normalizeFolders drops junk, dedupes ids, sorts and restamps order", () => {
  const out = TL.normalizeFolders([
    { id: "f_b", name: "  Work   stuff ", order: 5 },
    { id: "f_a", name: "Code", order: 1 },
    { id: "f_a", name: "Dup", order: 2 },
    { id: "f_c", name: "   ", order: 0 },
    null, "x",
  ]);
  assert.deepEqual(out, [
    { id: "f_a", name: "Code", order: 0 },
    { id: "f_b", name: "Work stuff", order: 1 },
  ]);
  assert.deepEqual(TL.normalizeFolders(undefined), []);
});

test("folderOf treats a dangling folderId as uncategorized", () => {
  const ids = new Set(["f_a"]);
  assert.equal(TL.folderOf({ folderId: "f_a" }, ids), "f_a");
  assert.equal(TL.folderOf({ folderId: "f_gone" }, ids), "");
  assert.equal(TL.folderOf({}, ids), "");
});

test("export/import round-trip maps folders by name, not id", () => {
  const folders = [{ id: "f_a", name: "Work", order: 0 }];
  const exported = TL.toExportable(
    [{ id: "t_1", order: 0, name: "A", shortcut: "", body: "x", folderId: "f_a", favorite: true },
     { id: "t_2", order: 1, name: "B", shortcut: "", body: "y", folderId: "f_gone" }],
    folders,
  );
  assert.equal(exported[0].folder, "Work");
  assert.equal("folderId" in exported[0], false);
  assert.equal("folder" in exported[1], false); // dangling id → no folder in the file

  const { accepted } = TL.validateTemplates([...exported, { name: "C", body: "z", folder: "Personal" }]);
  assert.equal(accepted[0].folder, "Work");
  assert.equal(accepted[0].favorite, true);

  // Merge on another machine: "work" matches case-insensitively, "Personal" is created.
  let n = 0;
  const other = [{ id: "f_x", name: "work", order: 0 }];
  const r = TL.resolveImportFolders(accepted, other, "merge", () => "f_new" + n++);
  assert.equal(r.templates[0].folderId, "f_x");
  assert.equal("folder" in r.templates[0], false);
  assert.equal("folderId" in r.templates[1], false);
  assert.equal(r.templates[2].folderId, "f_new0");
  assert.deepEqual(r.folders.map((f) => f.name), ["work", "Personal"]);

  // Replace: folders rebuilt from the file only.
  const rr = TL.resolveImportFolders(accepted, other, "replace", () => "f_r" + n++);
  assert.deepEqual(rr.folders.map((f) => f.name), ["Work", "Personal"]);
});

test("mergeImport overwrite keeps local grouping unless the file sets it", () => {
  const existing = [{ id: "t_1", name: "A", shortcut: "a", body: "x", folderId: "f_a", favorite: true }];
  const kept = TL.mergeImport(existing, [{ name: "A2", shortcut: "a", body: "y" }], "overwrite");
  assert.equal(kept[0].folderId, "f_a");
  assert.equal(kept[0].favorite, true);
  const moved = TL.mergeImport(existing, [{ name: "A2", shortcut: "a", body: "y", folderId: "f_b" }], "overwrite");
  assert.equal(moved[0].folderId, "f_b");
});

test("fuzzySearch breaks score ties in favour of favorites", () => {
  const list = [
    { id: "1", name: "report", shortcut: "" },
    { id: "2", name: "report", shortcut: "", favorite: true },
  ];
  assert.equal(TL.fuzzySearch("rep", list)[0].id, "2");
});

// --- Theme setting (uiTheme: auto | light | dark) ---
const vm = require("node:vm");

/**
 * Run theme.js in a sandbox shaped like an extension page: a <html> element
 * with a dataset, a sync localStorage mirror, matchMedia, and a chrome.storage
 * whose get() resolves to `stored`. Returns handles to drive and observe it.
 */
function runThemeBootstrap({ mirror = null, stored = undefined, osDark = false } = {}) {
  const root = { dataset: /** @type {Record<string,string>} */ ({}) };
  const ls = new Map(mirror == null ? [] : [["yazit.uiTheme", mirror]]);
  const mqListeners = [];
  const mq = { matches: osDark, addEventListener: (_, fn) => mqListeners.push(fn) };
  const changeListeners = [];
  let resolveGet;
  const got = new Promise((r) => { resolveGet = r; });
  const sandbox = {
    document: { documentElement: root },
    window: { matchMedia: () => mq },
    localStorage: { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)) },
    chrome: { storage: {
      local: { get: () => got },
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    } },
  };
  vm.runInNewContext(read("theme.js"), sandbox);
  return {
    root, ls, mq,
    /** let the async storage.local.get land */
    settle: async () => { resolveGet(stored === undefined ? {} : { uiTheme: stored }); await got; await null; },
    osFlip: (dark) => { mq.matches = dark; mqListeners.forEach((fn) => fn()); },
    change: (v) => changeListeners.forEach((fn) => fn({ uiTheme: { newValue: v } }, "local")),
  };
}

test("normalizeTheme: only light/dark survive, everything else is auto", () => {
  for (const [input, want] of [["light", "light"], ["dark", "dark"], ["auto", "auto"],
    [undefined, "auto"], [null, "auto"], ["", "auto"], ["Dark", "auto"], ["sepia", "auto"], [1, "auto"]]) {
    assert.equal(TL.normalizeTheme(input), want, `normalizeTheme(${JSON.stringify(input)})`);
  }
});

test("theme.js normalises exactly like TL.normalizeTheme (it carries a copy)", async () => {
  for (const v of ["light", "dark", "auto", undefined, null, "", "Dark", "sepia", 1]) {
    const h = runThemeBootstrap({ stored: v });
    await h.settle();
    assert.equal(h.ls.get("yazit.uiTheme"), TL.normalizeTheme(v), `stored ${JSON.stringify(v)}`);
  }
});

test("theme.js: data-theme is always the RESOLVED theme, set before storage answers", async () => {
  // First paint comes from the sync mirror, not the async store.
  const h = runThemeBootstrap({ mirror: "dark", stored: "dark", osDark: false });
  assert.equal(h.root.dataset.theme, "dark", "mirror applied synchronously");
  await h.settle();
  assert.equal(h.root.dataset.theme, "dark");

  // auto follows the OS, live.
  const a = runThemeBootstrap({ stored: "auto", osDark: true });
  assert.equal(a.root.dataset.theme, "dark", "no mirror → auto → OS dark");
  await a.settle();
  a.osFlip(false);
  assert.equal(a.root.dataset.theme, "light");

  // An explicit choice ignores the OS.
  const l = runThemeBootstrap({ stored: "light", osDark: true });
  await l.settle();
  assert.equal(l.root.dataset.theme, "light");
  l.osFlip(true);
  assert.equal(l.root.dataset.theme, "light");

  // A stale mirror is corrected by the store, and changes from another page apply.
  const s = runThemeBootstrap({ mirror: "light", stored: "dark" });
  assert.equal(s.root.dataset.theme, "light");
  await s.settle();
  assert.equal(s.root.dataset.theme, "dark");
  assert.equal(s.ls.get("yazit.uiTheme"), "dark");
  s.change("light");
  assert.equal(s.root.dataset.theme, "light");
  s.change(undefined); // key removed → auto
  assert.equal(s.ls.get("yazit.uiTheme"), "auto");
});

test("extension pages load theme.js in <head>, before the stylesheet", () => {
  for (const page of ["popup.html", "options.html"]) {
    const html = read(page);
    const head = html.slice(0, html.indexOf("</head>"));
    const at = head.indexOf('<script src="theme.js"></script>');
    assert.ok(at >= 0, `${page}: theme.js must be in <head> (first paint)`);
    assert.ok(at < head.indexOf("<style>"), `${page}: theme.js must precede <style>`);
    // One mechanism: the pages switch on [data-theme], never on the media
    // query (that would ignore an explicit Light/Dark choice).
    assert.doesNotMatch(html, /@media\s*\(prefers-color-scheme/, `${page}: use :root[data-theme="dark"]`);
  }
  assert.doesNotMatch(read("content.js").split("const THEME_CSS")[1].split("`;")[0],
    /@media\s*\(prefers-color-scheme/, "in-page CSS switches on :host([data-yazit-theme])");
});

// Every surface that animates must answer the OS "reduce motion" setting, and
// each one has its own stylesheet — the two pages plus the CSS content.js
// injects into the host page. A new animation in any of them is easy to add
// without thinking about this, which is exactly what the check is for.
test("every animated surface honours prefers-reduced-motion", () => {
  for (const page of ["popup.html", "options.html"]) {
    assert.match(read(page), /@media\s*\(prefers-reduced-motion:\s*reduce\)/, page);
  }
  const inPageCss = read("content.js").split("const THEME_CSS")[1].split("`;")[0];
  assert.match(inPageCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, "content.js THEME_CSS");
  // A CSS media query cannot reach an explicit behaviour passed to
  // scrollTo/scrollIntoView, so options.js has to read the preference itself.
  // Checked at the CALL SITES, not over the whole file: scrollBehavior()'s own
  // ternary and the comment above it both spell the literal out.
  const calls = [...read("options.js").matchAll(/\.(?:scrollTo|scrollIntoView)\(\{([^}]*)\}\)/g)];
  assert.ok(calls.length >= 3, "expected to find the page's viewport scrolls");
  for (const [, args] of calls) {
    if (!/behavior:/.test(args)) continue; // no behaviour given = instant, fine
    assert.match(args, /behavior:\s*scrollBehavior\(\)/,
      `options.js: route this scroll through scrollBehavior() — {${args}}`);
  }
});

// The popup shipped without one: manifest.action.default_title is the toolbar
// tooltip, so a screen reader had nothing to announce when the popup opened.
test("both extension pages carry a localisable document title", () => {
  for (const page of ["popup.html", "options.html"]) {
    assert.match(read(page), /<title id="page-title">/, `${page}: needs <title id="page-title">`);
  }
  for (const script of ["popup.js", "options.js"]) {
    assert.match(read(script), /page-title/, `${script}: must fill the title from the locale`);
  }
});

// --- Condition builder + {{#if}} lint (settings page) ---
test("checkConditionals: sound bodies pass, each structural problem is named", () => {
  for (const ok of ["", "plain", "a {{#if x}}b{{/if}}", "{{#if x}}1{{else}}2{{/if}}{{ #if p=high }}y{{ /if }}",
    "<p>{{#if a}}x</p><p>y{{/if}}</p>", "{{name}} {{date+3d}}"]) {
    assert.equal(TL.checkConditionals(ok), null, ok);
  }
  assert.deepEqual(TL.checkConditionals("{{#if vip}}text"), { code: "unclosed", name: "vip" });
  assert.deepEqual(TL.checkConditionals("{{#if a}}{{#if b}}x{{/if}}{{/if}}"), { code: "nested", name: "b" });
  assert.deepEqual(TL.checkConditionals("x{{else}}y"), { code: "strayElse" });
  assert.deepEqual(TL.checkConditionals("x{{/if}}"), { code: "strayClose" });
  assert.deepEqual(TL.checkConditionals("{{#if a}}1{{else}}2{{else}}3{{/if}}"), { code: "doubleElse", name: "a" });
  assert.deepEqual(TL.checkConditionals("{{#if }}x{{/if}}"), { code: "noName" });
  assert.deepEqual(TL.checkConditionals("{{#if a=1}}x{{/if}}{{#if b"), null, "an unfinished {{ is not a marker");
});

test("checkConditionals flags exactly what applyConditionals would leak", () => {
  // The lint's promise: null ⇔ no raw control marker survives resolution.
  // Try both branches of every flag — a double {{else}} only leaks when false.
  const MARK = /\{\{\s*(#if\b|else\s*\}\}|\/if\s*\}\})/i;
  const leaks = (body) => [{ a: "true", b: "true" }, { a: "", b: "" }, { a: "true", b: "" }]
    .some((v) => MARK.test(TL.applyConditionals(body, v)));
  for (const body of ["{{#if a}}x{{/if}}", "{{#if a}}x{{else}}y{{/if}} {{#if b}}z{{/if}}",
    "{{#if a}}x", "x{{/if}}", "x{{else}}", "{{#if a}}{{#if b}}x{{/if}}{{/if}}", "{{#if a}}1{{else}}2{{else}}3{{/if}}"]) {
    assert.equal(TL.checkConditionals(body) !== null, leaks(body), body);
  }
});

test("buildCondition writes markers the parser accepts, and round-trips", () => {
  assert.equal(TL.buildCondition({ name: "" }), null);
  assert.equal(TL.buildCondition({ name: " {}|= " }), null);
  const c = TL.buildCondition({ name: " order  no ", equals: " high " });
  assert.deepEqual(c, { open: "{{#if order no=high}}", otherwise: "{{else}}", close: "{{/if}}" });
  // Characters that would break the marker are dropped, not escaped.
  assert.equal(TL.buildCondition({ name: "a{b}=c|d", equals: "x|y}" }).open, "{{#if abcd=xy}}");

  const truthy = TL.buildCondition({ name: "vip" });
  const body = "Hi. " + truthy.open + "Priority." + truthy.otherwise + "Normal." + truthy.close;
  assert.equal(TL.checkConditionals(body), null);
  assert.deepEqual(TL.parseFields(body).map((f) => [f.name, f.type]), [["vip", "checkbox"]]);
  assert.equal(TL.applyConditionals(body, { vip: "true" }), "Hi. Priority.");
  assert.equal(TL.applyConditionals(body, { vip: "false" }), "Hi. Normal.");

  const eq = TL.buildCondition({ name: "priority", equals: "High" });
  const b2 = eq.open + "Escalated." + eq.close;
  assert.equal(TL.applyConditionals(b2, { priority: "high" }), "Escalated.", "case-insensitive compare");
  assert.equal(TL.applyConditionals(b2, { priority: "low" }), "");
});

test("every condWarn_* code has an EN and a TR message", () => {
  const en = JSON.parse(read("_locales/en/messages.json"));
  const tr = JSON.parse(read("_locales/tr/messages.json"));
  for (const code of ["unclosed", "nested", "strayElse", "strayClose", "doubleElse", "noName"]) {
    assert.ok(en["condWarn_" + code], "en condWarn_" + code);
    assert.ok(tr["condWarn_" + code], "tr condWarn_" + code);
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(tr).sort(), "EN and TR locales carry the same keys");
});

// --- Placeholder colours ---
test("tokenKind sorts tokens the way parseFields does", () => {
  assert.deepEqual(TL.tokenKind("customer|Customer name"), { kind: "field", name: "customer" });
  assert.deepEqual(TL.tokenKind(" #if vip "), { kind: "control", name: "vip" });
  assert.deepEqual(TL.tokenKind("#if priority=high"), { kind: "control", name: "priority" });
  assert.deepEqual(TL.tokenKind("else"), { kind: "control", name: "" });
  assert.deepEqual(TL.tokenKind("/if"), { kind: "control", name: "" });
  for (const d of ["date", "date+3d", "date|dd.MM.yyyy", "time", "datetime", "cursor"]) {
    assert.equal(TL.tokenKind(d).kind, "dynamic", d);
  }
  // Every field parseFields reports is a "field" or an #if name — never dynamic.
  const body = "{{a}} {{b|B|dropdown||x,y}} {{date}} {{#if c}}1{{/if}} {{cursor}}";
  const kinds = new Map([...body.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => [TL.tokenKind(m[1]).name, TL.tokenKind(m[1]).kind]));
  for (const f of TL.parseFields(body)) assert.ok(["field", "control"].includes(kinds.get(f.name)), f.name);
});

test("placeholderSlots: distinct within a template, stable per name across templates", () => {
  const body = "{{customer}} {{ticket}} {{site}} {{engineer}} {{#if outage}}x{{/if}} {{customer|again}} {{date}}";
  const slots = TL.placeholderSlots(body);
  assert.deepEqual([...slots.keys()], ["customer", "ticket", "site", "engineer", "outage"]);
  assert.equal(new Set(slots.values()).size, slots.size, "no two fields share a colour");
  for (const v of slots.values()) assert.ok(v >= 0 && v < TL.PH_SLOTS);
  // Alone, a name gets its hash slot — the same one in every template.
  const alone = TL.placeholderSlots("{{customer}}").get("customer");
  assert.equal(TL.placeholderSlots("Hi {{customer|Name}}!").get("customer"), alone);
  // More fields than colours: still a slot each, nothing throws.
  const many = TL.placeholderSlots([...Array(12)].map((_, k) => "{{f" + k + "}}").join(" "));
  assert.equal(many.size, 12);
  assert.equal(new Set([...many.values()].slice(0, TL.PH_SLOTS)).size, TL.PH_SLOTS, "first 8 fill every slot");
});

test("placeholderKey: fields by slot, markers and dynamic vars by kind", () => {
  const slots = TL.placeholderSlots("{{a}}{{b}}");
  assert.equal(TL.placeholderKey("a", slots), String(slots.get("a")));
  assert.equal(TL.placeholderKey("b|Label", slots), String(slots.get("b")));
  assert.equal(TL.placeholderKey("#if a", slots), "ctl");
  assert.equal(TL.placeholderKey("/if", slots), "ctl");
  assert.equal(TL.placeholderKey("date+1w", slots), "dyn");
  assert.match(TL.placeholderKey("unknown", slots), /^[0-7]$/);
});

test("options.html defines a light and a dark colour for every placeholder key", () => {
  const html = read("options.html");
  const keys = [...Array(TL.PH_SLOTS).keys()].map(String).concat(["ctl", "dyn"]);
  for (const k of keys) {
    assert.ok(html.includes(`::highlight(tl-ph-${k}) {`), `light ::highlight tl-ph-${k}`);
    assert.ok(html.includes(`:root[data-theme="dark"] ::highlight(tl-ph-${k})`), `dark ::highlight tl-ph-${k}`);
    assert.equal((html.match(new RegExp(`--ph-${k}-bg:`, "g")) || []).length, 2, `--ph-${k}-bg in both palettes`);
    assert.ok(html.includes(`.ph-backdrop mark.ph-${k} {`), `mark.ph-${k}`);
  }
});

test("plain-editor mirror matches the textarea's text metrics", () => {
  // The mirror only lines up if both boxes lay text out identically.
  const html = read("options.html");
  const rule = (sel) => {
    const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}").exec(html);
    assert.ok(m, sel);
    return m[1];
  };
  const ta = rule("    textarea") + rule(".ph-wrap textarea") + rule("input, textarea, select");
  const bd = rule(".ph-backdrop");
  const pick = (css, prop) => (new RegExp("(?:^|[;\\s])" + prop + ":\\s*([^;]+);").exec(css) || [])[1];
  assert.equal(pick(bd, "font-size"), "13px");
  assert.equal(pick(rule("    textarea"), "font-size"), "13px");
  assert.equal(pick(bd, "font-family"), pick(rule("    textarea"), "font-family"));
  assert.equal(pick(bd, "line-height"), pick(rule(".ph-wrap textarea"), "line-height"));
  assert.equal(pick(bd, "padding"), pick(rule("input, textarea, select"), "padding"));
  assert.match(ta, /border: 1px solid/);
  assert.match(bd, /border: 1px solid transparent/);
  assert.match(bd, /white-space: pre-wrap/);
});

test("folderSlots: distinct, keyed by id, stable when folders are added or renamed", () => {
  const f = (id, name) => ({ id, name });
  const three = [f("f_a", "Incident"), f("f_b", "Internal"), f("f_c", "Customer replies")];
  const s3 = TL.folderSlots(three);
  assert.equal(new Set(s3.values()).size, 3, "no shared colours");
  // Adding a folder (appended — creation order) never recolours the others.
  const s4 = TL.folderSlots([...three, f("f_d", "New")]);
  for (const x of three) assert.equal(s4.get(x.id), s3.get(x.id), x.name);
  // A rename keeps the id, so it keeps the colour.
  assert.equal(TL.folderSlots([f("f_a", "Renamed"), ...three.slice(1)]).get("f_a"), s3.get("f_a"));
  // More folders than colours: every folder still gets a valid slot.
  const many = TL.folderSlots([...Array(20)].map((_, k) => f("f_" + k, "F" + k)));
  assert.equal(many.size, 20);
  for (const v of many.values()) assert.ok(v >= 0 && v < TL.PH_SLOTS);
  assert.equal(TL.folderSlots([]).size, 0);
});

// --- Security regression pins (2.6.x audit) ---

// The deny-list used to be token-equality only, which fails in Turkish: the
// suffix attaches to the root, so "sifre" never matched "sifreniz". That made
// the extension weakest in the language its own first-run template ships in.
test("isSecretName catches inflected Turkish roots and digit-suffixed names", () => {
  for (const name of ["şifreniz", "şifrem", "sifreniz", "parolam", "parolaniz",
    "kullanici_sifresi", "kartiniz", "guvenlik_sorusu", "kredi_limiti",
    "pw", "auth", "jwt", "ccv", "credential", "credentials", "master_key",
    "ssh_key", "vkn", "tc_no", "password1", "pass1", "pin2"]) {
    assert.ok(TL.isSecretName(name), `should be secret: ${name}`);
  }
  // The token rule exists because un-anchored English stems flagged these.
  // Prefix matching is applied to the Turkish roots ONLY — prove it stayed there.
  // ("session_title" is deliberately absent: the bare token "session" predates
  //  this change and flags it. Pre-existing, and in the safe direction — a
  //  false positive only means a value is not remembered.)
  for (const name of ["shipping", "passenger", "bypass", "pinned", "kodlama",
    "author", "masterclass_name"]) {
    assert.ok(!TL.isSecretName(name), `should NOT be secret: ${name}`);
  }
});

// COND_BLOCK_RE holds two lazy [\s\S]*? spans: on an unclosed {{#if}}…{{else}}
// chain its backtracking is cubic, and applyConditionals runs on the PAGE's
// main thread during a paste. Measured 4.8s at MAX_BODY before the gate.
test("applyConditionals cannot be made to hang on an unbalanced body", () => {
  const body = "{{#if a}}{{else}}".repeat(Math.floor(TL.LIMITS.MAX_BODY / 17));
  assert.ok(body.length > TL.LIMITS.MAX_BODY - 20, "input is at the cap");
  const started = Date.now();
  const out = TL.applyConditionals(body, { a: "true" });
  const ms = Date.now() - started;
  assert.ok(ms < 250, `resolved in ${ms}ms, expected well under 250ms`);
  // The gate refuses to resolve, so the body is handed back untouched — which
  // is what an unbalanced body produced before, raw markers and all.
  assert.equal(out, body);
  // A sound body of the same size is still resolved normally.
  const sound = "{{#if a}}x{{else}}y{{/if}}".repeat(700);
  assert.ok(!TL.applyConditionals(sound, { a: "true" }).includes("{{#if"));
});

// Assignment to values["__proto__"] is silently swallowed, so the token
// survived substitution and {{__proto__}} was pasted verbatim into whatever
// the user sent a customer.
test("parseFields refuses names that address Object.prototype", () => {
  for (const name of ["__proto__", "constructor", "prototype", "__PROTO__"]) {
    assert.equal(TL.parseFields(`{{${name}}}`).length, 0, name);
    assert.equal(TL.parseFields(`{{#if ${name}}}x{{/if}}`).length, 0, `#if ${name}`);
  }
  assert.equal(TL.parseFields("{{customer_name}}").length, 1, "ordinary names still parse");
});

// --- applyConditionals: scanner vs. the regex it replaced ---

// The exact implementation that shipped through 2.6.0, kept as an oracle.
// The scanner exists because this one backtracks cubically on an unclosed
// {{#if}} chain (4.8s at MAX_BODY, on the page's main thread during a paste)
// — but every OTHER input must still come out byte-identical, which is what
// the differential test below is for. Inputs stay short so the oracle is fast.
const OLD_COND_BLOCK_RE =
  /\{\{\s*#if\s+([^{}=|]+?)\s*(?:=\s*([^{}|]*?)\s*)?\}\}([\s\S]*?)(?:\{\{\s*else\s*\}\}([\s\S]*?))?\{\{\s*\/if\s*\}\}/gi;
function oldApplyConditionals(template, values) {
  const condTrue = (name, eq) => {
    const v = String((values && values[name]) ?? "").trim();
    if (eq !== undefined) return v.toLowerCase() === String(eq).trim().toLowerCase();
    return v !== "" && v !== "false" && v !== "0";
  };
  return String(template ?? "").replace(OLD_COND_BLOCK_RE, (_m, name, eq, yes, no) =>
    condTrue(name.trim(), eq) ? yes : (no ?? "")
  );
}

test("applyConditionals matches the old regex byte for byte", () => {
  // Deterministic PRNG so a failure is reproducible from the seed alone.
  let seed = 0x9e3779b9;
  const rnd = (n) => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % n);
  };
  const atoms = ["{{#if a}}", "{{#if b=x}}", "{{#if a = x }}", "{{else}}", "{{/if}}",
    "hello", " ", "\n", "{{name}}", "{{#if}}", "{{ /if }}", "x"];
  const valueSets = [{ a: "true", b: "x" }, { a: "", b: "" }, { a: "0", b: "y" }];

  for (let i = 0; i < 4000; i++) {
    let body = "";
    const len = 1 + rnd(9);
    for (let k = 0; k < len; k++) body += atoms[rnd(atoms.length)];
    for (const values of valueSets) {
      assert.equal(
        TL.applyConditionals(body, values),
        oldApplyConditionals(body, values),
        `seed-derived body ${JSON.stringify(body)} with ${JSON.stringify(values)}`
      );
    }
  }
});

test("applyConditionals resolves sound blocks even when a stray marker follows", () => {
  // The structural gate this scanner replaced refused the WHOLE body when the
  // lint found any problem, so one stray {{/if}} disabled every good block.
  assert.equal(
    TL.applyConditionals("{{#if a}}OK{{/if}} and a stray {{/if}}", { a: "true" }),
    "OK and a stray {{/if}}"
  );
  assert.equal(
    TL.applyConditionals("{{#if a}}A{{else}}B{{/if}}|{{#if a}}C{{/if}}|{{else}}", { a: "" }),
    "B|" + "|{{else}}"
  );
});
