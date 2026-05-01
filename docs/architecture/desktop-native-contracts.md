# Desktop Native Capability Contracts

> Status: Proposed
> Created: 2026-05-01

## Purpose

Define the first native boundary for the CrewCmd desktop shell. The desktop app
should add operating-system integration without moving product logic, runtime
control, authorization, or data ownership out of the CrewCmd server.

This contract follows the desktop shell ADR and assumes the first shell runs in
server URL mode.

## Contract Principles

- Native capabilities are opt-in and explicitly exposed through a typed bridge.
- The web app owns product workflows; the shell owns window and OS integration.
- The server remains the authority for auth, permissions, tasks, agents,
  runtimes, sessions, and team state.
- Bridge calls must return structured success or failure objects.
- Sensitive values must use OS-backed secure storage and must not be logged.

## Initial Bridge Surface

The first bridge should expose only these capability groups.

### App Metadata

Purpose: support diagnostics and environment-aware UI.

Methods:

- `desktop.app.getInfo()`

Returns:

- app version
- platform
- architecture
- release channel
- shell mode, initially `server-url`

### Server URL

Purpose: store and update the CrewCmd server target used by the shell.

Methods:

- `desktop.server.getUrl()`
- `desktop.server.setUrl(url)`
- `desktop.server.clearUrl()`

Rules:

- Accept only `https://`, `http://localhost`, and `http://127.0.0.1` targets by
  default.
- Treat any broader insecure HTTP support as a development-only override.
- Changing the server URL must clear server-scoped shell tokens and queued deep
  links.

### External Navigation

Purpose: keep untrusted or non-CrewCmd pages out of the shell window.

Methods:

- `desktop.shell.openExternal(url)`

Rules:

- Open external URLs in the system browser.
- Keep CrewCmd application routes inside the shell.
- Reject unsupported schemes by default.

### Notifications

Purpose: show server-authorized operational events through the OS notification
system.

Methods:

- `desktop.notifications.getPermission()`
- `desktop.notifications.requestPermission()`
- `desktop.notifications.show(payload)`

Payload fields:

- `id`
- `title`
- `body`
- `severity`
- `route`

Rules:

- Payloads should contain display text and a CrewCmd route only.
- Do not include secrets, full prompts, private files, or raw tool output.
- Clicking a notification should focus the shell and navigate to the route after
  server auth is satisfied.

### Deep Links

Purpose: route OS-level links into existing CrewCmd web routes.

Methods:

- `desktop.deepLinks.getPending()`
- `desktop.deepLinks.clearPending(id)`

Supported targets:

- task
- agent
- chat session
- inbox item
- approval request

Rules:

- Queue a pending link if the user is not authenticated yet.
- Never bypass server access checks.
- Unknown targets should open the app without navigation and record a
  non-sensitive diagnostic event.

### Secure Storage

Purpose: hold desktop-shell scoped secrets only.

Methods:

- `desktop.secureStorage.get(key)`
- `desktop.secureStorage.set(key, value)`
- `desktop.secureStorage.delete(key)`
- `desktop.secureStorage.clearServerScope(serverUrl)`

Allowed values:

- desktop notification subscription token
- desktop-specific refresh or device token, if the server introduces one
- non-portable encrypted shell state required by the OS integration

Disallowed values:

- primary user password
- OpenClaw runtime secrets
- provider API keys
- raw chat messages
- arbitrary agent workspace files

### Tray And Window

Purpose: provide shell controls without creating desktop-only workflows.

Methods:

- `desktop.window.focus()`
- `desktop.window.setBadge(count)`
- `desktop.tray.setStatus(status)`

Allowed tray actions:

- open or focus CrewCmd
- show configured server status
- open desktop settings
- quit

## Event Contract

Renderer event subscriptions should be narrow and revocable.

Events:

- `desktop:deep-link`
- `desktop:notification-click`
- `desktop:server-url-changed`
- `desktop:online-status-changed`
- `desktop:update-status-changed`

Each event payload must include:

- `id`
- `type`
- `createdAt`
- capability-specific `data`

Events must not include secrets or raw agent/tool payloads.

## Failure Shape

Bridge failures should use a consistent shape:

```ts
type DesktopBridgeFailure = {
  ok: false;
  code:
    | "unsupported_platform"
    | "permission_denied"
    | "invalid_input"
    | "secure_storage_unavailable"
    | "server_url_unset"
    | "native_error";
  message: string;
  retryable: boolean;
};
```

Successful calls should return `{ ok: true, data }`.

## Out Of Scope

- Direct database access from the shell
- Direct OpenClaw runtime launch, stop, upgrade, or supervision
- Desktop-only task, chat, agent, model, or skill semantics
- Local file access for agent context
- Runtime config mutation from native code
- Packaging, signing, auto-update implementation, or dependency selection

## Verification For First Implementation

- Bridge methods have TypeScript types shared by preload and renderer code.
- Invalid URLs, unsupported schemes, and denied permissions return structured
  failures.
- Notifications contain no sensitive payload fields.
- Deep links route to existing web routes and still require server auth.
- Secure storage fallbacks are documented before Linux release.
- The web build remains independent of desktop packaging.

## Open Questions

- Final deep-link scheme name, such as `crewcmd://`.
- Notification subscription transport and reconnection policy.
- Whether desktop-specific tokens are needed for notification delivery.
- Secure storage fallback policy for Linux environments without Secret Service.
- Update event payload shape once release engineering starts.
