// ==============================
// YAZIT — DOMParser shim for the unit tests
// ==============================
// common.js#sanitizeHtml has two implementations: the authoritative DOM path
// (DOMParser) and a DOM-free fallback. DOMParser is `[Exposed=Window]` in the
// HTML standard, so it exists in neither Node nor an MV3 service worker —
// which means BOTH paths run in production (page contexts vs. the Chrome
// service worker) and the suite must cover both.
//
// parse5 implements the same HTML5 tree-construction algorithm browsers do, so
// wrapping it gives the tree walker the node shapes it expects.
//
// Deliberately NOT shimmed: `document`. cleanHref's DOM branch resolves an
// href against the document's base URL, so its verdict depends on the context
// it runs in (chrome-extension:// on the options page, http(s):// in a content
// script). Picking one base here would bake an arbitrary context into the
// tests; leaving `document` undefined makes cleanHref take its regex branch in
// both paths, which isolates what these tests are for: the tree walk.
"use strict";

const parse5 = require("parse5");

/**
 * Wrap a parse5 node in the minimal DOM surface walkDom() touches.
 * @param {any} node
 * @returns {any}
 */
function wrap(node) {
  const isText = node.nodeName === "#text";
  const isComment = node.nodeName === "#comment";
  return {
    nodeType: isText ? 3 : isComment ? 8 : 1,
    nodeValue: isText ? node.value : isComment ? node.data : null,
    tagName: node.tagName ? node.tagName.toUpperCase() : "",
    get childNodes() {
      return (node.childNodes || []).map(wrap);
    },
    /** @param {string} name */
    getAttribute(name) {
      const attr = (node.attrs || []).find((/** @type {any} */ a) => a.name === String(name).toLowerCase());
      return attr ? attr.value : null;
    },
  };
}

const EMPTY_BODY = { nodeName: "body", tagName: "body", childNodes: [] };

class ShimDOMParser {
  /** @param {string} html */
  parseFromString(html) {
    const doc = /** @type {any} */ (parse5.parse(String(html)));
    const htmlEl = doc.childNodes.find((/** @type {any} */ c) => c.tagName === "html");
    // A document that opens a <frameset> has no <body> at all.
    const body =
      htmlEl &&
      htmlEl.childNodes.find((/** @type {any} */ c) => c.tagName === "body" || c.tagName === "frameset");
    return { body: wrap(body || EMPTY_BODY) };
  }
}

/**
 * Run fn with the DOM path active, then restore the previous state so the
 * next test sees whichever path it expects.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function withDom(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "DOMParser");
  const prev = /** @type {any} */ (globalThis).DOMParser;
  /** @type {any} */ (globalThis).DOMParser = ShimDOMParser;
  try {
    return fn();
  } finally {
    if (had) /** @type {any} */ (globalThis).DOMParser = prev;
    else delete (/** @type {any} */ (globalThis).DOMParser);
  }
}

module.exports = { ShimDOMParser, withDom };
