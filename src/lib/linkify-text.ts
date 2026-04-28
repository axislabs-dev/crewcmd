export interface TextLinkPart {
  kind: "text" | "url";
  value: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[),.;:!?]+$/;

export function parsePlainTextLinks(text: string): TextLinkPart[] {
  const parts: TextLinkPart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const rawUrl = match[0];
    const start = match.index ?? 0;
    const trailing = rawUrl.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const url = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
    const end = start + url.length;

    if (start > lastIndex) {
      parts.push({ kind: "text", value: text.slice(lastIndex, start) });
    }

    parts.push({ kind: "url", value: url });

    if (trailing) {
      parts.push({ kind: "text", value: trailing });
    }

    lastIndex = start + rawUrl.length;
  }

  if (lastIndex < text.length) {
    parts.push({ kind: "text", value: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ kind: "text", value: text }];
}
