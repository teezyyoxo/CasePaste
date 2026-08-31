"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core.js");

test("sanitizes settings and falls back safely", () => {
  const settings = Core.sanitizeSettings({
    enabled: false,
    showSuccessToast: false,
    toastTitle: "  All done  ",
    toastMessage: "Filed as {filename}",
    toastDuration: 50000,
    toastPosition: "middle-ish",
    accentColor: "#ABCDEF",
    filenamePrefix: "Case: Shots/Today",
    maxFileSizeMb: 0
  });

  assert.equal(settings.enabled, false);
  assert.equal(settings.showSuccessToast, false);
  assert.equal(settings.toastTitle, "All done");
  assert.equal(settings.toastDuration, 10000);
  assert.equal(settings.toastPosition, "top-right");
  assert.equal(settings.accentColor, "#abcdef");
  assert.equal(settings.filenamePrefix, "Case- Shots-Today");
  assert.equal(settings.maxFileSizeMb, 1);
});

test("finds 15 and 18 character Case IDs in Lightning URLs", () => {
  assert.equal(
    Core.parseCaseId("https://acme.lightning.force.com/lightning/r/Case/5008a00001ABCDe/view"),
    "5008a00001ABCDe"
  );
  assert.equal(
    Core.parseCaseId("https://acme.lightning.force.com/lightning/r/Case/5008a00001ABCDeAAH/view"),
    "5008a00001ABCDeAAH"
  );
  assert.equal(
    Core.parseCaseId("https://acme.lightning.force.com/lightning/page/home?record=%2Flightning%2Fr%2FCase%2F5008a00001ABCDe%2Fview"),
    "5008a00001ABCDe"
  );
});

test("does not mistake other Salesforce record IDs for Cases", () => {
  assert.equal(Core.parseCaseId("/lightning/r/Account/0018a00001ABCDe/view"), null);
  assert.equal(Core.parseCaseId("not a Salesforce ID"), null);
  assert.equal(Core.isCaseId("5008a00001ABCDeAAH"), true);
  assert.equal(Core.isCaseId("0018a00001ABCDeAAH"), false);
});

test("selects the newest valid API version reported by the org", () => {
  const versions = [
    { version: "62.0", url: "/services/data/v62.0" },
    { version: "67.0", url: "/services/data/v67.0/" },
    { version: "66.0", url: "/services/data/v66.0" },
    { version: "nope", url: "/services/data/nope" }
  ];
  assert.equal(Core.chooseLatestApiRoot(versions), "/services/data/v67.0");
  assert.equal(Core.chooseLatestApiRoot({}), null);
});

test("derives the documented API host from Lightning and keeps safe fallbacks", () => {
  assert.deepEqual(
    Core.salesforceApiOrigins("https://acme.lightning.force.com/lightning/r/Case/5008a00001ABCDe/view"),
    ["https://acme.my.salesforce.com", "https://acme.lightning.force.com"]
  );
  assert.deepEqual(
    Core.salesforceApiOrigins("https://acme--uat.sandbox.lightning.force.com/lightning/page/home"),
    ["https://acme--uat.sandbox.my.salesforce.com", "https://acme--uat.sandbox.lightning.force.com"]
  );
  assert.deepEqual(
    Core.salesforceApiOrigins("https://acme.my.salesforce.com/lightning/page/home"),
    ["https://acme.my.salesforce.com"]
  );
  assert.deepEqual(Core.salesforceApiOrigins("https://example.com/"), []);
});

test("creates stable, Salesforce-friendly image filenames", () => {
  assert.equal(
    Core.makeFilename("Field Capture", "image/jpeg", new Date("2026-08-31T14:32:08.000Z"), 1),
    "Field Capture-2026-08-31T14-32-08Z.jpg"
  );
  assert.equal(
    Core.makeFilename("Field Capture", "image/svg+xml", new Date("2026-08-31T14:32:08.000Z"), 3),
    "Field Capture-2026-08-31T14-32-08Z-3.svg"
  );
});

test("renders supported toast tokens without interpreting arbitrary braces", () => {
  assert.equal(
    Core.renderTemplate("{count}: {filename} on {caseId} {unknown}", {
      count: 2,
      filename: "2 images",
      caseId: "5008a00001ABCDe"
    }),
    "2: 2 images on 5008a00001ABCDe {unknown}"
  );
});

test("formats sizes and Salesforce errors for people", () => {
  assert.equal(Core.formatFileSize(1536), "1.5 KB");
  assert.equal(
    Core.extractApiError([{ message: "API access disabled" }], "Forbidden"),
    "API access disabled"
  );
  assert.equal(Core.extractApiError(null, "Bad Gateway"), "Bad Gateway");
});
