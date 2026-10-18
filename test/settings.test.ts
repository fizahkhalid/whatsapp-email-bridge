import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsStore, validateSettings } from "../src/settings.js";
import {
  renderEmailHtml,
  renderEmailPlainText,
  renderTemplate,
  templateValues,
} from "../src/template.js";

const validSettings = {
  bridges: [
    {
      id: "family",
      name: "Family updates",
      whatsappChats: ["Family chat", "+12025550147"],
      monitoredEmails: ["PERSON@example.com"],
      outgoingPrefix: "!",
      emailSubjectTemplate: "[Bridge the Gap] {{message_short}}",
      emailBodyTemplate: "{{message}}",
      whatsappReplyTemplate: "Email reply from {{email}}: {{message}}",
    },
  ],
};

test("normalizes multiple bridge settings", () => {
  const result = validateSettings(validSettings);
  assert.deepEqual(result.bridges[0].whatsappChats, ["Family chat", "+12025550147"]);
  assert.deepEqual(result.bridges[0].monitoredEmails, ["person@example.com"]);
});

test("allows a fresh installation with no bridge routes", () => {
  assert.deepEqual(validateSettings({ bridges: [] }), { bridges: [] });
});

test("starts a fresh settings store without a manufactured bridge", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-settings-"));
  try {
    const store = new SettingsStore(directory);
    await store.load();
    assert.deepEqual(store.get(), { bridges: [] });
  } finally {
    await fs.rm(directory, { recursive: true });
  }
});

test("requires at least one WhatsApp chat and email", () => {
  assert.throws(
    () =>
      validateSettings({
        bridges: [{ ...validSettings.bridges[0], whatsappChats: [] }],
      }),
    /at least one whatsapp chat/i,
  );
  assert.throws(
    () =>
      validateSettings({
        bridges: [{ ...validSettings.bridges[0], monitoredEmails: [] }],
      }),
    /at least one email address/i,
  );
});

test("requires a unique ID for every bridge", () => {
  assert.throws(
    () => validateSettings({ bridges: [validSettings.bridges[0], validSettings.bridges[0]] }),
    /unique ID/i,
  );
});

test("renders bridge template variables", () => {
  const values = templateValues({
    message: `Send: ${"dinner ".repeat(12)}`,
    sender: "Sample Sender",
    senderPhone: "+12025550147",
    chat: "Family chat",
    email: "person@example.com",
  });
  assert.equal(renderTemplate("To {{email}} from {{chat}}", values), "To person@example.com from Family chat");
  assert.equal(renderTemplate("From {{sender}}", values), "From Sample Sender");
  assert.equal(renderTemplate("From {{sender_phone}}", values), "From +12025550147");
  assert.equal(values.message_short.length, 60);
});

test("renders a distinct message card, sender details, and footer", () => {
  const values = templateValues({
    message: "Dinner is ready <now>",
    sender: "Sample Sender",
    senderPhone: "+12025550147",
    chat: "Family chat",
  });
  const template = "{{message}}\n\nReply to this email to answer on WhatsApp.";
  const html = renderEmailHtml(template, values);
  const text = renderEmailPlainText(renderTemplate(template, values), values);

  assert.match(html, /Sample Sender/);
  assert.match(html, /\+12025550147/);
  assert.match(html, /Family chat/);
  assert.match(html, /Dinner is ready &lt;now&gt;/);
  assert.match(html, /border-top:1px solid/);
  assert.match(text, /WhatsApp number: \+12025550147/);
  assert.match(text, /Conversation: Family chat/);
});
