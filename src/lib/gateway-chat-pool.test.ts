import { afterEach, describe, expect, it } from "vitest";
import type { GatewayClient } from "./gateway-client";
import {
  getGatewayPoolDiagnostics,
  holdClient,
  releaseClient,
  resetGatewayPoolForTests,
} from "./gateway-chat-pool";

describe("gateway-chat-pool active client holds", () => {
  afterEach(() => {
    resetGatewayPoolForTests();
  });

  it("keeps a client active until every holder releases it", () => {
    const client = { close() {} } as GatewayClient;

    holdClient(client);
    holdClient(client);

    expect(getGatewayPoolDiagnostics()).toMatchObject({
      activeClients: 1,
      activeHolds: 2,
    });

    releaseClient(client);

    expect(getGatewayPoolDiagnostics()).toMatchObject({
      activeClients: 1,
      activeHolds: 1,
    });

    releaseClient(client);

    expect(getGatewayPoolDiagnostics()).toMatchObject({
      activeClients: 0,
      activeHolds: 0,
    });
  });

  it("ignores extra releases after a client is no longer held", () => {
    const client = { close() {} } as GatewayClient;

    releaseClient(client);

    expect(getGatewayPoolDiagnostics()).toMatchObject({
      activeClients: 0,
      activeHolds: 0,
    });
  });
});
