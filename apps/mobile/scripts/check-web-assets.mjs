import fs from "node:fs";
import path from "node:path";

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const requiredFiles = [
  "capacitor.config.json",
  "web/index.html",
  "web/app.js",
  "web/styles.css"
];

for (const file of requiredFiles) {
  const target = path.join(appDir, file);
  if (!fs.existsSync(target)) {
    console.error(`Missing required mobile asset: ${target}`);
    process.exit(1);
  }
}

console.log("Mobile web assets are present.");
