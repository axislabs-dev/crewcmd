# CrewCmd Mobile Self-Distribution

CrewCmd Mobile is a Capacitor-based shell for self-hosted deployments that need private distribution to staff on iOS and Android.

## Architecture

- `apps/mobile/` contains the Capacitor shell.
- `docs/examples/mobile/org.mobile.example.json` is the white-label manifest contract.
- `docs/examples/mobile/bootstrap-payload.example.json` is the first-run bootstrap payload contract.
- the mobile shell stores bootstrap data locally and opens the self-hosted CrewCmd deployment with the existing web auth/session flow
- Tailscale is treated as a device/network prerequisite, not an embedded SDK concern

## White-Label Build Flow

1. Copy `docs/examples/mobile/org.mobile.example.json` to your own `org.mobile.json`.
2. Replace display name, colors, icon, splash asset, bundle identifiers, and default server URL.
3. Validate the manifest:

```bash
pnpm mobile:validate-branding path/to/org.mobile.json
```

4. Apply branding into the mobile shell:

```bash
cd apps/mobile
CREWCMD_MOBILE_MANIFEST=../../path/to/org.mobile.json pnpm brand:manifest
```

Optional environment variables:

- `CREWCMD_MOBILE_CHANNEL`: override the effective distribution channel without editing the manifest
- `CREWCMD_MOBILE_OUTPUT_DIR`: change where generated metadata is written

Generated output:

- `.generated/mobile-runtime.json`: runtime config used by internal tooling
- `.generated/capacitor.config.generated.json`: generated native metadata reference
- `.generated/distribution-summary.md`: operator-facing deployment summary
- `web/brand.generated.json`: mobile shell runtime branding

## Bootstrap Contract

The mobile shell supports two bootstrap inputs:

- a deep link like `crewcmd://bootstrap?payload=...`
- a pasted JSON payload matching `docs/examples/mobile/bootstrap-payload.example.json`

Expected payload fields:

- `orgName`
- `profileId`
- `serverUrl`
- `environmentLabel`
- `lockToSingleServer`
- `tailscaleRequired`
- `branding.displayName`
- `branding.primaryColor`
- `branding.secondaryColor`
- `support.email`

Generate an encoded bootstrap link:

```bash
pnpm mobile:bootstrap-url docs/examples/mobile/bootstrap-payload.example.json
```

## Network and Auth Expectations

- the mobile app does not implement Tailscale itself
- the device must already have network access to the CrewCmd server
- tailnet-only deployments should instruct staff to install and sign into Tailscale first
- the shell opens the self-hosted CrewCmd `/chat` surface and relies on existing web auth/session behavior
- native push delivery uses Apple Push Notification service and Firebase Cloud Messaging from the self-hosted CrewCmd server; the phone still needs Tailscale or LAN reachability when the user taps the notification and returns to CrewCmd

## Native Push Notifications

CrewCmd can notify the prompting mobile user when an agent finishes after the Capacitor app is backgrounded, locked, or disconnected. Delivery is server-side and self-hosted: CrewCmd stores device tokens for the logged-in user and sends directly to APNs or FCM when the agent reply is persisted.

Server configuration:

```bash
CREWCMD_PUSH_ENABLED=true

# Android / Firebase Cloud Messaging HTTP v1
CREWCMD_PUSH_FCM_SERVICE_ACCOUNT_JSON='{"project_id":"...","client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"}'

# iOS / APNs token auth
CREWCMD_PUSH_APNS_TEAM_ID="..."
CREWCMD_PUSH_APNS_KEY_ID="..."
CREWCMD_PUSH_APNS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
CREWCMD_PUSH_APNS_BUNDLE_ID="com.example.crewcmd"
CREWCMD_PUSH_APNS_ENV="production"
```

iOS requirements:

- enable the Push Notifications capability on the signed Capacitor target
- use an APNs auth key owned by the Apple Developer team that signs the app
- set `CREWCMD_PUSH_APNS_BUNDLE_ID` to the app bundle identifier from the mobile manifest
- use `sandbox` for development builds and `production` for distributed builds

Android requirements:

- create a Firebase project for the self-hosted organization
- add the app's `google-services.json` to the native Android app module before building
- set `CREWCMD_PUSH_FCM_SERVICE_ACCOUNT_JSON` from a Firebase service account with FCM send permission

Operational notes:

- push credentials stay on the CrewCmd server and are never sent to the mobile client
- missing or invalid push configuration skips notification delivery but does not fail chat
- fully offline environments cannot receive OS remote push notifications because APNs/FCM require internet reachability; users will still see persisted chat replies after reconnecting to CrewCmd
- notification tap opens `/chat?agent=<agent>&session=<sessionId>` on the configured CrewCmd server

## Distribution Readiness

### iOS

- set a unique bundle identifier
- confirm the display name fits home-screen limits
- generate org-specific icons and splash assets
- sign with the organization's Apple Developer / Apple Business Manager account
- distribute through Custom Apps in Apple Business Manager or via MDM
- define a support owner for certificate and provisioning renewal

### Android

- set a unique application ID
- sign with the organization's upload/signing key
- prepare Managed Google Play private app metadata
- decide whether distribution is via Managed Google Play or direct MDM APK rollout
- define update ownership and device policy scope

### MDM / Managed App Config

- publish bootstrap/deployment metadata as managed configuration where possible
- keep `allowManualServerOverride` disabled for locked enterprise builds
- document the expected support contact and environment label
- test app install, bootstrap, Tailscale reachability, auth, and deep-link open on a clean device

## Stable Mobile Entry Points

- `crewcmd://bootstrap?payload=...`: bootstrap configuration intake
- `<server>/chat`: primary mobile handoff for chat and voice mode
- `<server>/api/health`: server health probe used by the shell

## Suggested Validation

- validate two different org manifests against the schema
- generate two branded outputs from the same codebase
- test bootstrap by pasted JSON and deep link
- test a tailnet-only URL with Tailscale disconnected and connected
- verify chat and voice mode load after login
