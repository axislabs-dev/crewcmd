import fs from "node:fs";
import path from "node:path";

const [, , manifestArg] = process.argv;

if (!manifestArg) {
  console.error("Usage: node scripts/mobile/validate-mobile-branding.mjs <path-to-org.mobile.json>");
  process.exit(1);
}

const manifestPath = path.resolve(process.cwd(), manifestArg);

function fail(message) {
  console.error(`Invalid mobile branding manifest: ${message}`);
  process.exit(1);
}

function ensureString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function ensureBoolean(value, label) {
  if (typeof value !== "boolean") {
    fail(`${label} must be a boolean`);
  }
}

function ensureHexColor(value, label) {
  ensureString(value, label);
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    fail(`${label} must be a 6-digit hex color`);
  }
}

function ensureRegex(value, label, regex) {
  ensureString(value, label);
  if (!regex.test(value)) {
    fail(`${label} is invalid`);
  }
}

function ensureFileExists(baseDir, relativePath, label) {
  ensureString(relativePath, label);
  const filePath = path.resolve(baseDir, relativePath);
  if (!fs.existsSync(filePath)) {
    fail(`${label} file does not exist: ${filePath}`);
  }
}

function ensureUrl(value, label) {
  ensureString(value, label);
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) {
      fail(`${label} must use http or https`);
    }
  } catch {
    fail(`${label} must be a valid URL`);
  }
}

const manifestDir = path.dirname(manifestPath);

if (!fs.existsSync(manifestPath)) {
  fail(`manifest not found: ${manifestPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const {
  app,
  branding,
  distribution,
  server,
  deepLinks,
  managedConfig
} = manifest;

if (!app || typeof app !== "object") fail("app section is required");
if (!branding || typeof branding !== "object") fail("branding section is required");
if (!distribution || typeof distribution !== "object") fail("distribution section is required");
if (!server || typeof server !== "object") fail("server section is required");
if (!deepLinks || typeof deepLinks !== "object") fail("deepLinks section is required");
if (!managedConfig || typeof managedConfig !== "object") fail("managedConfig section is required");

ensureRegex(app.slug, "app.slug", /^[a-z0-9-]+$/);
ensureString(app.displayName, "app.displayName");
if (app.displayName.length > 30) {
  fail("app.displayName must be 30 characters or fewer");
}
ensureRegex(app.iosBundleId, "app.iosBundleId", /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/);
ensureRegex(app.androidApplicationId, "app.androidApplicationId", /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/);

ensureString(branding.orgName, "branding.orgName");
ensureRegex(branding.profileId, "branding.profileId", /^[a-z0-9-]+$/);
ensureHexColor(branding.primaryColor, "branding.primaryColor");
ensureHexColor(branding.secondaryColor, "branding.secondaryColor");
ensureFileExists(manifestDir, branding.iconPath, "branding.iconPath");
ensureFileExists(manifestDir, branding.splashPath, "branding.splashPath");

ensureString(distribution.channel, "distribution.channel");
if (!["private-enterprise", "private-beta"].includes(distribution.channel)) {
  fail("distribution.channel must be private-enterprise or private-beta");
}
ensureString(distribution.managedMetadataLabel, "distribution.managedMetadataLabel");
if (!distribution.ios || typeof distribution.ios !== "object") {
  fail("distribution.ios section is required");
}
if (!distribution.android || typeof distribution.android !== "object") {
  fail("distribution.android section is required");
}
ensureString(distribution.ios.teamName, "distribution.ios.teamName");
ensureString(distribution.ios.distributionNote, "distribution.ios.distributionNote");
ensureString(distribution.android.distributionNote, "distribution.android.distributionNote");

ensureUrl(server.defaultBaseUrl, "server.defaultBaseUrl");
ensureString(server.bootstrapMode, "server.bootstrapMode");
if (!["qr-or-url", "url-only"].includes(server.bootstrapMode)) {
  fail("server.bootstrapMode must be qr-or-url or url-only");
}
ensureBoolean(server.lockToSingleServer, "server.lockToSingleServer");
ensureBoolean(server.tailscaleRequired, "server.tailscaleRequired");

ensureRegex(deepLinks.scheme, "deepLinks.scheme", /^[a-z][a-z0-9+.-]*$/);
ensureString(deepLinks.host, "deepLinks.host");

ensureBoolean(managedConfig.allowManualServerOverride, "managedConfig.allowManualServerOverride");
ensureRegex(managedConfig.supportEmail, "managedConfig.supportEmail", /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
ensureString(managedConfig.environmentLabel, "managedConfig.environmentLabel");

console.log(`Valid mobile branding manifest: ${manifestPath}`);
