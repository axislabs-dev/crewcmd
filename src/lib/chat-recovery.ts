export interface ChatRecoveryMessage {
  role: string | null;
  content: string;
}

function normalizeContent(content: string) {
  return content.trim().replace(/\s+/g, " ");
}

function contentSet(contents: string[]) {
  return new Set(
    contents.map(normalizeContent).filter((content) => content.length > 0)
  );
}

export function selectRecoveredAssistantText(params: {
  messages: ChatRecoveryMessage[];
  currentUserContents: string[];
  previousAssistantContents?: string[];
}) {
  const currentUsers = contentSet(params.currentUserContents);
  if (currentUsers.size === 0) return "";

  const previousAssistants = contentSet(params.previousAssistantContents ?? []);
  const lastMatchingUserIndex = params.messages.findLastIndex((message) => {
    if (message.role !== "user") return false;
    return currentUsers.has(normalizeContent(message.content));
  });

  if (lastMatchingUserIndex < 0) return "";

  const recovered = params.messages
    .slice(lastMatchingUserIndex + 1)
    .find((message) => message.role === "assistant" && message.content.trim());

  if (!recovered) return "";

  const recoveredContent = normalizeContent(recovered.content);
  if (previousAssistants.has(recoveredContent)) return "";

  return recovered.content;
}
