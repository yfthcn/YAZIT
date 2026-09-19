// @ts-check
// ==============================
// YAZIT — Background
// ==============================
// Chrome/Edge: service_worker (MV3). Firefox: background.scripts
// (common.js is loaded first by the manifest).
// ==============================

// Load common.js in the service-worker context if not already present.
if (typeof self.TL === "undefined") {
  try {
    self.importScripts("common.js", "common-ui.js");
  } catch (e) {
    console.error("[YAZIT] Failed to load common.js:", e);
  }
}

// Both halves must be present: everything this file calls except migrate /
// get-setTemplates lives in common-ui.js.
const tlReady = () => {
  if (typeof self.TL !== "undefined" && typeof TL.pasteToTab === "function") return true;
  console.error("[YAZIT] TL missing — common.js / common-ui.js failed to load.");
  return false;
};

// --- Messages from content scripts ---
// FOCUS: a frame gained an editable focus → remember its frameId per tab in
//   storage.session (survives service-worker restarts, never hits disk) so
//   popup/shortcut pastes target that frame only. See TL.pickTargetFrame.
// GET_UI_STRINGS: content scripts can't fetch _locales; when the user picked an
//   explicit uiLang we answer with the chosen locale so in-page UI matches.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!tlReady()) return;
  if (sender?.id !== chrome.runtime.id) return;

  if (msg?.type === "FOCUS") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number" && typeof sender.frameId === "number" && chrome.storage.session) {
      chrome.storage.session.set({ [TL.focusKey(tabId)]: sender.frameId }).catch(() => {});
    }
    return; // no response needed
  }

  if (msg?.type === "GET_UI_STRINGS" && Array.isArray(msg.keys)) {
    (async () => {
      try {
        await TL.loadLocale(await TL.getLang());
        const strings = {};
        for (const k of msg.keys.slice(0, 50)) strings[String(k)] = TL.t(String(k));
        sendResponse({ strings });
      } catch (_) {
        sendResponse({ strings: {} });
      }
    })();
    return true; // async sendResponse
  }
});

// Drop the per-tab focus record when the tab goes away or navigates: subframe
// ids do not survive a navigation, so a record left behind would point at a
// frame that no longer exists. (onUpdated needs no "tabs" permission for
// `status`; only `url` is withheld.)
const forgetFocus = (tabId) => {
  if (!tlReady() || !chrome.storage.session) return;
  chrome.storage.session.remove(TL.focusKey(tabId)).catch(() => {});
};
chrome.tabs.onRemoved.addListener(forgetFocus);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") forgetFocus(tabId);
});

// --- Keyboard shortcut handling: quick-slot paste resolves by order ---
chrome.commands.onCommand.addListener(async (command) => {
  if (!tlReady()) return;
  const match = /^paste-template-(\d+)$/.exec(command);
  if (!match) return;

  const index = Number(match[1]) - 1;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (TL.isSystemUrl(tab.url)) return;

  const templates = await TL.getTemplates(); // order-sorted
  const template = templates[index];
  if (!template) return;

  try {
    await TL.pasteToTab(tab.id, template, 100);
  } catch (err) {
    console.warn("[YAZIT] Cannot paste on this page:", err.message);
  }
});

// --- Install / update: defaults on install, authoritative migrate on update ---
// This is the single writer for migration: it reads the whole store, migrates
// it to the current schema and writes once. Other contexts migrate-on-read
// without writing.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (!tlReady()) return;
  if (reason === "install") {
    const existing = await TL.getTemplates();
    if (existing.length > 0) return;

    const lang = (chrome.i18n.getUILanguage?.() || "en").toLowerCase();
    const isTurkish = lang.startsWith("tr");
    await TL.loadLocale(isTurkish ? "tr" : "en");

    const defaults = [
      { name: TL.t("defaultTpl1Name"), shortcut: isTurkish ? "sifre" : "pass", body: TL.t("defaultTpl1Body") },
      { name: TL.t("defaultTpl2Name"), shortcut: isTurkish ? "bilgi" : "info", body: TL.t("defaultTpl2Body") },
      { name: TL.t("defaultTpl3Name"), shortcut: isTurkish ? "kapanis" : "close", body: TL.t("defaultTpl3Body") },
    ];
    await TL.setTemplates(defaults);
    return;
  }

  if (reason !== "update") return;

  // Pre-2.4.2 shared lastValues blob → per-template keys (idempotent).
  await TL.migrateLastValues();

  // Values remembered under an older, narrower secret rule (the list knew no
  // Turkish, so "sifre"/"parola"/"kart_no" were stored in the clear) are swept
  // out here — widening the rule alone would only protect future writes.
  await TL.purgeSecretLastValues();

  try {
    const raw = await chrome.storage.local.get(null);
    if (raw.schemaVersion === TL.CURRENT_SCHEMA) return; // already migrated
    const migrated = TL.migrate(raw);
    await chrome.storage.local.set({
      templates: migrated.templates,
      schemaVersion: TL.CURRENT_SCHEMA,
    });
    // quickSlots (≤2.3) was written by an old migration but never read anywhere.
    await chrome.storage.local.remove("quickSlots");
    console.info("[YAZIT] Migrated store to schema v" + TL.CURRENT_SCHEMA);
  } catch (err) {
    console.error("[YAZIT] Migration on update failed:", err);
  }
});
