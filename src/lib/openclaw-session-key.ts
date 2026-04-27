export function extractAgentFromSessionKey(key: string): string {
  const parts = key.split(":");
  if (parts[0] === "agent" && parts[1]) return parts[1];
  return parts[0] || key;
}
