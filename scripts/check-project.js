"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function existing(relativePath) {
  const fullPath = path.join(root, relativePath);
  check(fs.existsSync(fullPath), `Manifest references missing file: ${relativePath}`);
}

function pngDimensions(relativePath) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  check(bytes.toString("ascii", 1, 4) === "PNG", `${relativePath} is not a PNG file`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

check(manifest.manifest_version === 3, "manifest.json must use Manifest V3");
check(/^\d+\.\d+\.\d+$/.test(manifest.version), "Manifest version must use three-part SemVer");
check(manifest.permissions.length === 1 && manifest.permissions[0] === "storage", "Unexpected Chrome API permission");
check(!manifest.permissions.includes("clipboardRead"), "The extension should not need broad clipboardRead permission");

existing(manifest.background.service_worker);
existing(manifest.options_ui.page);
for (const contentScript of manifest.content_scripts) {
  for (const file of [...(contentScript.js || []), ...(contentScript.css || [])]) {
    existing(file);
  }
}
for (const iconPath of Object.values(manifest.icons)) {
  existing(iconPath);
}

for (const size of [16, 32, 48, 128]) {
  const relativePath = manifest.icons[String(size)];
  const [width, height] = pngDimensions(relativePath);
  check(width === size && height === size, `${relativePath} must be ${size}x${size}, got ${width}x${height}`);
}

const optionsHtml = fs.readFileSync(path.join(root, manifest.options_ui.page), "utf8");
const scriptTags = [...optionsHtml.matchAll(/<script\b([^>]*)>/gi)];
check(scriptTags.length > 0, "options.html must load its scripts");
for (const match of scriptTags) {
  check(/\bsrc\s*=/.test(match[1]), "options.html contains an inline script, which Manifest V3 blocks");
}

const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
check(changelog.includes(`## [${manifest.version}]`), `CHANGELOG.md is missing ${manifest.version}`);
check(readme.includes("CasePaste"), "README.md is missing the product name");
check(readme.includes("[!TIP]") && readme.includes("<details>"), "README.md is missing its rich GitHub content");
check((readme.match(/<a href="#[^"]+">\s*<img /g) || []).length >= 4, "README.md must keep its clickable hero and navigation banners");
for (const match of readme.matchAll(/<img\s+src="\.\/([^"#]+)"/g)) {
  existing(match[1]);
}
check(packageJson.version === manifest.version, "package.json and manifest.json versions differ");
check(packageJson.description.length <= 160, "GitHub About description must stay within 160 characters");
check(Array.isArray(packageJson.keywords) && packageJson.keywords.length >= 5, "GitHub topic keywords are missing");

const javascriptFiles = [
  "src/core.js",
  "src/editor.js",
  "src/content.js",
  "src/page-bridge.js",
  "src/background.js",
  "options.js",
  "tests/background.test.js",
  "tests/core.test.js",
  "tests/editor.test.js",
  "tests/page-bridge.test.js",
  "scripts/check-project.js"
];
for (const relativePath of javascriptFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relativePath)], { encoding: "utf8" });
  check(result.status === 0, `${relativePath} has invalid JavaScript: ${result.stderr.trim()}`);
}

if (failures.length) {
  console.error(`Project check failed with ${failures.length} problem${failures.length === 1 ? "" : "s"}:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`CasePaste ${manifest.version} passed manifest, asset, policy, documentation, and syntax checks.`);
}
