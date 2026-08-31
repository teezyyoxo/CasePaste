"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.attributes = new Map();
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

class FakeHTMLElement extends EventTarget {
  constructor() {
    super();
    this.originalClickCount = 0;
  }

  click() {
    this.originalClickCount += 1;
  }
}

class FakeInput extends FakeHTMLElement {
  constructor() {
    super();
    this.type = "file";
    this.files = [];
  }

  showPicker() {
    this.originalClickCount += 1;
  }
}

class FakeFile {
  constructor(parts, name, options) {
    this.name = name;
    this.type = options.type;
    this.size = parts.reduce((total, part) => total + part.byteLength, 0);
  }
}

class FakeDataTransfer {
  constructor() {
    this.files = [];
    this.items = {
      add: (file) => this.files.push(file)
    };
  }
}

test("hands a staged clipboard image to Salesforce's native file input without opening a picker", async () => {
  const token = "paste-123";
  const root = new FakeElement();
  const payload = new FakeElement();
  payload.textContent = Buffer.from([137, 80, 78, 71]).toString("base64");
  payload.setAttribute("data-filename", "CasePaste-test.png");
  payload.setAttribute("data-mime-type", "image/png");
  payload.removed = false;
  payload.remove = () => { payload.removed = true; };

  const document = new EventTarget();
  document.documentElement = root;
  document.getElementById = (id) => id === `casepaste-native-payload-${token}` ? payload : null;
  const window = {
    clearTimeout,
    setTimeout
  };
  const context = vm.createContext({
    atob,
    DataTransfer: FakeDataTransfer,
    document,
    Event,
    File: FakeFile,
    HTMLElement: FakeHTMLElement,
    HTMLInputElement: FakeInput,
    queueMicrotask,
    Uint8Array,
    window
  });
  const source = fs.readFileSync(path.join(__dirname, "../src/page-bridge.js"), "utf8");
  vm.runInContext(source, context, { filename: "page-bridge.js" });

  root.setAttribute("data-casepaste-native-arm", token);
  document.dispatchEvent(new Event("casepaste:arm-native-image-upload"));

  const regularButton = new FakeHTMLElement();
  regularButton.click();
  assert.equal(regularButton.originalClickCount, 1);

  const input = new FakeInput();
  const changed = new Promise((resolve) => input.addEventListener("change", resolve, { once: true }));
  input.click();
  await changed;

  assert.equal(input.originalClickCount, 0);
  assert.equal(input.files.length, 1);
  assert.equal(input.files[0].name, "CasePaste-test.png");
  assert.equal(input.files[0].type, "image/png");
  assert.equal(input.files[0].size, 4);
  assert.equal(payload.removed, true);
  assert.equal(root.getAttribute("data-casepaste-native-handoff"), token);

  const laterInput = new FakeInput();
  laterInput.click();
  assert.equal(laterInput.originalClickCount, 1);
});
