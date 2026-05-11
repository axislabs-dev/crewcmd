import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
const iconLightSourcePath = resolveOptionalBrandingAsset("iconLightPath", iconSourcePath, "light");
const iconDarkSourcePath = resolveOptionalBrandingAsset("iconDarkPath", iconSourcePath, "dark");
const splashSourcePath = path.resolve(path.dirname(manifestPath), manifest.branding.splashPath);
const defaultBaseUrl = parseDefaultBaseUrl(manifest.server.defaultBaseUrl);
const allowedNavigationHost = defaultBaseUrl.hostname;
const pushConfig = normalizePushConfig(manifest.push);

function writeJsonFile(targetPath, value) {
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseDefaultBaseUrl(value) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`server.defaultBaseUrl must be a full URL including http:// or https://. Received: ${value}`);
  }
}

function requireSourceFile(sourcePath, label) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`${label} source not found: ${sourcePath}`);
  }
}

function resolveOptionalBrandingAsset(manifestKey, fallbackSourcePath, suffix) {
  const manifestValue = manifest.branding[manifestKey];
  if (manifestValue) {
    return path.resolve(path.dirname(manifestPath), manifestValue);
  }

  const parsedPath = path.parse(fallbackSourcePath);
  const siblingPath = path.join(parsedPath.dir, `${parsedPath.name}-${suffix}${parsedPath.ext}`);
  return fs.existsSync(siblingPath) ? siblingPath : null;
}

function copyWebBrandAsset(sourcePath, outputName) {
  requireSourceFile(sourcePath, outputName);

  const extension = path.extname(sourcePath) || ".svg";
  const webGeneratedDir = path.join(appDir, "web", ".generated", "branding");
  const outputFile = `${outputName}${extension}`;
  const outputPath = path.join(webGeneratedDir, outputFile);

  fs.mkdirSync(webGeneratedDir, { recursive: true });
  fs.copyFileSync(sourcePath, outputPath);

  return `./.generated/branding/${outputFile}`;
}

function normalizePushConfig(value) {
  if (!value || typeof value !== "object") {
    return { enabled: false };
  }

  return {
    enabled: value.enabled === true,
    ios: {
      apnsEnvironment: value.ios?.apnsEnvironment === "sandbox" ? "sandbox" : "production",
    },
    android: {
      firebaseProjectId: typeof value.android?.firebaseProjectId === "string"
        ? value.android.firebaseProjectId
        : null,
    },
  };
}

async function writeIosAppIcons() {
  const iosAppDir = path.join(appDir, "ios", "App", "App");
  if (!fs.existsSync(iosAppDir)) {
    return;
  }

  requireSourceFile(iconSourcePath, "Mobile icon");

  const assetCatalogDir = path.join(iosAppDir, "Assets.xcassets");
  const appIconSetDir = path.join(assetCatalogDir, "AppIcon.appiconset");
  fs.mkdirSync(appIconSetDir, { recursive: true });

  const defaultIconSourcePath = iconLightSourcePath || iconSourcePath;
  const iconSources = [
    { filename: "AppIcon-512@2x.png", sourcePath: defaultIconSourcePath },
    { filename: "AppIcon-Light-512@2x.png", sourcePath: iconLightSourcePath, luminosity: "light" },
    { filename: "AppIcon-Dark-512@2x.png", sourcePath: iconDarkSourcePath, luminosity: "dark" },
  ].filter((icon) => icon.sourcePath);

  for (const icon of iconSources) {
    await sharp(icon.sourcePath)
      .resize(1024, 1024, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(path.join(appIconSetDir, icon.filename));
  }

  writeJsonFile(path.join(appIconSetDir, "Contents.json"), {
    images: iconSources.map((icon) => ({
      filename: icon.filename,
      idiom: "universal",
      platform: "ios",
      size: "1024x1024",
      ...(icon.luminosity
        ? {
            appearances: [
              {
                appearance: "luminosity",
                value: icon.luminosity,
              },
            ],
          }
        : {}),
    })),
    info: {
      author: "xcode",
      version: 1,
    },
  });
}

async function writeIosSplashAssets() {
  const iosAppDir = path.join(appDir, "ios", "App", "App");
  if (!fs.existsSync(iosAppDir)) {
    return;
  }

  requireSourceFile(splashSourcePath, "Mobile splash");

  const assetCatalogDir = path.join(iosAppDir, "Assets.xcassets");
  const splashSetDir = path.join(assetCatalogDir, "Splash.imageset");
  fs.mkdirSync(splashSetDir, { recursive: true });

  const splashFiles = [
    "splash-2732x2732.png",
    "splash-2732x2732-1.png",
    "splash-2732x2732-2.png",
  ];

  const splashBuffer = await sharp(splashSourcePath)
    .resize(2732, 2732, {
      fit: "cover",
      background: manifest.branding.primaryColor,
    })
    .png()
    .toBuffer();

  for (const filename of splashFiles) {
    fs.writeFileSync(path.join(splashSetDir, filename), splashBuffer);
  }

  writeJsonFile(path.join(splashSetDir, "Contents.json"), {
    images: [
      { idiom: "universal", filename: "splash-2732x2732-2.png", scale: "1x" },
      { idiom: "universal", filename: "splash-2732x2732-1.png", scale: "2x" },
      { idiom: "universal", filename: "splash-2732x2732.png", scale: "3x" },
    ],
    info: {
      version: 1,
      author: "xcode",
    },
  });

  ensureIosLaunchScreenAspectFit(iosAppDir);
}

function ensureIosLaunchScreenAspectFit(iosAppDir) {
  const storyboardPath = path.join(iosAppDir, "Base.lproj", "LaunchScreen.storyboard");
  if (!fs.existsSync(storyboardPath)) {
    return;
  }

  let storyboard = fs.readFileSync(storyboardPath, "utf8");
  storyboard = storyboard.replace(/contentMode="scaleAspectFill"/g, 'contentMode="scaleAspectFit"');
  storyboard = storyboard.replace(
    /<color key="backgroundColor" systemColor="systemBackgroundColor"\/>/g,
    '<color key="backgroundColor" red="0.03921568627" green="0.03921568627" blue="0.04705882353" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>',
  );

  fs.writeFileSync(storyboardPath, storyboard);
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
  push: pushConfig,
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
    "androidScheme": "https",
    allowNavigation: [allowedNavigationHost],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: manifest.branding.primaryColor,
      showSpinner: false
    },
    ...(pushConfig.enabled
      ? {
          PushNotifications: {
            presentationOptions: ["badge", "sound", "alert"],
          },
        }
      : {}),
  }
};

