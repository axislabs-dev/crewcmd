import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { socketState } = vi.hoisted(() => ({
  socketState: {
    sockets: [] as Array<{ reply: (payload: Record<string, unknown>) => void }>,
    frames: [] as Array<Record<string, unknown>>,
    respond: null as null | ((
      socket: { reply: (payload: Record<string, unknown>) => void },
      frame: Record<string, unknown>,
      socketIndex: number,
    ) => void),
  },
}));

vi.mock("ws", () => {
  type Listener = (...args: unknown[]) => void;

  return {
    default: class MockSocket {
      private listeners = new Map<string, Listener[]>();

      constructor(_url: string) {
        socketState.sockets.push(this);
        queueMicrotask(() => {
          this.emit("open");
          this.emit("message", Buffer.from(JSON.stringify({
            type: "event",
            event: "connect.challenge",
            payload: { nonce: `nonce-${socketState.sockets.indexOf(this)}` },
          })));
        });
      }

      on(event: string, listener: Listener) {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push(listener);
        this.listeners.set(event, listeners);
        return this;
      }

      send(raw: string) {
        const frame = JSON.parse(raw) as Record<string, unknown>;
        socketState.frames.push(frame);
        socketState.respond?.(this, frame, socketState.sockets.indexOf(this));
      }

      close() {
        this.emit("close", 1000, Buffer.from("closed"));
      }

      reply(payload: Record<string, unknown>) {
        this.emit("message", Buffer.from(JSON.stringify(payload)));
      }

      private emit(event: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(event) ?? []) listener(...args);
      }
    },
  };
});

import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";

function responseId(frame: Record<string, unknown>) {
  return String(frame.id);
}

function connectParams(index: number) {
  const frame = socketState.frames[index] as { params?: Record<string, unknown> };
  return frame.params ?? {};
}

describe("GatewayClient device authentication lifecycle", () => {
  beforeEach(() => {
    socketState.sockets.length = 0;
    socketState.frames.length = 0;
    socketState.respond = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists the issued device token and performs one trusted mismatch retry", async () => {
    const onDeviceAuthUpdated = vi.fn();
    socketState.respond = (socket, frame, socketIndex) => {
      if (socketIndex === 0) {
        socket.reply({
          type: "res",
          id: responseId(frame),
          ok: false,
          error: {
            code: "INVALID_REQUEST",
            message: "unauthorized: gateway token mismatch",
            details: {
              code: "AUTH_TOKEN_MISMATCH",
              canRetryWithDeviceToken: true,
              recommendedNextStep: "retry_with_device_token",
            },
          },
        });
        return;
      }

      socket.reply({
        type: "res",
        id: responseId(frame),
        ok: true,
        payload: {
          type: "hello-ok",
          server: { version: "2026.7.1" },
          auth: {
            deviceToken: "rotated-device-token",
            role: "operator",
            scopes: ["operator.read", "operator.write"],
          },
        },
      });
    };

    const client = new GatewayClient(
      "ws://127.0.0.1:18789",
      "stale-shared-token",
      resolveDeviceIdentity(),
      15000,
      {
        deviceAuth: {
          token: "stored-device-token",
          role: "operator",
          scopes: ["operator.read", "operator.write"],
        },
        onDeviceAuthUpdated,
      },
    );

    await expect(client.connect()).resolves.toEqual({
      version: "2026.7.1",
      deviceAuth: {
        token: "rotated-device-token",
        role: "operator",
        scopes: ["operator.read", "operator.write"],
      },
    });

    expect(socketState.sockets).toHaveLength(2);
    expect(connectParams(0)).toMatchObject({
      minProtocol: 4,
      maxProtocol: 4,
      scopes: ["operator.admin"],
      auth: { token: "stale-shared-token" },
    });
    expect(connectParams(1)).toMatchObject({
      scopes: ["operator.read", "operator.write"],
      auth: {
        token: "stale-shared-token",
        deviceToken: "stored-device-token",
      },
    });
    expect(onDeviceAuthUpdated).toHaveBeenCalledWith({
      token: "rotated-device-token",
      role: "operator",
      scopes: ["operator.read", "operator.write"],
    });
  });

  it("does not promote a cached device token on an unpinned remote endpoint", async () => {
    socketState.respond = (socket, frame) => {
      socket.reply({
        type: "res",
        id: responseId(frame),
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "unauthorized: gateway token mismatch",
          details: {
            code: "AUTH_TOKEN_MISMATCH",
            canRetryWithDeviceToken: true,
            recommendedNextStep: "retry_with_device_token",
          },
        },
      });
    };

    const client = new GatewayClient(
      "wss://gateway.example.com",
      "stale-shared-token",
      resolveDeviceIdentity(),
      15000,
      {
        deviceAuth: {
          token: "stored-device-token",
          role: "operator",
          scopes: ["operator.read"],
        },
      },
    );

    await expect(client.connect()).rejects.toThrow("gateway token mismatch");
    expect(socketState.sockets).toHaveLength(1);
  });

  it("clears a rejected device token instead of retrying it indefinitely", async () => {
    const onDeviceAuthInvalid = vi.fn();
    socketState.respond = (socket, frame) => {
      socket.reply({
        type: "res",
        id: responseId(frame),
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "unauthorized: device token mismatch",
          details: { code: "AUTH_DEVICE_TOKEN_MISMATCH" },
        },
      });
    };

    const client = new GatewayClient(
      "ws://localhost:18789",
      null,
      resolveDeviceIdentity(),
      15000,
      {
        deviceAuth: {
          token: "revoked-device-token",
          role: "operator",
          scopes: ["operator.read"],
        },
        onDeviceAuthInvalid,
      },
    );

    await expect(client.connect()).rejects.toThrow("device token mismatch");
    expect(socketState.sockets).toHaveLength(1);
    expect(connectParams(0)).toMatchObject({
      scopes: ["operator.read"],
      auth: {
        token: "revoked-device-token",
        deviceToken: "revoked-device-token",
      },
    });
    expect(onDeviceAuthInvalid).toHaveBeenCalledTimes(1);
  });
});
