"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const Editor = require("../src/editor.js");

function makeEditor(markup) {
  const dom = new JSDOM(`<div id="editor" contenteditable="true">${markup}</div>`);
  return {
    editor: dom.window.document.querySelector("#editor"),
    document: dom.window.document
  };
}

test("gives the visible upload label an invisible normalization-resistant signature", () => {
  const placeholderText = Editor.makeUploadPlaceholder("Uploading image");

  assert.notEqual(placeholderText, "Uploading image");
  assert.equal(placeholderText.replaceAll("\u2063", ""), "Uploading image");
});

test("removes a signed placeholder after Salesforce unwraps its span", () => {
  const label = "Uploading image";
  const placeholderText = Editor.makeUploadPlaceholder(label);
  const { editor } = makeEditor(`Before ${placeholderText} after`);

  const removed = Editor.removeNormalizedUploadPlaceholder(
    editor,
    { label, placeholderText },
    null
  );

  assert.equal(removed, true);
  assert.equal(editor.textContent, "Before  after");
});

test("removes a plain normalized placeholder beside the inserted image", () => {
  const label = "Uploading image";
  const { editor } = makeEditor(`<p>Before<img src="/uploaded.png">${label}Keep this text</p>`);
  const image = editor.querySelector("img");

  const removed = Editor.removeNormalizedUploadPlaceholder(
    editor,
    { label, placeholderText: Editor.makeUploadPlaceholder(label) },
    image
  );

  assert.equal(removed, true);
  assert.equal(editor.textContent, "BeforeKeep this text");
  assert.equal(editor.querySelector("img"), image);
});

test("does not remove unrelated placeholder-like text away from the inserted image", () => {
  const label = "Uploading image";
  const { editor } = makeEditor(`${label}<p><img src="/uploaded.png">Customer reply</p>`);
  const image = editor.querySelector("img");

  const removed = Editor.removeNormalizedUploadPlaceholder(
    editor,
    { label, placeholderText: Editor.makeUploadPlaceholder(label) },
    image
  );

  assert.equal(removed, false);
  assert.equal(editor.textContent, `${label}Customer reply`);
});

test("targets the correct marker when several pasted images are pending", () => {
  const firstLabel = "Uploading image 1";
  const secondLabel = "Uploading image 2";
  const firstPlaceholder = Editor.makeUploadPlaceholder(firstLabel);
  const secondPlaceholder = Editor.makeUploadPlaceholder(secondLabel);
  const { editor } = makeEditor(`${firstPlaceholder}${secondPlaceholder}`);

  const removed = Editor.removeNormalizedUploadPlaceholder(
    editor,
    { label: secondLabel, placeholderText: secondPlaceholder },
    null
  );

  assert.equal(removed, true);
  assert.equal(editor.textContent, firstPlaceholder);
});

test("keeps the edit modal and backdrop visible while hiding new upload surfaces", async () => {
  const dom = new JSDOM(`<style>${require("node:fs").readFileSync(require.resolve("../src/content.css"), "utf8")}</style>
    <div class="slds-backdrop" id="backdrop"></div>
    <section class="slds-modal" role="dialog" id="edit"><div class="modal-container">
      <div id="editor" contenteditable="true"></div></div></section>`);
  const { document } = dom.window;
  const editor = document.querySelector("#editor");
  document.documentElement.setAttribute("data-casepaste-native-active", "upload");
  const restore = Editor.hideNativeUploadSurfaces(document, editor);
  const upload = document.createElement("section");
  upload.className = "slds-modal";
  upload.innerHTML = '<div role="dialog">Select Image <button>Upload Image</button></div>';
  const backdrop = document.createElement("div");
  backdrop.className = "slds-backdrop";
  document.body.append(upload, backdrop);
  await new Promise(resolve => dom.window.queueMicrotask(resolve));

  for (const node of document.querySelectorAll("#edit, #edit .modal-container, #backdrop")) {
    assert.equal(dom.window.getComputedStyle(node).visibility, "visible");
  }
  assert.equal(dom.window.getComputedStyle(upload).visibility, "hidden");
  assert.equal(dom.window.getComputedStyle(backdrop).visibility, "hidden");
  restore();
  assert.equal(document.querySelectorAll("[data-casepaste-upload-surface]").length, 0);
  dom.window.close();
});

test("upload badge follows normalized inline text on every upload and cleans up", () => {
  const dom = new JSDOM('<div id="editor" contenteditable="true"></div>', { pretendToBeVisual: true });
  const { document } = dom.window;
  const editor = document.querySelector("#editor");
  const frames = new Map();
  let nextFrame = 0;
  dom.window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  dom.window.cancelAnimationFrame = id => frames.delete(id);
  const tick = () => {
    const pending = Array.from(frames.values());
    frames.clear();
    pending.forEach(callback => callback());
  };
  const rect = { left: 30, right: 150, top: 40, bottom: 60, width: 120, height: 20 };
  editor.getBoundingClientRect = () => ({ left: 0, right: 500, top: 0, bottom: 300 });
  dom.window.Range.prototype.getBoundingClientRect = () => rect;

  for (let index = 0; index < 3; index += 1) {
    const anchor = document.createElement("span");
    const placeholderText = Editor.makeUploadPlaceholder("Uploading image");
    anchor.textContent = placeholderText;
    anchor.getBoundingClientRect = () => rect;
    editor.replaceChildren(anchor);
    const stop = Editor.showUploadIndicator(editor, { element: anchor, placeholderText, label: "Uploading image" });
    tick();
    const host = document.querySelector("[data-casepaste-upload-indicator]");
    assert.equal(host.style.display, "block");
    assert.equal(host.style.left, "30px");
    assert.equal(editor.contains(host), false);
    // Salesforce discards the styled span, retaining only the signed text.
    editor.textContent = placeholderText;
    tick();
    assert.equal(host.style.display, "block");
    assert.equal(host.style.top, "40px");
    if (index === 2) {
      editor.remove();
      tick();
    } else {
      stop();
    }
    assert.equal(host.isConnected, false);
    assert.equal(frames.size, 0);
  }
  dom.window.close();
});
