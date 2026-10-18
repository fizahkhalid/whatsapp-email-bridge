export type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
};

export function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function extractMessageBody(payload?: GmailMessagePart): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  for (const part of payload.parts ?? []) {
    const body = extractMessageBody(part);
    if (body) return body;
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
  }

  return payload.body?.data ? decodeBase64Url(payload.body.data) : "";
}

export function removeQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    if (/^On .+wrote:\s*$/i.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim())) break;
    if (/^From:\s.+$/i.test(line.trim()) && kept.some((item) => item.trim() === "")) break;
    if (line.trimStart().startsWith(">")) continue;
    kept.push(line);
  }

  return kept.join("\n").trim();
}

export function cleanGmailReaction(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const markerIndex = lines.findIndex((line) => /reacted via Gmail\s*$/i.test(line.trim()));
  if (markerIndex <= 0) return text;
  return lines.slice(0, markerIndex).join("\n").trim();
}

export function stripLeadingPrefix(text: string, prefix: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return text;
  return trimmed.slice(prefix.length).trimStart();
}

export function shortenSubject(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 57)}...`;
}
