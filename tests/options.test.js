"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const Core = require("../src/core.js");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

async function openSettings(stored) {
  const dom = new JSDOM(read("options.html"), { runScripts: "outside-only" });
  let saved;
  dom.window.chrome = {
    runtime: { getManifest: () => ({ version: "0.2.1" }) },
    storage: { sync: {
      get: async () => ({ [Core.STORAGE_KEY]: stored }),
      set: async value => { saved = value[Core.STORAGE_KEY]; }
    } }
  };
  for (const script of ["src/core.js", "src/editor.js", "options.js"]) dom.window.eval(read(script));
  await new Promise(resolve => setImmediate(resolve));
  return { dom, form: dom.window.document.querySelector("form"), saved: () => saved };
}

test("spinner preferences preview, save, reload, and reset with existing settings", async () => {
  const page = await openSettings({ toastTitle: "Done" });
  const { dom, form } = page;
  const preferences = { spinnerColor: "#123456", spinnerBackground: "#fedcba", spinnerStyle: "dotted", spinnerSpeed: "slow" };
  for (const [key, value] of Object.entries(preferences)) form.elements[key].value = value;
  form.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const preview = dom.window.document.querySelector("#spinner-preview").firstElementChild;
  assert.equal(preview.style.getPropertyValue("--spinner-color"), preferences.spinnerColor);
  assert.equal(preview.style.getPropertyValue("--spinner-background"), preferences.spinnerBackground);
  assert.equal(preview.style.getPropertyValue("--spinner-duration"), "1.4s");
  assert.equal(dom.window.document.querySelector("#save-status").dataset.state, "dirty");
  form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  for (const [key, value] of Object.entries(preferences)) assert.equal(page.saved()[key], value);
  assert.equal(page.saved().toastTitle, "Done");
  const reopened = await openSettings(page.saved());
  for (const [key, value] of Object.entries(preferences)) assert.equal(reopened.form.elements[key].value, value);
  reopened.dom.window.document.querySelector("#reset-button").click();
  for (const key of Object.keys(preferences)) assert.equal(reopened.form.elements[key].value, Core.DEFAULTS[key]);
  dom.window.close();
  reopened.dom.window.close();
});

test("invalid spinner settings fall back to safe defaults", () => {
  const settings = Core.sanitizeSettings({ spinnerColor: "red;display:none", spinnerBackground: "", spinnerStyle: "unknown", spinnerSpeed: -2 });
  for (const key of ["spinnerColor", "spinnerBackground", "spinnerStyle", "spinnerSpeed"]) {
    assert.equal(settings[key], Core.DEFAULTS[key]);
    assert.equal(Core.sanitizeSettings({})[key], Core.DEFAULTS[key]);
  }
});