writeJsonFile(path.join(appDir, "capacitor.config.json"), capacitorConfig);
writeJsonFile(path.join(generatedDir, "capacitor.config.generated.json"), capacitorConfig);

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
Push notifications: ${pushConfig.enabled ? "enabled" : "disabled"}

## iOS

Team / owner: ${manifest.distribution.ios.teamName}
Distribution note: ${manifest.distribution.ios.distributionNote}
${pushConfig.enabled ? `APNs environment: ${pushConfig.ios.apnsEnvironment}
Server env:
- CREWCMD_PUSH_ENABLED=true
- CREWCMD_PUSH_APNS_BUNDLE_ID=${manifest.app.iosBundleId}
- CREWCMD_PUSH_APNS_ENV=${pushConfig.ios.apnsEnvironment}
- CREWCMD_PUSH_APNS_TEAM_ID=<Apple Developer Team ID>
- CREWCMD_PUSH_APNS_KEY_ID=<APNs auth key ID>
- CREWCMD_PUSH_APNS_PRIVATE_KEY=<APNs auth private key>
Native requirement: enable the Push Notifications capability on the signed iOS target.
` : ""}

## Android

Distribution note: ${manifest.distribution.android.distributionNote}
${pushConfig.enabled ? `Firebase project ID: ${pushConfig.android.firebaseProjectId || "<set in Firebase>"}
Server env:
- CREWCMD_PUSH_ENABLED=true
- CREWCMD_PUSH_FCM_SERVICE_ACCOUNT_JSON=<Firebase service account JSON>
Native requirement: add google-services.json for ${manifest.app.androidApplicationId} before building.
` : ""}
`;

fs.writeFileSync(path.join(generatedDir, "distribution-summary.md"), nativeMetadata);

const webBrandAssets = {
  iconPath: copyWebBrandAsset(iconSourcePath, "icon"),
  iconLightPath: iconLightSourcePath ? copyWebBrandAsset(iconLightSourcePath, "icon-light") : null,
  iconDarkPath: iconDarkSourcePath ? copyWebBrandAsset(iconDarkSourcePath, "icon-dark") : null,
  splashPath: copyWebBrandAsset(splashSourcePath, "splash")
};

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
  iconPath: webBrandAssets.iconPath,
  iconLightPath: webBrandAssets.iconLightPath,
  iconDarkPath: webBrandAssets.iconDarkPath,
  splashPath: webBrandAssets.splashPath
};

fs.writeFileSync(
  path.join(appDir, "web", "brand.generated.json"),
  `${JSON.stringify(webConfig, null, 2)}\n`
);

await writeIosAppIcons();
await writeIosSplashAssets();

const iosAudioSessionResult = spawnSync(process.execPath, [path.join(appDir, "scripts", "ensure-ios-audio-session.mjs")], {
  cwd: appDir,
  stdio: "inherit",
  env: process.env,
});
if (iosAudioSessionResult.status !== 0) {
  throw new Error("Unable to apply iOS audio-session configuration.");
}

const iosVoiceSessionResult = spawnSync(process.execPath, [path.join(appDir, "scripts", "ensure-ios-voice-session.mjs")], {
  cwd: appDir,
  stdio: "inherit",
  env: process.env,
});
if (iosVoiceSessionResult.status !== 0) {
  throw new Error("Unable to apply iOS voice-session plugin configuration.");
}

console.log(`Applied mobile branding manifest from ${path.relative(repoRoot, manifestPath)}`);
