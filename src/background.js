"use strict";

importScripts("core.js");

const { DEFAULTS, STORAGE_KEY, sanitizeSettings } = CasePasteCore;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  await chrome.storage.sync.set({
    [STORAGE_KEY]: sanitizeSettings(stored[STORAGE_KEY] || DEFAULTS)
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "casepaste-upload") {
    return;
  }

  const sourceUrl = port.sender && port.sender.url;
  const origins = CasePasteCore.salesforceApiOrigins(sourceUrl);
  let upload = null;
  let completing = false;
  const abortController = new AbortController();

  port.onDisconnect.addListener(() => {
    if (!completing) {
      abortController.abort();
    }
    upload = null;
  });

  port.onMessage.addListener((message) => {
    try {
      if (!message || typeof message.type !== "string") {
        throw new Error("The upload message was incomplete.");
      }

      if (message.type === "start") {
        if (!origins.length) {
          throw new Error("The upload did not come from a recognized Salesforce page.");
        }
        if (upload) {
          throw new Error("An upload is already active on this connection.");
        }

        const size = Number(message.size);
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_UPLOAD_BYTES) {
          throw new Error("The pasted image size is outside CasePaste's supported range.");
        }
        if (typeof message.mimeType !== "string" || !message.mimeType.toLowerCase().startsWith("image/")) {
          throw new Error("Only image clipboard data can be uploaded.");
        }
        if (!CasePasteCore.isCaseId(message.caseId)) {
          throw new Error("The Salesforce Case ID was invalid.");
        }

        upload = {
          caseId: message.caseId,
          chunks: [],
          filename: cleanFilename(message.filename),
          mimeType: message.mimeType,
          receivedBytes: 0,
          size
        };
        return;
      }

      if (!upload) {
        throw new Error("The upload was not initialized.");
      }

      if (message.type === "chunk") {
        const bytes = decodeBase64Chunk(message.data);
        upload.receivedBytes += bytes.byteLength;
        if (upload.receivedBytes > upload.size || upload.receivedBytes > MAX_UPLOAD_BYTES) {
          throw new Error("The upload contained more image data than expected.");
        }
        upload.chunks.push(bytes);
        return;
      }

      if (message.type === "end") {
        if (completing) {
          throw new Error("The upload was already being completed.");
        }
        if (upload.receivedBytes !== upload.size) {
          throw new Error("The pasted image data was incomplete.");
        }
        completing = true;
        void completeUpload(upload, origins, abortController.signal)
          .then((result) => postToPort(port, { type: "complete", result }))
          .catch((error) => postError(port, error))
          .finally(() => {
            upload = null;
          });
        return;
      }

      throw new Error("CasePaste received an unknown upload message.");
    } catch (error) {
      postError(port, error);
      upload = null;
    }
  });
});

function cleanFilename(value) {
  if (typeof value !== "string") {
    throw new Error("The uploaded image needs a file name.");
  }
  const cleaned = value.replace(/["\\\r\n]/g, "_").slice(0, 180);
  if (!cleaned) {
    throw new Error("The uploaded image needs a file name.");
  }
  return cleaned;
}

function decodeBase64Chunk(value) {
  if (typeof value !== "string") {
    throw new Error("An image chunk could not be read.");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function completeUpload(upload, origins, signal) {
  const file = new Blob(upload.chunks, { type: upload.mimeType });
  upload.chunks = [];
  const api = await findAuthenticatedApi(origins, signal);
  const boundary = `----CasePaste${makeUniqueId()}`;
  const metadata = {
    Title: upload.filename.replace(/\.[^.]+$/, ""),
    PathOnClient: upload.filename,
    FirstPublishLocationId: upload.caseId,
    Origin: "H"
  };
  const preamble = [
    `--${boundary}`,
    "Content-Disposition: form-data; name=\"entity_content\"",
    "Content-Type: application/json",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Disposition: form-data; name=\"VersionData\"; filename=\"${upload.filename}\"`,
    `Content-Type: ${upload.mimeType}`,
    "",
    ""
  ].join("\r\n");
  const body = new Blob([preamble, file, `\r\n--${boundary}--\r\n`]);

  const response = await fetch(`${api.origin}${api.root}/sobjects/ContentVersion`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body,
    signal
  });
  if (!response.ok) {
    throw await responseError(response);
  }

  const result = await response.json();
  if (!result.success || !result.id) {
    throw new Error(CasePasteCore.extractApiError(result.errors, "Salesforce did not return a file ID."));
  }
  return { id: result.id, success: true };
}

async function findAuthenticatedApi(origins, signal) {
  let lastError = null;
  let authenticationError = null;
  for (const origin of origins) {
    try {
      const versionsResponse = await fetch(`${origin}/services/data/`, {
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal
      });
      if (!versionsResponse.ok) {
        throw await responseError(versionsResponse);
      }

      const root = CasePasteCore.chooseLatestApiRoot(await versionsResponse.json());
      if (!root) {
        throw new Error("Salesforce did not report an available REST API version.");
      }

      const sessionCheck = await fetch(`${origin}${root}/limits`, {
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal
      });
      if (!sessionCheck.ok) {
        throw await responseError(sessionCheck);
      }
      return { origin, root };
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw error;
      }
      if (!authenticationError && error && (error.status === 401 || error.status === 403)) {
        authenticationError = error;
      }
      lastError = error;
    }
  }

  throw authenticationError || lastError || new Error("CasePaste could not reach the Salesforce REST API.");
}

async function responseError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    // Salesforce can return an HTML sign-in page when a browser session expires.
  }
  const error = new Error(CasePasteCore.extractApiError(payload, response.statusText));
  error.status = response.status;
  return error;
}

function makeUniqueId() {
  const bytes = new Uint32Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(36)).join("");
}

function postError(port, error) {
  postToPort(port, {
    type: "error",
    error: {
      code: error && error.code,
      message: error && error.name === "AbortError"
        ? "The upload was interrupted when the Salesforce page changed."
        : (error && error.message) || "Salesforce did not accept the image.",
      status: error && error.status
    }
  });
}

function postToPort(port, message) {
  try {
    port.postMessage(message);
  } catch (_error) {
    // The originating tab can close while Salesforce is finishing an upload.
  }
}
