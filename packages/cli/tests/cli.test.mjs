import assert from "node:assert/strict";
import test from "node:test";
import { internals } from "../bin/crewcmd.js";

test("resolves XDG config, data, and state paths", () => {
  const paths = internals.appPaths({
    HOME: "/home/tester",
    XDG_CONFIG_HOME: "/cfg",
    XDG_DATA_HOME: "/data",
    XDG_STATE_HOME: "/state",
  });
  assert.equal(paths.configDir, "/cfg/crewcmd");
  assert.equal(paths.dataDir, "/data/crewcmd");
  assert.equal(paths.stateDir, "/state/crewcmd");
  assert.equal(paths.configPath, "/cfg/crewcmd/config.json");
});

test("validates Tailscale public URL requirements", () => {
  assert.throws(
    () => internals.validateInit({ mode: "docker", port: 3000, publicUrl: "", tailscale: true }),
    /--tailscale requires --public-url/,
  );
  assert.doesNotThrow(() => internals.validateInit({
    mode: "docker",
    port: 3000,
    publicUrl: "https://crewcmd.example.ts.net",
    tailscale: true,
  }));
});

test("generates redacted env output", () => {
  const env = internals.renderEnv({
    mode: "docker",
    port: 3000,
    publicUrl: "http://localhost:3000",
    authSecret: "secret",
    heartbeatSecret: "heartbeat",
    postgresPassword: "postgres",
    databaseUrl: "postgresql://user:pass@host/db",
  });
  const redacted = internals.redactedEnv(env);
  assert.match(redacted, /AUTH_SECRET=<redacted>/);
  assert.match(redacted, /HEARTBEAT_SECRET=<redacted>/);
  assert.match(redacted, /POSTGRES_PASSWORD=<redacted>/);
  assert.match(redacted, /DATABASE_URL=<redacted>/);
  assert.doesNotMatch(redacted, /heartbeat/);
});

test("generates docker compose using configured port and image", () => {
  const compose = internals.renderCompose({
    port: 3456,
    image: "ghcr.io/example/crewcmd:test",
  });
  assert.match(compose, /ghcr\.io\/example\/crewcmd:test/);
  assert.match(compose, /\$\{APP_PORT:-3456\}:3000/);
  assert.match(compose, /\/api\/health/);
});
