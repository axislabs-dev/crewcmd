type AbortHandler = () => Promise<void> | void;

const abortHandlers = new Map<string, AbortHandler>();

export function registerChatRunAbort(chatRunId: string, handler: AbortHandler) {
  abortHandlers.set(chatRunId, handler);
  return () => {
    abortHandlers.delete(chatRunId);
  };
}

export async function abortRegisteredChatRun(chatRunId: string) {
  const handler = abortHandlers.get(chatRunId);
  if (!handler) return false;
  await handler();
  return true;
}

