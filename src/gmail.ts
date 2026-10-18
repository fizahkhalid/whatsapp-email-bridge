import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Config } from "./config.js";
import {
  extractMessageBody,
  cleanGmailReaction,
  removeQuotedReply,
  type GmailMessagePart,
} from "./text.js";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export type IncomingEmail = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  text: string;
};

export type SentEmail = {
  id: string;
  threadId: string;
};

export type EmailAttachment = {
  data: Buffer;
  filename: string;
  mimeType: string;
};

type GoogleCredentials = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  account_email?: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export class GmailClient {
  private credentials: GoogleCredentials = {};

  constructor(
    private readonly config: Config["gmail"],
    private readonly stateDir: string,
  ) {}

  async loadSavedCredentials(): Promise<void> {
    try {
      const raw = await fs.readFile(this.tokenPath, "utf8");
      this.credentials = JSON.parse(raw) as GoogleCredentials;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  isConnected(): boolean {
    return Boolean(this.credentials.refresh_token);
  }

  getAccountEmail(): string {
    return this.credentials.account_email || "";
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPE,
      access_type: "offline",
      prompt: "consent select_account",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async finishAuthorization(code: string): Promise<void> {
    const tokens = await this.requestToken({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: "authorization_code",
    });
    this.credentials = this.toCredentials(tokens);
    const profile = await this.request<{ emailAddress?: string }>("/users/me/profile");
    this.credentials.account_email = profile.emailAddress?.toLowerCase();
    await this.saveCredentials();
  }

  async disconnect(): Promise<void> {
    const token = this.credentials.refresh_token || this.credentials.access_token;
    this.credentials = {};
    await fs.rm(this.tokenPath, { force: true });
    if (!token) return;
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    if (!response.ok) {
      throw new Error(`Google token revocation failed (${response.status})`);
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    body: string,
    attachments: EmailAttachment[] = [],
    htmlBody?: string,
  ): Promise<SentEmail> {
    this.assertConnected();
    const from = this.getAccountEmail();
    if (!from) throw new Error("The connected Gmail account address is unavailable");
    const raw = createRawEmail(
      from,
      to,
      subject.replace(/[\r\n]+/g, " "),
      body,
      attachments,
      htmlBody,
    );
    return await this.request<SentEmail>("/users/me/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw }),
    });
  }

  async listRepliesFrom(emails: string[], trackedThreadIds: string[]): Promise<IncomingEmail[]> {
    this.assertConnected();
    const fromQuery = emails.map((email) => `from:${email}`).join(" OR ");
    const params = new URLSearchParams({
      q: `(${fromQuery}) newer_than:30d`,
      maxResults: "50",
    });
    const result = await this.request<{ messages?: Array<{ id?: string; threadId?: string }> }>(
      `/users/me/messages?${params}`,
    );

    const replies: IncomingEmail[] = [];
    for (const item of result.messages ?? []) {
      if (!item.id) continue;
      const message = await this.request<{
        threadId?: string;
        payload?: GmailMessagePart & { headers?: Array<{ name?: string; value?: string }> };
      }>(
        `/users/me/messages/${encodeURIComponent(item.id)}?format=full`,
      );
      const threadId = message.threadId ?? item.threadId ?? "";
      const subject = header(message.payload?.headers, "subject");
      const from = emailAddress(header(message.payload?.headers, "from"));
      if (!trackedThreadIds.includes(threadId)) continue;
      if (!emails.includes(from.toLowerCase())) continue;
      const text = cleanGmailReaction(removeQuotedReply(extractMessageBody(message.payload)));
      if (text) replies.push({ id: item.id, threadId, from, subject, text });
    }
    return replies.reverse();
  }

  private get tokenPath(): string {
    return path.join(this.stateDir, "google-token.json");
  }

  private assertConnected(): void {
    if (!this.isConnected()) {
      throw new Error("Gmail is not connected. Open /auth/google first.");
    }
  }

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Gmail API failed (${response.status}): ${await response.text()}`);
    }
    return (await response.json()) as T;
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.credentials.access_token &&
      this.credentials.expires_at &&
      this.credentials.expires_at > Date.now() + 60_000
    ) {
      return this.credentials.access_token;
    }
    if (!this.credentials.refresh_token) {
      throw new Error("Gmail is not connected. Open /auth/google first.");
    }

    const tokens = await this.requestToken({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.credentials.refresh_token,
      grant_type: "refresh_token",
    });
    this.credentials = {
      ...this.credentials,
      ...this.toCredentials(tokens),
      refresh_token: tokens.refresh_token ?? this.credentials.refresh_token,
    };
    await this.saveCredentials();
    return this.credentials.access_token as string;
  }

  private async requestToken(values: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
    });
    if (!response.ok) {
      throw new Error(`Google OAuth failed (${response.status}): ${await response.text()}`);
    }
    return (await response.json()) as TokenResponse;
  }

  private toCredentials(tokens: TokenResponse): GoogleCredentials {
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1_000,
    };
  }

  private async saveCredentials(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.writeFile(this.tokenPath, JSON.stringify(this.credentials, null, 2), {
      mode: 0o600,
    });
  }

}

export function createRawEmail(
  from: string,
  to: string,
  subject: string,
  body: string,
  attachments: EmailAttachment[] = [],
  htmlBody?: string,
): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const headers = [`From: ${from}`, `To: ${to}`, `Subject: ${encodedSubject}`, "MIME-Version: 1.0"];
  let message: string;

  const bodyParts = emailBodyParts(body, htmlBody);

  if (attachments.length === 0) {
    message = [...headers, ...bodyParts].join("\r\n");
  } else {
    const boundary = `bridge-the-gap-${randomUUID()}`;
    const parts = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      ...bodyParts,
    ];
    for (const attachment of attachments) {
      const filename = safeFilename(attachment.filename);
      const mimeType = safeMimeType(attachment.mimeType);
      parts.push(
        `--${boundary}`,
        `Content-Type: ${mimeType}; name="${filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${filename}"`,
        "",
        wrapBase64(attachment.data),
      );
    }
    parts.push(`--${boundary}--`, "");
    message = parts.join("\r\n");
  }

  return Buffer.from(message).toString("base64url");
}

function emailBodyParts(body: string, htmlBody: string | undefined): string[] {
  if (!htmlBody) {
    return [
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(Buffer.from(body)),
    ];
  }
  const boundary = `bridge-the-gap-alternative-${randomUUID()}`;
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(body)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(htmlBody)),
    `--${boundary}--`,
    "",
  ];
}

function wrapBase64(data: Buffer): string {
  return data.toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
}

function safeMimeType(value: string): string {
  return /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(value)
    ? value
    : "application/octet-stream";
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  return headers?.find((item) => item.name?.toLowerCase() === name)?.value?.trim() ?? "";
}

function emailAddress(value: string): string {
  return value.match(/<([^>]+)>/)?.[1] ?? value;
}
