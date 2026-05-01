# Desktop Release Checklist

Concise Wave 6 checklist for preparing a desktop shell release. This is a
planning checklist only; it does not define final release ownership, dates, or
platform policy.

## Launch Smoke

- Install or run the desktop shell from a clean local build artifact.
- Confirm the app opens to the expected first screen without console errors.
- Confirm a new window can be opened, focused, closed, and reopened.
- Confirm the app exits cleanly and can be launched again.
- Capture the app version, commit SHA, operating system, and test timestamp in
  the release notes or QA log.

## Server URL Mode

- Confirm the desktop shell can target the intended server URL mode for the
  release candidate.
- Verify the configured URL is visible in logs or diagnostics without exposing
  secrets.
- Smoke test against the selected URL with a fresh app launch.
- Confirm the app handles an unreachable server with a clear, non-crashing
  failure state.

## Signing And Notarization Placeholders

- Record the expected signing identity for each target platform before release.
- Verify signed artifact checks are added to the release workflow before public
  distribution.
- Add notarization verification for macOS artifacts before public distribution.
- Document where signing and notarization logs will be stored for audit review.

## Update Channel Placeholders

- Define the release channel names before enabling update delivery.
- Confirm update manifests or channel metadata are generated in dry-run mode
  before publishing.
- Verify downgrade and skipped-version behavior before enabling automatic
  updates.
- Document how maintainers pause or disable a channel during an incident.

## Rollback

- Keep the previous known-good artifact and server URL mode available until the
  new release is accepted.
- Document the command or release-system action used to unpublish, pause, or
  supersede a bad desktop release.
- Confirm rollback communication includes affected versions, recommended user
  action, and the replacement build or workaround.
- Preserve logs and artifacts from the failed release for follow-up review.

## Explicitly Out Of Scope

- Implementing signing, notarization, update delivery, or rollback automation.
- Changing desktop app behavior, server URL semantics, package metadata, or
  release tooling.
- Defining final platform support, distribution channels, or release owners.
- Editing app code, package files, CI workflows, or existing documentation.
