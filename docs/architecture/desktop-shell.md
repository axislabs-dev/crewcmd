# Desktop Shell Architecture ADR

> Status: Proposed
> Created: 2026-05-01

## Context

CrewCmd's primary product surface is the existing Next.js web application. The
desktop roadmap calls for a lightweight shell first, with hosted or self-hosted
server connectivity before any bundled local runtime mode. The repository also
contains mobile distribution examples and runtime connection plans, but no
desktop application code, packaging configuration, or native dependency choice
yet.

This ADR defines the first desktop shell boundary. It intentionally avoids
desktop code, packaging scripts, dependencies, and runtime bundling.

## Decision

Build the first CrewCmd desktop shell with Electron unless a later technical
spike finds repo-specific blockers that outweigh its release and integration
maturity.

Electron is the default recommendation because it fits the current product
shape:

- CrewCmd is already a Next.js application, so the first shell can load the
  existing web UI without duplicating product logic.
- Native desktop value is mostly shell-level integration: notifications, tray
  behavior, deep links, secure storage, window lifecycle, update flow, and
  signing.
- Electron has established support for auto-update, code signing,
  notarization, custom protocol handlers, system tray APIs, and mature
  cross-platform packaging.
- The initial shell needs predictable delivery more than a minimal binary size.

Tauri remains a reasonable future candidate if the project later prioritizes
smaller bundles or Rust-native integration and can absorb the additional
frontend/runtime constraints. There is no current repository evidence strong
enough to make Tauri the default first choice.

## Runtime Modes

### Server URL Mode

The first shell should run in server URL mode:

1. The shell stores a configured CrewCmd server URL.
2. The shell opens that URL in a constrained desktop window.
3. Authentication, routing, permissions, org membership, tasks, agents, and
   runtime management remain server-owned.
4. Desktop-specific state stays minimal: server URL, window preferences,
   notification permissions, deep-link pending URL, and optional shell-scoped
   tokens.

Supported server targets should include:

- hosted CrewCmd
- self-hosted CrewCmd
- local dev server, such as `http://localhost:3000`

The shell should not fork application routes, API behavior, database access, or
agent orchestration logic.

### Future Local Bundled Mode

A future bundled mode may supervise a local CrewCmd server process and connect
the shell to it. That mode needs a separate ADR before implementation because
it changes data ownership, backup behavior, update semantics, local database
storage, crash recovery, and migration paths from local-only use to a team
server.

The first shell should reserve a runtime mode abstraction, but only implement
server URL mode.

## Auth Assumptions

Authentication should remain the responsibility of the CrewCmd server.

The shell should support standard browser-based auth flows in the embedded
window, including redirects and session cookies issued by the server. It should
not mint CrewCmd sessions, store primary user passwords, or bypass server-side
authorization checks.

Shell-level storage may hold only desktop-specific values needed to reconnect
or resume UX. Any token persisted by the shell must be scoped to desktop shell
needs, revocable, and treated as sensitive local secret material.

If deep links or notifications reference protected resources, the server must
still enforce access after the shell navigates to the target route.

## Native Boundary

The desktop native boundary should stay narrow and explicit. The renderer may
request native capabilities through a typed bridge, but product workflows and
domain decisions should stay in the web app and server.

Initial native capabilities:

- read and write the configured server URL
- open external URLs in the system browser
- register and handle CrewCmd deep links
- create system notifications for server-provided events
- manage tray/menu actions
- expose app version and platform metadata for diagnostics
- store shell-scoped secrets in OS-backed secure storage

Out of scope for the first shell:

- direct database access
- direct OpenClaw runtime control
- executing agent processes
- reading arbitrary local files for agent context
- duplicating server authorization decisions
- desktop-only workflow semantics

## Notifications, Tray, and Deep Links

Desktop notifications should be event-driven from the CrewCmd server. The shell
may subscribe to an authenticated server channel for inbox items, agent state
changes, approval requests, and task completion events. Notification payloads
should contain only the minimum display text and a server route or deep-link
target.

Tray behavior should provide shell controls only:

- open or focus CrewCmd
- show connection status for the configured server
- switch server URL or open settings
- quit the app

Deep links should map into existing CrewCmd web routes for tasks, agents,
companies, and chat sessions. The shell can normalize and queue an incoming
deep link while auth completes, but final access remains server-enforced.

## Secure Storage Constraints

Use OS-backed secure storage for secrets, such as Keychain on macOS,
Credential Manager on Windows, and Secret Service or a documented fallback on
Linux.

Do not store sensitive values in plaintext config files, localStorage, logs,
crash reports, or update metadata. Non-secret preferences such as last window
bounds may use regular app config storage.

The secure storage model must account for:

- per-user desktop profiles
- logout clearing shell-scoped tokens
- server URL changes invalidating related tokens
- failed secure storage availability on Linux desktops
- support diagnostics that do not expose secrets

## Update and Signing Assumptions

The first releasable shell should assume signed builds and an update channel,
even if packaging is implemented in a later PR.

Release engineering should define:

- macOS Developer ID signing and notarization
- Windows code signing
- Linux package format and update expectations
- separate stable, beta, and internal update channels if needed
- update metadata served over HTTPS
- rollback behavior for failed updates

Unsigned local development builds are acceptable for development only. Public
desktop distribution should not depend on users disabling platform security
controls.

## No OpenClaw Runtime Bundling In The First Shell

Do not bundle the OpenClaw runtime in the first desktop shell.

Reasons:

- The existing roadmap prioritizes chat reliability, gateway management, and
  model management before bundled runtime work.
- Runtime bundling would introduce process supervision, local permissions,
  data location, upgrades, diagnostics, and failure recovery into the first
  desktop release.
- A bundled runtime risks creating a second operational model that behaves
  differently from hosted and self-hosted CrewCmd.
- CrewCmd already has a server-owned runtime management direction; the desktop
  shell should reuse it instead of creating desktop-only runtime semantics.

The first shell may help users connect to a local OpenClaw gateway through the
same server-managed flows used by the web app. It should not install, launch,
upgrade, or own the OpenClaw runtime.

## Consequences

Positive:

- Desktop work can start without forking the CrewCmd product surface.
- Native integration is limited to user-visible desktop value.
- Auth, authorization, orchestration, and data ownership remain server-owned.
- Later local bundled mode can be evaluated with clearer operational
  requirements.

Negative:

- The first desktop app depends on a reachable CrewCmd server.
- Electron has a larger binary and memory footprint than lighter shell
  options.
- Offline local-first usage is deferred.

## Follow-Up Decisions

- Packaging layout and app folder structure
- Desktop bridge API shape
- Notification subscription transport
- Deep-link URL scheme
- Secure storage library selection
- Update provider and channel strategy
- Local bundled server mode ADR
