# crewcmd CLI

Self-hosting operator CLI for CrewCmd.

## Availability

The CLI is under active development and is not currently published to npm.
For the supported CrewCmd setup, follow the
[installation guide](../../docs/getting-started/installation.md). Publishing
and versioning the CLI is tracked in
[#665](https://github.com/rogerchappel/crewcmd/issues/665).

## Use from a repository checkout

```sh
pnpm install
node packages/cli/bin/crewcmd.js init
node packages/cli/bin/crewcmd.js server start
```

Run these commands from the repository root. Contributors can verify the CLI
package with `pnpm --filter crewcmd run release:check`.

## Tailscale

```sh
node packages/cli/bin/crewcmd.js init --tailscale --public-url https://crewcmd.example.ts.net
```

CrewCmd binds locally to `0.0.0.0`; TLS is handled by Tailscale Serve or your reverse proxy.

## Commands

```sh
node packages/cli/bin/crewcmd.js doctor
node packages/cli/bin/crewcmd.js server status
node packages/cli/bin/crewcmd.js server logs
node packages/cli/bin/crewcmd.js config print
```
