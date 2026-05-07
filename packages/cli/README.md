# crewcmd CLI

Self-hosting operator CLI for CrewCmd.

## Install

```sh
npm install -g crewcmd
crewcmd init
crewcmd server start
```

## Tailscale

```sh
crewcmd init --tailscale --public-url https://crewcmd.example.ts.net
```

CrewCmd binds locally to `0.0.0.0`; TLS is handled by Tailscale Serve or your reverse proxy.

## Commands

```sh
crewcmd doctor
crewcmd server status
crewcmd server logs
crewcmd config print
```
