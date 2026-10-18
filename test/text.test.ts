import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanGmailReaction,
  extractMessageBody,
  removeQuotedReply,
  shortenSubject,
  stripLeadingPrefix,
} from "../src/text.js";

test("extracts a plain-text Gmail body", () => {
  const payload = {
    mimeType: "multipart/alternative",
    parts: [
      {
        mimeType: "text/plain",
        body: { data: Buffer.from("I will call tonight").toString("base64url") },
      },
    ],
  };
  assert.equal(extractMessageBody(payload), "I will call tonight");
});

test("removes Gmail's quoted reply", () => {
  const body = "Sounds good.\n\nOn Fri, Oct 17, 2026 at 8:00 PM Sender wrote:\n> Are you free?";
  assert.equal(removeQuotedReply(body), "Sounds good.");
});

test("keeps only the emoji from a Gmail reaction notification", () => {
  const body =
    "😡\n\nSample Recipient reacted via Gmail\n<https://www.google.com/gmail/about/?utm_source=gmail#app>";
  assert.equal(cleanGmailReaction(body), "😡");
});

test("shortens a subject without cutting short messages", () => {
  assert.equal(shortenSubject("Hello there"), "Hello there");
  assert.equal(shortenSubject("x".repeat(80)), `${"x".repeat(57)}...`);
});

test("removes the routing prefix before creating the email", () => {
  assert.equal(
    stripLeadingPrefix("Send: Are we still meeting tomorrow?", "Send:"),
    "Are we still meeting tomorrow?",
  );
  assert.equal(stripLeadingPrefix("  SEND: Hello", "Send:"), "Hello");
});
