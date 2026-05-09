import fs from "node:fs";
import path from "node:path";

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const iosAppDir = path.join(appDir, "ios", "App", "App");
const infoPlistPath = path.join(iosAppDir, "Info.plist");
const appDelegatePath = path.join(iosAppDir, "AppDelegate.swift");
const generatedDir = path.join(appDir, process.env.CREWCMD_MOBILE_OUTPUT_DIR || ".generated");

const MICROPHONE_USAGE = "CrewCmd uses the microphone for hands-free agent mode voice conversations.";
const AUDIO_SESSION_MARKER = "// CREWCMD_AUDIO_SESSION";

function insertBeforeDictEnd(plist, entry) {
  const closingIndex = plist.lastIndexOf("</dict>");
  if (closingIndex === -1) {
    throw new Error("Info.plist does not contain a closing </dict> tag.");
  }
  return `${plist.slice(0, closingIndex)}${entry}\n${plist.slice(closingIndex)}`;
}

function ensureStringKey(plist, key, value) {
  const keyPattern = new RegExp(`<key>${key}</key>\\s*<string>[^<]*</string>`);
  const entry = `\t<key>${key}</key>\n\t<string>${value}</string>`;
  if (keyPattern.test(plist)) {
    return plist.replace(keyPattern, entry);
  }
  if (plist.includes(`<key>${key}</key>`)) {
    return plist;
  }
  return insertBeforeDictEnd(plist, `${entry}\n`);
}

function ensureBackgroundAudioMode(plist) {
  const keyPattern = /<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/;
  const match = plist.match(keyPattern);
  if (!match) {
    return insertBeforeDictEnd(
      plist,
      "\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>audio</string>\n\t</array>\n",
    );
  }

  if (match[1].includes("<string>audio</string>")) {
    return plist;
  }

  const replacement = match[0].replace("</array>", "\t\t<string>audio</string>\n\t</array>");
  return plist.replace(match[0], replacement);
}

function ensureInfoPlist() {
  if (!fs.existsSync(infoPlistPath)) {
    return false;
  }

  let plist = fs.readFileSync(infoPlistPath, "utf8");
  plist = ensureStringKey(plist, "NSMicrophoneUsageDescription", MICROPHONE_USAGE);
  plist = ensureBackgroundAudioMode(plist);
  fs.writeFileSync(infoPlistPath, plist);
  return true;
}

function ensureAppDelegateAudioSession() {
  if (!fs.existsSync(appDelegatePath)) {
    return false;
  }

  let source = fs.readFileSync(appDelegatePath, "utf8");
  if (!source.includes("import AVFoundation")) {
    if (source.includes("import UIKit\n")) {
      source = source.replace("import UIKit\n", "import UIKit\nimport AVFoundation\n");
    } else {
      source = `import AVFoundation\n${source}`;
    }
  }

  if (!source.includes(AUDIO_SESSION_MARKER)) {
    const method = `

    ${AUDIO_SESSION_MARKER}
    private func configureCrewCmdAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try session.setActive(true)
        } catch {
            NSLog("CrewCmd audio session configuration failed: \\(error.localizedDescription)")
        }
    }
`;
    const classClosingIndex = source.lastIndexOf("}\n");
    if (classClosingIndex === -1) {
      throw new Error("AppDelegate.swift does not look like a Swift class file.");
    }
    source = `${source.slice(0, classClosingIndex)}${method}${source.slice(classClosingIndex)}`;
  }

  if (!/^\s{8}configureCrewCmdAudioSession\(\)$/m.test(source)) {
    const launchPattern = /(func application\(_ application: UIApplication,\s*didFinishLaunchingWithOptions launchOptions: \[UIApplication\.LaunchOptionsKey: Any\]\?\) -> Bool \{\n)/;
    if (!launchPattern.test(source)) {
      throw new Error("AppDelegate.swift does not contain the expected application(_:didFinishLaunchingWithOptions:) method.");
    }
    source = source.replace(launchPattern, (match) => `${match}        configureCrewCmdAudioSession()\n`);
  }

  fs.writeFileSync(appDelegatePath, source);
  return true;
}

const infoPlistUpdated = ensureInfoPlist();
const appDelegateUpdated = ensureAppDelegateAudioSession();

fs.mkdirSync(generatedDir, { recursive: true });
fs.writeFileSync(
  path.join(generatedDir, "ios-audio-session.json"),
  `${JSON.stringify(
    {
      infoPlistPath: fs.existsSync(infoPlistPath) ? path.relative(appDir, infoPlistPath) : null,
      appDelegatePath: fs.existsSync(appDelegatePath) ? path.relative(appDir, appDelegatePath) : null,
      microphoneUsageDescription: MICROPHONE_USAGE,
      backgroundModes: ["audio"],
      audioSession: {
        category: "playAndRecord",
        mode: "voiceChat",
        options: ["allowBluetooth", "allowBluetoothA2DP", "defaultToSpeaker"],
      },
      applied: {
        infoPlist: infoPlistUpdated,
        appDelegate: appDelegateUpdated,
      },
    },
    null,
    2,
  )}\n`,
);

if (infoPlistUpdated || appDelegateUpdated) {
  console.log("Ensured iOS microphone permission, background audio mode, and AVAudioSession defaults.");
} else {
  console.log("No iOS native project found; wrote requested iOS audio-session metadata only.");
}
