# CrewCmd Mobile

This is the mobile shell for self-hosted and enterprise-distributed CrewCmd deployments.

## Goals

- support iOS and Android via Capacitor
- brand each build from a manifest instead of hand-editing native files
- bootstrap server configuration by QR or signed deep link
- reuse existing CrewCmd web auth and session flows
- keep Tailscale reachability as a device/network concern rather than an in-app VPN concern

## Workflow

1. Validate or create an org branding manifest.
2. Apply the manifest to generate mobile runtime and native metadata stubs.
3. Sync the Capacitor project.
4. Build and sign with the organization's own Apple/Google enterprise process.

## Commands

```bash
cd apps/mobile
pnpm install
pnpm brand:manifest ../../docs/examples/mobile/org.mobile.example.json
pnpm check
pnpm sync
```

Generated branding output is written to `.generated/` and is intentionally ignored by git.

When an iOS Capacitor project already exists under `apps/mobile/ios`, the branding step also:

- renders the manifest icon into `Assets.xcassets/AppIcon.appiconset/` so Xcode picks up the branded home-screen icon automatically
- renders the manifest splash artwork into `Assets.xcassets/Splash.imageset/`
- rewrites `capacitor.config.json` with the branded app name, splash color, and `allowNavigation` host derived from the configured CrewCmd base URL
- ensures `Info.plist` contains `NSMicrophoneUsageDescription` and `UIBackgroundModes = audio`
- configures the iOS app delegate to start CrewCmd with an `AVAudioSession` category of `playAndRecord`, `voiceChat` mode, Bluetooth support, and default speaker output

You can re-run just the native audio-session guard with:

```bash
pnpm ios:audio-session
```

The script is idempotent. If the iOS project has not been generated yet, it records the intended native audio-session contract in `.generated/ios-audio-session.json` so the next branding/sync pass can apply it.
