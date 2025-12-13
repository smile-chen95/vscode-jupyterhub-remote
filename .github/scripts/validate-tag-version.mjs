import fs from "node:fs";

function normalizeVersion(value) {
  if (value == null) return "";
  let v = String(value).trim();
  v = v.replace(/^refs\/tags\//, "");
  v = v.replace(/^v/, "");
  return v.trim();
}

function parseSemver(value) {
  const v = normalizeVersion(value);
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!match) {
    throw new Error(`Invalid semver: ${JSON.stringify(v)}`);
  }
  return match.slice(1).map(Number);
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

const tagRaw = process.env.TAG_VERSION ?? process.env.GITHUB_REF_NAME ?? "";
const pkgVersionRaw =
  process.env.PKG_VERSION ??
  JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

const tag = normalizeVersion(tagRaw);
const pkg = normalizeVersion(pkgVersionRaw);

const tagParsed = parseSemver(tag);
const pkgParsed = parseSemver(pkg);

if (compareSemver(tagParsed, pkgParsed) < 0) {
  throw new Error(`Tag version (${tag}) must be >= package.json version (${pkg}).`);
}

console.log(`Version check OK: tag=${tag}, package.json=${pkg}`);

