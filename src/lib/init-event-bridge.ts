import { startEventBridge } from "./gateway-event-bridge";

let initializationPromise: Promise<unknown> | null = null;

export async function ensureEventBridge() {
  if (!initializationPromise) {
    initializationPromise = startEventBridge().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  await initializationPromise;
}
