import assert from "node:assert/strict";
import test from "node:test";
import { Bridge } from "../src/bridge.js";
import type { BridgeSettings } from "../src/settings.js";

test("routes a message through the bridge with the matching chat and prefix", async () => {
  const sent: Array<{ to: string; subject: string; body: string }> = [];
  const routes: Array<{ threadId: string; route: Record<string, unknown> }> = [];
  const processed: string[] = [];
  const settings: BridgeSettings = {
    bridges: [
      route("family", "!", "family@example.com"),
      route("friends", "#", "friends@example.com"),
    ],
  };
  const gmail = {
    isConnected: () => true,
    sendEmail: async (to: string, subject: string, body: string) => {
      sent.push({ to, subject, body });
      return { id: "email-1", threadId: "thread-1" };
    },
  };
  const whatsapp = {
    getMonitoredChat: (_jid: string, chats: string[]) =>
      chats.includes("Family chat") ? { jid: "family@g.us", name: "Family chat" } : undefined,
  };
  const state = {
    hasWhatsApp: () => false,
    markWhatsApp: async (id: string) => {
      processed.push(id);
    },
    markEmailThread: async (threadId: string, value: Record<string, unknown>) => {
      routes.push({ threadId, route: value });
    },
  };

  const bridge = new Bridge(gmail as never, whatsapp as never, state as never, {
    get: () => settings,
  } as never);
  const handled = await bridge.handleWhatsApp({
    chatJid: "family@g.us",
    id: "message-1",
    senderName: "Sample Sender",
    senderPhone: "+12025550147",
    text: "! Dinner is ready",
    quote: {
      id: "message-1",
      fromMe: false,
      participant: "sender@s.whatsapp.net",
      senderName: "Sample Sender",
      text: "! Dinner is ready",
    },
    attachments: [],
  });

  assert.equal(handled, true);
  assert.deepEqual(sent.map((email) => email.to), ["family@example.com"]);
  assert.deepEqual(processed, ["family:message-1"]);
  assert.equal(routes[0]?.route.bridgeId, "family");
});

test("does not poll Gmail before the first bridge is created", async () => {
  const gmail = {
    isConnected: () => true,
    listRepliesFrom: async () => {
      throw new Error("Gmail should not be polled without recipients");
    },
  };
  const state = { getEmailThreadIds: () => [] };
  const bridge = new Bridge(gmail as never, {} as never, state as never, {
    get: () => ({ bridges: [] }),
  } as never);

  await bridge.pollGmail();

  assert.ok(bridge.getStatus().lastGmailCheckAt);
});

function route(id: string, prefix: string, email: string) {
  return {
    id,
    name: `${id} bridge`,
    whatsappChats: ["Family chat"],
    monitoredEmails: [email],
    outgoingPrefix: prefix,
    emailSubjectTemplate: "{{message_short}}",
    emailBodyTemplate: "{{message}}",
    whatsappReplyTemplate: "{{message}}",
  };
}
