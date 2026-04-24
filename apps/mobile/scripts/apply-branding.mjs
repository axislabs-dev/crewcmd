import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [, , manifestArgFromCli] = process.argv;
const manifestArg = manifestArgFromCli || process.env.CREWCMD_MOBILE_MANIFEST;
const outputDirName = process.env.CREWCMD_MOBILE_OUTPUT_DIR || ".generated";

if (!manifestArg) {
  console.error("Usage: node scripts/apply-branding.mjs <path-to-org.mobile.json>");
  process.exit(1);
}

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const repoRoot = path.resolve(appDir, "..", "..");
const manifestPath = path.resolve(appDir, manifestArg);

if (!fs.existsSync(manifestPath)) {
  console.error(`Branding manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const generatedDir = path.join(appDir, outputDirName);
fs.mkdirSync(generatedDir, { recursive: true });
const channel = process.env.CREWCMD_MOBILE_CHANNEL || manifest.distribution.channel;
const iconSourcePath = path.resolve(path.dirname(manifestPath), manifest.branding.iconPath);

async function writeIosAppIcons() {
  const iosAppDir = path.join(appDir, "ios", "App", "App");
  if (!fs.existsSync(iosAppDir)) {
    return;
  }

  if (!fs.existsSync(iconSourcePath)) {
    throw new Error(`Mobile icon source not found: ${iconSourcePath}`);
  }

  const assetCatalogDir = path.join(iosAppDir, "Assets.xcassets");
  const appIconSetDir = path.join(assetCatalogDir, "AppIcon.appiconset");
  fs.mkdirSync(appIconSetDir, { recursive: true });

  const iconFilename = "AppIcon-512@2x.png";
  const iconOutputPath = path.join(appIconSetDir, iconFilename);

  await sharp(iconSourcePath)
    .resize(1024, 1024, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(iconOutputPath);

  const contents = {
    images: [
      {
        filename: iconFilename,
        idiom: "universal",
        platform: "ios",
        size: "1024x1024",
      },
    ],
    info: {
      author: "xcode",
      version: 1,
    },
  };

  fs.writeFileSync(path.join(appIconSetDir, "Contents.json"), `${JSON.stringify(contents, null, 2)}\n`);
}

const runtimeConfig = {
  app: manifest.app,
  branding: manifest.branding,
  distribution: {
    ...manifest.distribution,
    channel
  },
  server: manifest.server,
  deepLinks: manifest.deepLinks,
  managedConfig: manifest.managedConfig,
  generatedAt: new Date().toISOString()
};

fs.writeFileSync(
  path.join(generatedDir, "mobile-runtime.json"),
  `${JSON.stringify(runtimeConfig, null, 2)}\n`
);

const capacitorConfig = {
  appId: manifest.app.iosBundleId,
  appName: manifest.app.displayName,
  webDir: "web",
  bundledWebRuntime: false,
  server: {
    "androidScheme": "https"
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: manifest.branding.primaryColor,
      showSpinner: false
    },
    StatusBar: {
      style: "dark",
      backgroundColor: "#020405"
    }
  }
};

fs.writeFileSync(
  path.join(generatedDir, "capacitor.config.generated.json"),
  `${JSON.stringify(capacitorConfig, null, 2)}\n`
);

const nativeMetadata = `# Mobile Distribution Metadata

Display name: ${manifest.app.displayName}
iOS bundle ID: ${manifest.app.iosBundleId}
Android application ID: ${manifest.app.androidApplicationId}
Managed label: ${manifest.distribution.managedMetadataLabel}
Build channel: ${channel}
Default server URL: ${manifest.server.defaultBaseUrl}
Bootstrap mode: ${manifest.server.bootstrapMode}
Manual server override allowed: ${manifest.managedConfig.allowManualServerOverride ? "yes" : "no"}
Tailscale required: ${manifest.server.tailscaleRequired ? "yes" : "no"}

## iOS

Team / owner: ${manifest.distribution.ios.teamName}
Distribution note: ${manifest.distribution.ios.distributionNote}

## Android

Distribution note: ${manifest.distribution.android.distributionNote}
`;

fs.writeFileSync(path.join(generatedDir, "distribution-summary.md"), nativeMetadata);

const webConfig = {
  displayName: manifest.app.displayName,
  orgName: manifest.branding.orgName,
  profileId: manifest.branding.profileId,
  primaryColor: manifest.branding.primaryColor,
  secondaryColor: manifest.branding.secondaryColor,
  defaultBaseUrl: manifest.server.defaultBaseUrl,
  bootstrapMode: manifest.server.bootstrapMode,
  lockToSingleServer: manifest.server.lockToSingleServer,
  tailscaleRequired: manifest.server.tailscaleRequired,
  allowManualServerOverride: manifest.managedConfig.allowManualServerOverride,
  supportEmail: manifest.managedConfig.supportEmail,
  environmentLabel: manifest.managedConfig.environmentLabel,
  deepLinkScheme: manifest.deepLinks.scheme,
  deepLinkHost: manifest.deepLinks.host,
  iconPath: path.relative(path.join(appDir, "web"), path.resolve(path.dirname(manifestPath), manifest.branding.iconPath)),
  splashPath: path.relative(path.join(appDir, "web"), path.resolve(path.dirname(manifestPath), manifest.branding.splashPath))
};

fs.writeFileSync(
  path.join(appDir, "web", "brand.generated.json"),
  `${JSON.stringify(webConfig, null, 2)}\n`
);

await writeIosAppIcons();

console.log(`Applied mobile branding manifest from ${path.relative(repoRoot, manifestPath)}`);
