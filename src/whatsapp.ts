import fs from "node:fs/promises";
import path from "node:path";
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  jidNormalizedUser,
  normalizeMessageContent,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import qrcode from "qrcode-terminal";

type WhatsAppLogger = NonNullable<Parameters<typeof downloadMediaMessage>[3]>["logger"];
type PendingAlbum = {
  expectedImages?: number;
  messages: WAMessage[];
  timer: NodeJS.Timeout;
};

export type OutgoingWhatsAppMessage = {
  chatJid: string;
  id: string;
  senderName: string;
  senderPhone: string;
  text: string;
  quote: WhatsAppQuote;
  attachments: Array<{
    filename: string;
    mimeType: string;
    download: () => Promise<Buffer>;
  }>;
};

export type WhatsAppQuote = {
  id: string;
  fromMe: boolean;
  participant?: string;
  senderName: string;
  text: string;
};

type ExtractedWhatsAppMessage = Omit<
  OutgoingWhatsAppMessage,
  "attachments" | "quote" | "senderPhone"
> & {
  image?: {
    filename: string;
    mimeType: string;
  };
};

export function phoneNumberFromJid(jid: string | null | undefined): string {
  if (!jid) return "";
  return jidNormalizedUser(jid).split("@")[0]?.replace(/\D/g, "") ?? "";
}

export function albumParentId(message: WAMessage): string | undefined {
  const association = normalizeMessageContent(message.message)?.messageContextInfo?.messageAssociation;
  if (association?.associationType !== 1) return undefined;
  return association.parentMessageKey?.id || undefined;
}

export function expectedAlbumImages(message: WAMessage): number | undefined {
  const count = normalizeMessageContent(message.message)?.albumMessage?.expectedImageCount;
  return count && count > 0 ? count : undefined;
}

export function quotedWhatsAppMessage(chatJid: string, quote: WhatsAppQuote): WAMessage {
  return {
    key: {
      remoteJid: chatJid,
      id: quote.id,
      fromMe: quote.fromMe,
      participant: quote.participant,
    },
    message: { conversation: quote.text },
    pushName: quote.senderName,
  };
}

export function extractWhatsAppMessage(
  message: WAMessage,
  fallbackSenderName = "WhatsApp sender",
): ExtractedWhatsAppMessage | undefined {
  if (!message.key.id || !message.key.remoteJid) return undefined;
  const content = normalizeMessageContent(message.message);
  const text =
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.videoMessage?.caption;
  if (!text) return undefined;
  const mimeType = content?.imageMessage?.mimetype || undefined;
  return {
    chatJid: message.key.remoteJid,
    id: message.key.id,
    senderName: message.pushName?.trim() || fallbackSenderName,
    text,
    ...(content?.imageMessage
      ? {
          image: {
            filename: `whatsapp-image-${message.key.id}.${imageExtension(mimeType)}`,
            mimeType: mimeType || "image/jpeg",
          },
        }
      : {}),
  };
}

