import assert from "node:assert/strict";
import test from "node:test";
import {
  albumParentId,
  expectedAlbumImages,
  extractWhatsAppMessage,
  phoneNumberFromJid,
  quotedWhatsAppMessage,
  waitAtMost,
} from "../src/whatsapp.js";

test("extracts an outgoing WhatsApp text message", () => {
  const result = extractWhatsAppMessage({
    key: {
      fromMe: true,
      id: "message-123",
      remoteJid: "12025550147@s.whatsapp.net",
    },
    message: { conversation: "Hello there" },
    pushName: "Sample Sender",
  });
  assert.deepEqual(result, {
    chatJid: "12025550147@s.whatsapp.net",
    id: "message-123",
    senderName: "Sample Sender",
    text: "Hello there",
  });
});

test("extracts a message sent by another group participant", () => {
  const result = extractWhatsAppMessage({
    key: {
      fromMe: false,
      id: "message-456",
      remoteJid: "120363000000000000@g.us",
      participant: "12025550147@s.whatsapp.net",
    },
    message: { conversation: "Send: Hello" },
    pushName: "Group Member",
  });
  assert.deepEqual(result, {
    chatJid: "120363000000000000@g.us",
    id: "message-456",
    senderName: "Group Member",
    text: "Send: Hello",
  });
});

test("extracts an image and its Send caption", () => {
  const result = extractWhatsAppMessage({
    key: { fromMe: false, id: "image-123", remoteJid: "120363000000000000@g.us" },
    message: {
      imageMessage: {
        caption: "Send: Family photo",
        mimetype: "image/png",
      },
    },
    pushName: "Group Member",
  });
  assert.deepEqual(result, {
    chatJid: "120363000000000000@g.us",
    id: "image-123",
    senderName: "Group Member",
    text: "Send: Family photo",
    image: {
      filename: "whatsapp-image-image-123.png",
      mimeType: "image/png",
    },
  });
});

test("ignores an image without a caption", () => {
  const result = extractWhatsAppMessage({
    key: { fromMe: false, id: "image-123", remoteJid: "120363000000000000@g.us" },
    message: { imageMessage: { mimetype: "image/jpeg" } },
  });
  assert.equal(result, undefined);
});

test("identifies all images that belong to the same WhatsApp album", () => {
  const parent = {
    key: { fromMe: false, id: "album-123", remoteJid: "120363000000000000@g.us" },
    message: { albumMessage: { expectedImageCount: 3 } },
  };
  const image = {
    key: { fromMe: false, id: "image-123", remoteJid: "120363000000000000@g.us" },
    message: {
      imageMessage: { caption: "! Photos", mimetype: "image/jpeg" },
      messageContextInfo: {
        messageAssociation: {
          associationType: 1,
          parentMessageKey: parent.key,
        },
      },
    },
  };

  assert.equal(expectedAlbumImages(parent), 3);
  assert.equal(albumParentId(image), "album-123");
});

test("builds a quoted WhatsApp reply for the original group message", () => {
  const quoted = quotedWhatsAppMessage("120363000000000000@g.us", {
    id: "original-message",
    fromMe: false,
    participant: "12025550147@s.whatsapp.net",
    senderName: "Group Member",
    text: "! Are you coming?",
  });

  assert.deepEqual(quoted, {
    key: {
      remoteJid: "120363000000000000@g.us",
      id: "original-message",
      fromMe: false,
      participant: "12025550147@s.whatsapp.net",
    },
    message: { conversation: "! Are you coming?" },
    pushName: "Group Member",
  });
});

test("normalizes a linked-device JID to a phone number", () => {
  assert.equal(phoneNumberFromJid("12025550147:12@s.whatsapp.net"), "12025550147");
});

test("stops waiting when WhatsApp logout does not settle", async () => {
  const result = await waitAtMost(new Promise(() => undefined), 5);
  assert.equal(result, false);
});
