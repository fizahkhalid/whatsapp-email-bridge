import type { EmailAttachment, GmailClient } from "./gmail.js";
import type { StateStore } from "./state.js";
import type { SettingsStore } from "./settings.js";
import {
  renderEmailHtml,
  renderEmailPlainText,
  renderTemplate,
  templateValues,
} from "./template.js";
import { stripLeadingPrefix } from "./text.js";
import type { LinkedWhatsAppClient, OutgoingWhatsAppMessage } from "./whatsapp.js";

export class Bridge {
  private polling = false;
  private lastGmailCheckAt?: string;
  private lastForwardedAt?: string;
  private lastError?: string;

  constructor(
    private readonly gmail: GmailClient,
    private readonly whatsapp: LinkedWhatsAppClient,
    private readonly state: StateStore,
    private readonly settings: SettingsStore,
  ) {}

  async handleWhatsApp(message: OutgoingWhatsAppMessage): Promise<boolean> {
    const settings = this.settings.get();
    const matches = settings.bridges.flatMap((bridge) => {
      const chat = this.whatsapp.getMonitoredChat(message.chatJid, bridge.whatsappChats);
      if (!chat || !hasPrefix(message.text, bridge.outgoingPrefix)) return [];
      if (this.state.hasWhatsApp(whatsappStateId(bridge.id, message.id))) return [];
      return [{ bridge, chat }];
    });
    if (matches.length === 0) return false;
    if (!this.gmail.isConnected()) {
      throw new Error("Received a WhatsApp message before Gmail was connected");
    }
    const attachments: EmailAttachment[] = [];
    let attachmentBytes = 0;
    for (const attachment of message.attachments) {
      const data = await attachment.download();
      attachmentBytes += data.length;
      if (attachmentBytes > 18 * 1024 * 1024) {
        throw new Error("The WhatsApp images are too large to attach to one email");
      }
      attachments.push({
        data,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      });
    }

    for (const { bridge, chat } of matches) {
      const emailMessage = stripLeadingPrefix(message.text, bridge.outgoingPrefix);
      if (!emailMessage) continue;
      for (const email of bridge.monitoredEmails) {
        const values = templateValues({
          message: emailMessage,
          sender: message.senderName,
          senderPhone: message.senderPhone,
          chat: chat.name,
          email,
        });
        const body = renderTemplate(bridge.emailBodyTemplate, values);
        const sent = await this.gmail.sendEmail(
          email,
          renderTemplate(bridge.emailSubjectTemplate, values),
          renderEmailPlainText(body, values),
          attachments,
          renderEmailHtml(bridge.emailBodyTemplate, values),
        );
        await this.state.markEmailThread(sent.threadId, {
          bridgeId: bridge.id,
          chatJid: message.chatJid,
          chatName: chat.name,
          recipient: email,
          quote: message.quote,
        });
      }
      await this.state.markWhatsApp(whatsappStateId(bridge.id, message.id));
    }
    this.lastForwardedAt = new Date().toISOString();
    this.lastError = undefined;
    console.info(`Forwarded WhatsApp message ${message.id} to Gmail`);
    return true;
  }

  async pollGmail(): Promise<void> {
    if (this.polling || !this.gmail.isConnected()) return;
    this.polling = true;
    try {
      const settings = this.settings.get();
      const monitoredEmails = [
        ...new Set(settings.bridges.flatMap((bridge) => bridge.monitoredEmails)),
      ];
      const replies = await this.gmail.listRepliesFrom(
        monitoredEmails,
        this.state.getEmailThreadIds(),
      );
      for (const reply of replies) {
        if (this.state.hasGmail(reply.id)) continue;
        const route = this.state.getEmailThread(reply.threadId);
        const bridge =
          settings.bridges.find((item) => item.id === route?.bridgeId) ?? settings.bridges[0];
        const values = templateValues({
          message: reply.text,
          chat: route?.chatName ?? bridge.whatsappChats[0],
          email: reply.from,
          subject: reply.subject,
        });
        const text = renderTemplate(bridge.whatsappReplyTemplate, values);
        if (route) {
          await this.whatsapp.sendToChat(route.chatJid, text, route.quote);
        } else {
          await this.whatsapp.sendToConfiguredChat(bridge.whatsappChats[0], text);
        }
        await this.state.markGmail(reply.id);
        this.lastForwardedAt = new Date().toISOString();
        this.lastError = undefined;
        console.info(`Forwarded Gmail reply ${reply.id} to WhatsApp`);
      }
      this.lastGmailCheckAt = new Date().toISOString();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.polling = false;
    }
  }

  getStatus() {
    return {
      polling: this.polling,
      lastGmailCheckAt: this.lastGmailCheckAt,
      lastForwardedAt: this.lastForwardedAt,
      lastError: this.lastError,
    };
  }
}

function hasPrefix(text: string, prefix: string): boolean {
  return text.trimStart().toLowerCase().startsWith(prefix.toLowerCase());
}

function whatsappStateId(bridgeId: string, messageId: string): string {
  return `${bridgeId}:${messageId}`;
}
