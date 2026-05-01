# Phase 5: Desktop App Release Path

## Goal

Create a releasable desktop version of CrewCmd without forking the product into
separate codebases.

## Strategy

Start with a desktop shell around the existing CrewCmd web app. Do not bundle a
full local OpenClaw runtime until chat, gateway management, and model
management are reliable.

The desktop app should initially connect to a hosted or self-hosted CrewCmd
server. A local bundled server/runtime mode can come later.

## Workstreams

### 1. Desktop Shell Architecture

Tasks:

- Choose Electron or Tauri after a short technical spike.
- Keep the Next app as the primary product surface.
- Add a desktop shell that loads CrewCmd from:
  - configured server URL
  - local dev URL
  - future bundled local server
- Define native boundary APIs clearly.

Acceptance criteria:

- Desktop shell can authenticate against a CrewCmd server.
- No product logic is duplicated into the shell.

### 2. Native Desktop Capabilities

Tasks:

- Add native notifications for agent events and inbox items.
- Add tray/menu behavior.
- Add deep links for tasks, agents, and chat sessions.
- Add secure local storage for server URL and desktop-specific tokens.
- Add update strategy.

Acceptance criteria:

- Desktop adds real value beyond a browser tab.
- Native storage does not leak secrets.

### 3. Local Gateway Discovery

Tasks:

- Detect local OpenClaw gateway candidates.
- Offer guided runtime connection into CrewCmd.
- Reuse the same gateway import and diagnostics paths as the web app.
- Avoid creating a separate desktop-only runtime config model.

Acceptance criteria:

- Desktop can help users connect a local runtime faster.
- Connected runtimes remain visible and manageable from web/mobile too.

### 4. Release Engineering

Tasks:

- Add packaging scripts.
- Add platform build checks.
- Define signing/notarization path.
- Add release artifacts and update metadata.
- Document install and troubleshooting flows.

Acceptance criteria:

- A maintainer can produce a test desktop build.
- Release checks are repeatable in CI or documented manual workflow.

### 5. Later: Bundled Local Mode

Tasks:

- Evaluate bundling CrewCmd server locally.
- Evaluate bundling or supervising OpenClaw runtime.
- Define data storage and backup behavior.
- Define migration path from local-only to team server.

Acceptance criteria:

- Local mode does not fork core behavior from server mode.
- Users can understand where their data lives.

## Suggested PR Sequence

1. `docs: define desktop architecture decision`
2. `chore: scaffold desktop shell`
3. `feat: desktop shell connects to crewcmd server`
4. `feat: add desktop notifications`
5. `feat: add local gateway discovery`
6. `ci: add desktop package smoke check`

## Verification

Desktop-specific checks:

- App launches on macOS.
- App loads configured CrewCmd server.
- Auth flow works.
- Notifications work.
- Deep links open the correct screen.
- App handles server unavailable state.

Shared checks:

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## Risks

- Desktop packaging can distract from core reliability work.
- Native storage and notifications introduce security/privacy considerations.
- Bundled runtime mode can create a second operational model if introduced too
  early.

## Rollback Plan

Keep desktop code isolated behind a package or app folder. The web server should
continue to build and deploy independently if desktop work is paused or
reverted.
