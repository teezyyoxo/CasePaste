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
