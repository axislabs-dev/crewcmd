import fs from "node:fs";
import path from "node:path";

const [, , payloadArg] = process.argv;

if (!payloadArg) {
  console.error("Usage: node scripts/mobile/build-bootstrap-url.mjs <bootstrap-payload.json>");
  process.exit(1);
}

const payloadPath = path.resolve(process.cwd(), payloadArg);

if (!fs.existsSync(payloadPath)) {
  console.error(`Bootstrap payload not found: ${payloadPath}`);
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

const result = {
  deepLink: `crewcmd://bootstrap?payload=${encoded}`,
  webLink: `https://mobile-bootstrap.invalid/crewcmd?payload=${encoded}`
};

console.log(JSON.stringify(result, null, 2));