export async function waitAtMost(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([promise.then(() => true), timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class LinkedWhatsAppClient {
  private socket?: WASocket;
  private reconnecting = false;
  private status: "connecting" | "waiting_for_qr" | "connected" | "disconnected" =
    "disconnected";
  private qrDataUrl?: string;
  private lastError?: string;
  private groups = new Map<string, string>();
  private directChats = new Map<string, string>();
  private phoneByJid = new Map<string, string>();
  private monitoredChats: string[] = [];
  private onOutgoingMessage?: (message: OutgoingWhatsAppMessage) => Promise<boolean>;
  private relinkTask?: Promise<void>;
  private pendingAlbums = new Map<string, PendingAlbum>();

  constructor(private readonly stateDir: string) {}

  async start(
    onOutgoingMessage: (message: OutgoingWhatsAppMessage) => Promise<boolean>,
  ): Promise<void> {
    this.onOutgoingMessage = onOutgoingMessage;
    this.status = "connecting";
    const authDir = path.join(this.stateDir, "whatsapp-auth");
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const logger = pino({ level: "silent" });
    const socket = makeWASocket({
      auth: state,
      logger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.socket = socket;

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("contacts.upsert", (contacts) => this.recordContacts(contacts));
    socket.ev.on("contacts.update", (contacts) => this.recordContacts(contacts));
    socket.ev.on("messaging-history.set", ({ contacts }) => this.recordContacts(contacts));
    socket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        this.status = "waiting_for_qr";
        const qrPath = path.join(this.stateDir, "whatsapp-qr.png");
        console.info("Scan this QR from WhatsApp > Settings > Linked Devices:");
        qrcode.generate(qr, { small: true });
        void QRCode.toFile(qrPath, qr, { margin: 2, width: 600 })
          .then(() => console.info(`QR image saved to ${qrPath}`))
          .catch(console.error);
        void QRCode.toDataURL(qr, { margin: 2, width: 600 })
          .then((value) => {
            if (this.socket === socket) this.qrDataUrl = value;
          })
          .catch((error) => {
            this.lastError = "Could not create the WhatsApp QR code";
            console.error(error);
          });
      }
      if (connection === "open") {
        this.reconnecting = false;
        this.status = "connected";
        this.qrDataUrl = undefined;
        this.lastError = undefined;
        console.info("WhatsApp linked-device session connected");
        void this.refreshGroups().catch(console.error);
      }
      if (connection === "close") {
        if (this.socket !== socket) return;
        this.status = "disconnected";
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          console.error("WhatsApp logged out. Remove .data/whatsapp-auth and link it again.");
          return;
        }
        if (!this.reconnecting) {
          this.reconnecting = true;
          console.warn("WhatsApp disconnected. Reconnecting...");
          void this.start(onOutgoingMessage).catch(console.error);
        }
      }
    });

    socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const item of messages) {
        this.observeMessage(item, socket, logger, onOutgoingMessage);
      }
    });
  }

  isConnected(): boolean {
    return Boolean(this.socket?.user);
  }

  getStatus() {
    return {
      state: this.status,
      connected: this.isConnected(),
      qrDataUrl: this.qrDataUrl,
      relinking: Boolean(this.relinkTask),
      lastError: this.lastError,
    };
  }

  getAvailableChats() {
    const chats = [
      ...[...this.groups.values()].map((name) => ({ name, type: "group" as const })),
      ...[...this.directChats.values()].map((name) => ({ name, type: "direct" as const })),
    ];
    return [...new Map(chats.map((chat) => [`${chat.type}:${chat.name}`, chat])).values()].sort(
      (a, b) => a.name.localeCompare(b.name),
    );
  }

  setMonitoredChats(chats: string[]): void {
    this.monitoredChats = [...chats];
    if (this.isConnected()) void this.refreshGroups().catch(console.error);
  }

  getMonitoredChat(
    chatJid: string,
    monitoredChats = this.monitoredChats,
  ): { jid: string; name: string } | undefined {
    const groupName = this.groups.get(chatJid);
    if (groupName && monitoredChats.includes(groupName)) {
      return { jid: chatJid, name: groupName };
    }

    const phone = this.phoneByJid.get(chatJid) ?? phoneNumberFromJid(chatJid);
    const contactName = this.directChats.get(chatJid);
    const configured = monitoredChats.find(
      (item) => item === contactName || normalizedPhone(item) === phone,
    );
    if (!configured) return undefined;
    return { jid: chatJid, name: configured };
  }

  async sendToChat(chatJid: string, text: string, quote?: WhatsAppQuote): Promise<void> {
    if (!this.socket?.user) throw new Error("WhatsApp linked-device session is not connected");
    const quoted = quote ? quotedWhatsAppMessage(chatJid, quote) : undefined;
    await this.socket.sendMessage(chatJid, { text }, { quoted });
  }

  async sendToConfiguredChat(chat: string, text: string): Promise<void> {
    if (!this.socket?.user) throw new Error("WhatsApp linked-device session is not connected");
    if (this.groups.size === 0) await this.refreshGroups();
    const matches = [...this.groups.entries()].filter(([, name]) => name === chat);
    if (matches.length > 1) throw new Error(`More than one WhatsApp group is named: ${chat}`);
    if (matches.length === 1) {
      await this.sendToChat(matches[0][0], text);
      return;
    }
    const directMatches = [...this.directChats.entries()].filter(([, name]) => name === chat);
    if (directMatches.length > 1) throw new Error(`More than one WhatsApp contact is named: ${chat}`);
    if (directMatches.length === 1) {
      await this.sendToChat(directMatches[0][0], text);
      return;
    }
    const phone = normalizedPhone(chat);
    if (!phone) throw new Error(`WhatsApp chat not found: ${chat}`);
    await this.sendToChat(`${phone}@s.whatsapp.net`, text);
  }

  async relink(): Promise<void> {
    if (this.relinkTask) return this.relinkTask;
    this.relinkTask = this.performRelink().finally(() => {
      this.relinkTask = undefined;
    });
    return this.relinkTask;
  }

  private async performRelink(): Promise<void> {
    const oldSocket = this.socket;
    this.socket = undefined;
    this.status = "connecting";
    this.qrDataUrl = undefined;
    this.groups.clear();
    this.directChats.clear();
    this.phoneByJid.clear();
    this.lastError = undefined;
    try {
      if (oldSocket) await waitAtMost(oldSocket.logout(), 5_000);
    } catch (error) {
      console.warn("WhatsApp logout did not finish cleanly", error);
    } finally {
      oldSocket?.end(new Error("Relinking WhatsApp"));
    }
    await fs.rm(path.join(this.stateDir, "whatsapp-auth"), { recursive: true, force: true });
    if (!this.onOutgoingMessage) throw new Error("WhatsApp has not been started");
    try {
      await this.start(this.onOutgoingMessage);
    } catch (error) {
      this.status = "disconnected";
      this.lastError = "Could not start a new WhatsApp link";
      throw error;
    }
  }

  private async refreshGroups(): Promise<void> {
    if (!this.socket?.user) return;
    const groups = Object.values(await this.socket.groupFetchAllParticipating());
    this.groups = new Map(groups.map((group) => [group.id, group.subject]));
    for (const name of this.monitoredChats.filter((item) => !normalizedPhone(item))) {
      if (!groups.some((group) => group.subject === name)) {
        console.warn(`WhatsApp group not found: ${name}`);
      } else {
        console.info(`Watching WhatsApp group: ${name}`);
      }
    }
  }

  private recordContacts(
    contacts: Array<{
      id?: string;
      jid?: string;
      lid?: string;
      name?: string;
      notify?: string;
      verifiedName?: string;
    }>,
  ): void {
    for (const contact of contacts) {
      const jids = [...new Set([contact.id, contact.jid, contact.lid].filter(Boolean))] as string[];
      const name = contact.name?.trim() || contact.verifiedName?.trim() || contact.notify?.trim();
      const phone = phoneNumberFromJid(contact.jid);
      for (const jid of jids) {
        if (jid.endsWith("@g.us")) continue;
        if (name) this.directChats.set(jid, name);
        if (phone) this.phoneByJid.set(jid, phone);
      }
    }
  }

  private senderName(message: WAMessage, socket: WASocket): string {
    const pushName = message.pushName?.trim();
    if (pushName && !/^[.…]+$/.test(pushName)) return pushName;
    if (message.key.fromMe) {
      return socket.user?.name?.trim() || socket.user?.notify?.trim() || "WhatsApp sender";
    }
    const jid = message.key.participant ?? message.key.remoteJid;
    if (!jid) return "WhatsApp participant";
    const name = this.directChats.get(jid);
    if (name) return name;
    const phone = this.knownPhone(jid);
    return phone ? `+${phone}` : "WhatsApp participant";
  }

  private senderPhone(message: WAMessage, socket: WASocket): string {
    const jid = message.key.fromMe
      ? socket.user?.id
      : message.key.participantPn ?? message.key.senderPn ?? message.key.participant ?? message.key.remoteJid;
    if (!jid) return "";
    const phone = this.knownPhone(jid);
    return phone ? `+${phone}` : "";
  }

  private knownPhone(jid: string): string {
    return this.phoneByJid.get(jid) ?? (jid.endsWith("@lid") ? "" : phoneNumberFromJid(jid));
  }

  private observeMessage(
    item: WAMessage,
    socket: WASocket,
    logger: WhatsAppLogger,
    onOutgoingMessage: (message: OutgoingWhatsAppMessage) => Promise<boolean>,
  ): void {
    const expectedImages = expectedAlbumImages(item);
    if (expectedImages && item.key.id) {
      const album = this.getPendingAlbum(item.key.id, socket, logger, onOutgoingMessage);
      album.expectedImages = expectedImages;
      this.flushAlbumIfComplete(item.key.id, socket, logger, onOutgoingMessage);
      return;
    }

    const parentId = albumParentId(item);
    if (parentId) {
      const album = this.getPendingAlbum(parentId, socket, logger, onOutgoingMessage);
      if (!album.messages.some((message) => message.key.id === item.key.id)) {
        album.messages.push(item);
      }
      this.flushAlbumIfComplete(parentId, socket, logger, onOutgoingMessage);
      return;
    }

    const message = this.buildMessage(item, [item], socket, logger);
    if (message) this.forwardAndReact(message, item, socket, onOutgoingMessage);
  }

  private getPendingAlbum(
    id: string,
    socket: WASocket,
    logger: WhatsAppLogger,
    onOutgoingMessage: (message: OutgoingWhatsAppMessage) => Promise<boolean>,
  ) {
    const existing = this.pendingAlbums.get(id);
    if (existing) return existing;
    const album: PendingAlbum = {
      messages: [] as WAMessage[],
      timer: setTimeout(() => this.flushAlbum(id, socket, logger, onOutgoingMessage), 2_500),
    };
    this.pendingAlbums.set(id, album);
    return album;
  }

  private flushAlbumIfComplete(
    id: string,
    socket: WASocket,
    logger: WhatsAppLogger,
    onOutgoingMessage: (message: OutgoingWhatsAppMessage) => Promise<boolean>,
  ): void {
    const album = this.pendingAlbums.get(id);
    if (!album?.expectedImages) return;
    const imageCount = album.messages.filter((message) => imageMetadata(message)).length;
    if (imageCount >= album.expectedImages) {
      this.flushAlbum(id, socket, logger, onOutgoingMessage);
    }
  }

  private flushAlbum(
    id: string,
    socket: WASocket,
    logger: WhatsAppLogger,
    onOutgoingMessage: (message: OutgoingWhatsAppMessage) => Promise<boolean>,
  ): void {
    const album = this.pendingAlbums.get(id);
    if (!album) return;
    clearTimeout(album.timer);
    this.pendingAlbums.delete(id);
    const trigger = album.messages.find((message) => extractWhatsAppMessage(message));
    if (!trigger) return;
    const message = this.buildMessage(trigger, album.messages, socket, logger, id);
    if (message) this.forwardAndReact(message, trigger, socket, onOutgoingMessage);
  }

  private buildMessage(
    trigger: WAMessage,
    mediaMessages: WAMessage[],
    socket: WASocket,
    logger: WhatsAppLogger,
    id?: string,
  ): OutgoingWhatsAppMessage | undefined {
    const extracted = extractWhatsAppMessage(trigger, this.senderName(trigger, socket));
    if (!extracted) return undefined;
    const attachments = mediaMessages.flatMap((item) => {
      const metadata = imageMetadata(item);
      if (!metadata) return [];
      return [
        {
          ...metadata,
          download: () =>
            downloadMediaMessage(item, "buffer", {}, {
              logger,
              reuploadRequest: (mediaMessage) => socket.updateMediaMessage(mediaMessage),
            }),
        },
      ];
    });
    return {
      chatJid: extracted.chatJid,
      id: id ?? extracted.id,
      senderName: extracted.senderName,
      senderPhone: this.senderPhone(trigger, socket),
      text: extracted.text,
      quote: {
        id: trigger.key.id as string,
        fromMe: Boolean(trigger.key.fromMe),
        participant: trigger.key.participant || undefined,
        senderName: extracted.senderName,
        text: extracted.text,
      },
      attachments,
    };
  }

  private forwardAndReact(
    message: OutgoingWhatsAppMessage,
    source: WAMessage,
    socket: WASocket,
    onOutgoingMessage: (message: OutgoingWhatsAppMessage) => Promise<boolean>,
  ): void {
    if (!message.chatJid.endsWith("@g.us")) {
      const number = this.phoneByJid.get(message.chatJid) ?? phoneNumberFromJid(message.chatJid);
      if (number && !this.directChats.has(message.chatJid)) {
        this.directChats.set(message.chatJid, `+${number}`);
      }
    }
    console.info(`Observed WhatsApp message in chat ${message.chatJid}`);
    void onOutgoingMessage(message)
      .then(async (forwarded) => {
        if (forwarded) await this.reactToMessage(socket, source, "🟢");
      })
      .catch(async (error) => {
        console.error(error);
        await this.reactToMessage(socket, source, "🔴");
      });
  }

  private async reactToMessage(socket: WASocket, message: WAMessage, reaction: string): Promise<void> {
    if (!message.key.remoteJid) return;
    try {
      await socket.sendMessage(message.key.remoteJid, {
        react: { text: reaction, key: message.key },
      });
    } catch (error) {
      console.error(`Could not add the ${reaction} WhatsApp reaction`, error);
    }
  }
}

function normalizedPhone(value: string): string | undefined {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : undefined;
}

function imageExtension(mimeType: string | undefined): string {
  const extensions: Record<string, string> = {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  return extensions[mimeType ?? ""] ?? "jpg";
}

function imageMetadata(message: WAMessage): { filename: string; mimeType: string } | undefined {
  if (!message.key.id) return undefined;
  const image = normalizeMessageContent(message.message)?.imageMessage;
  if (!image) return undefined;
  const mimeType = image.mimetype || "image/jpeg";
  return {
    filename: `whatsapp-image-${message.key.id}.${imageExtension(mimeType)}`,
    mimeType,
  };
}
