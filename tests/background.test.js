"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const Core = require("../src/core.js");

function response(payload, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() {
      return payload;
    }
  };
}

function loadBackground(fetchMock) {
  const listeners = {};
  const chrome = {
    action: { onClicked: { addListener(listener) { listeners.action = listener; } } },
    runtime: {
      onConnect: { addListener(listener) { listeners.connect = listener; } },
      onInstalled: { addListener(listener) { listeners.installed = listener; } },
      openOptionsPage() {}
    },
    storage: {
      sync: {
        async get() { return {}; },
        async set() {}
      }
    }
  };
  const context = vm.createContext({
    AbortController,
    atob,
    Blob,
    CasePasteCore: Core,
    chrome,
    crypto: webcrypto,
    fetch: fetchMock,
    importScripts() {},
    Uint8Array,
    URL
  });
  const source = fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8");
  vm.runInContext(source, context, { filename: "background.js" });
  return listeners;
}

function makePort(url) {
  const inputListeners = [];
  const disconnectListeners = [];
  const output = [];
  let resolveOutput;
  const nextOutput = new Promise((resolve) => { resolveOutput = resolve; });
  const port = {
    name: "casepaste-upload",
    sender: { url },
    onMessage: { addListener(listener) { inputListeners.push(listener); } },
    onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
    postMessage(message) {
      output.push(message);
      resolveOutput(message);
    },
    disconnect() {
      for (const listener of disconnectListeners) {
        listener();
      }
    }
  };
  return {
    output,
    port,
    send(message) {
      for (const listener of inputListeners) {
        listener(message);
      }
    },
    async receive() {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Background response timed out")), 1500);
        nextOutput.then((message) => {
          clearTimeout(timeout);
          resolve(message);
        }, reject);
      });
    }
  };
}

test("streams an image to the authenticated My Domain ContentVersion endpoint", async () => {
  const requests = [];
  const fetchMock = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "https://acme.my.salesforce.com/services/data/") {
      return response([{ version: "67.0", url: "/services/data/v67.0" }]);
    }
    if (url === "https://acme.my.salesforce.com/services/data/v67.0/limits") {
      return response({ DailyApiRequests: { Max: 1000, Remaining: 999 } });
    }
    if (url === "https://acme.my.salesforce.com/services/data/v67.0/sobjects/ContentVersion") {
      return response({ id: "0688a00000ABCDE", success: true, errors: [] }, 201, "Created");
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const listeners = loadBackground(fetchMock);
  const connection = makePort(
    "https://acme.lightning.force.com/lightning/r/Case/5008a00001ABCDe/view"
  );
  listeners.connect(connection.port);

  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
  connection.send({
    type: "start",
    caseId: "5008a00001ABCDe",
    filename: "CasePaste-2026-08-31T14-32-08Z.png",
    mimeType: "image/png",
    size: bytes.byteLength
  });
  connection.send({ type: "chunk", data: Buffer.from(bytes).toString("base64") });
  connection.send({ type: "end" });

  const message = await connection.receive();
  assert.equal(message.type, "complete");
  assert.equal(message.result.id, "0688a00000ABCDE");
  assert.equal(message.result.success, true);
  assert.equal(requests.length, 3);

  const uploadRequest = requests[2];
  assert.equal(uploadRequest.options.method, "POST");
  assert.equal(uploadRequest.options.credentials, "include");
  assert.match(uploadRequest.options.headers["Content-Type"], /^multipart\/form-data; boundary=----CasePaste/);
  const body = await uploadRequest.options.body.text();
  assert.match(body, /name="entity_content"/);
  assert.match(body, /"FirstPublishLocationId":"5008a00001ABCDe"/);
  assert.match(body, /name="VersionData"; filename="CasePaste-2026-08-31T14-32-08Z.png"/);

  connection.port.disconnect();
});

test("rejects upload connections from outside Salesforce without making a request", async () => {
  let fetchCount = 0;
  const listeners = loadBackground(async () => {
    fetchCount += 1;
    return response({});
  });
  const connection = makePort("https://example.com/not-salesforce");
  listeners.connect(connection.port);
  connection.send({
    type: "start",
    caseId: "5008a00001ABCDe",
    filename: "image.png",
    mimeType: "image/png",
    size: 8
  });

  const message = await connection.receive();
  assert.equal(message.type, "error");
  assert.match(message.error.message, /recognized Salesforce page/);
  assert.equal(fetchCount, 0);
  connection.port.disconnect();
});
