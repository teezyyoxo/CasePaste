(function exposeCasePasteCore(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CasePasteCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createCasePasteCore() {
  "use strict";

  const STORAGE_KEY = "casepasteOptions";
  const CASE_ID_PATTERN = /500[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?/;
  const POSITIONS = new Set(["top-right", "top-left", "bottom-right", "bottom-left"]);
  const MIME_EXTENSIONS = Object.freeze({
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/tiff": "tif",
    "image/webp": "webp"
  });

  const DEFAULTS = Object.freeze({
    enabled: true,
    showSuccessToast: true,
    toastTitle: "Paste landed",
    toastMessage: "{filename} made it to Case Files and landed right where you pasted.",
    toastDuration: 4200,
    toastPosition: "top-right",
    accentColor: "#6d5dfc",
    filenamePrefix: "CasePaste",
    maxFileSizeMb: 25
  });

  function clamp(number, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, number));
  }

  function cleanText(value, fallback, maximumLength) {
    if (typeof value !== "string") {
      return fallback;
    }

    const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    return cleaned ? cleaned.slice(0, maximumLength) : fallback;
  }

  function sanitizeSettings(candidate) {
    const input = candidate && typeof candidate === "object" ? candidate : {};
    const duration = Number(input.toastDuration);
    const maxFileSize = Number(input.maxFileSizeMb);
    const position = POSITIONS.has(input.toastPosition) ? input.toastPosition : DEFAULTS.toastPosition;
    const accent = typeof input.accentColor === "string" && /^#[0-9a-f]{6}$/i.test(input.accentColor)
      ? input.accentColor.toLowerCase()
      : DEFAULTS.accentColor;

    return {
      enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULTS.enabled,
      showSuccessToast: typeof input.showSuccessToast === "boolean"
        ? input.showSuccessToast
        : DEFAULTS.showSuccessToast,
      toastTitle: cleanText(input.toastTitle, DEFAULTS.toastTitle, 60),
      toastMessage: cleanText(input.toastMessage, DEFAULTS.toastMessage, 180),
      toastDuration: Number.isFinite(duration)
        ? Math.round(clamp(duration, 1200, 10000))
        : DEFAULTS.toastDuration,
      toastPosition: position,
      accentColor: accent,
      filenamePrefix: cleanText(input.filenamePrefix, DEFAULTS.filenamePrefix, 48)
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, " "),
      maxFileSizeMb: Number.isFinite(maxFileSize)
        ? Math.round(clamp(maxFileSize, 1, 200))
        : DEFAULTS.maxFileSizeMb
    };
  }

  function isCaseId(value) {
    return typeof value === "string" && /^500[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(value);
  }

  function parseCaseId(value) {
    if (typeof value !== "string" || !value) {
      return null;
    }

    const candidates = [value];
    try {
      const decoded = decodeURIComponent(value);
      if (decoded !== value) {
        candidates.push(decoded);
      }
    } catch (_error) {
      // A malformed percent sequence should not keep the rest of the page from working.
    }

    for (const candidate of candidates) {
      const lightningMatch = candidate.match(
        /\/lightning\/r\/(?:Case\/)?(500[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?)(?:\/|$|[?#])/i
      );
      if (lightningMatch) {
        return lightningMatch[1];
      }

      const genericMatch = candidate.match(CASE_ID_PATTERN);
      if (genericMatch && isCaseId(genericMatch[0])) {
        return genericMatch[0];
      }
    }

    return null;
  }

  function chooseLatestApiRoot(versions) {
    if (!Array.isArray(versions)) {
      return null;
    }

    const valid = versions
      .filter((entry) => entry && Number.isFinite(Number(entry.version)) && typeof entry.url === "string")
      .sort((left, right) => Number(right.version) - Number(left.version));

    return valid.length ? valid[0].url.replace(/\/$/, "") : null;
  }

  function salesforceApiOrigins(pageUrl) {
    let parsed;
    try {
      parsed = new URL(pageUrl);
    } catch (_error) {
      return [];
    }

    if (parsed.protocol !== "https:") {
      return [];
    }

    const hostname = parsed.hostname.toLowerCase();
    const isSalesforceHost = hostname.endsWith(".salesforce.com") || hostname.endsWith(".force.com");
    if (!isSalesforceHost) {
      return [];
    }

    const pageOrigin = parsed.origin;
    const candidates = [];
    if (hostname.endsWith(".lightning.force.com")) {
      const apiHostname = hostname.replace(/\.lightning\.force\.com$/, ".my.salesforce.com");
      candidates.push(`https://${apiHostname}`);
    }
    candidates.push(pageOrigin);
    return [...new Set(candidates)];
  }

  function extensionForMimeType(mimeType) {
    if (MIME_EXTENSIONS[mimeType]) {
      return MIME_EXTENSIONS[mimeType];
    }

    const subtype = typeof mimeType === "string" ? mimeType.split("/")[1] : "";
    const cleaned = subtype ? subtype.split("+")[0].replace(/[^a-z0-9]/gi, "").toLowerCase() : "";
    return cleaned || "png";
  }

  function makeFilename(prefix, mimeType, date, index) {
    const when = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const safePrefix = sanitizeSettings({ filenamePrefix: prefix }).filenamePrefix;
    const stamp = when.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
    const suffix = Number(index) > 1 ? `-${Number(index)}` : "";
    return `${safePrefix}-${stamp}${suffix}.${extensionForMimeType(mimeType)}`;
  }

  function renderTemplate(template, variables) {
    const source = typeof template === "string" ? template : "";
    const values = variables && typeof variables === "object" ? variables : {};

    return source.replace(/\{(filename|caseId|count)\}/g, (match, key) => {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match;
    });
  }

  function formatFileSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) {
      return "0 B";
    }

    const units = ["B", "KB", "MB", "GB"];
    const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    const value = size / (1024 ** unitIndex);
    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
  }

  function extractApiError(payload, statusText) {
    if (Array.isArray(payload) && payload.length) {
      return payload.map((entry) => entry && entry.message).filter(Boolean).join(" ") || statusText;
    }

    if (payload && typeof payload === "object") {
      return payload.message || payload.error_description || payload.error || statusText;
    }

    return statusText || "Salesforce did not accept the upload.";
  }

  return Object.freeze({
    DEFAULTS,
    STORAGE_KEY,
    chooseLatestApiRoot,
    extensionForMimeType,
    extractApiError,
    formatFileSize,
    isCaseId,
    makeFilename,
    parseCaseId,
    renderTemplate,
    salesforceApiOrigins,
    sanitizeSettings
  });
});
