import assert from "node:assert/strict";
import test from "node:test";
import { createRawEmail } from "../src/gmail.js";

test("creates a multipart email with multiple image attachments", () => {
  const firstImage = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const secondImage = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const raw = createRawEmail(
    "bridge@example.com",
    "recipient@example.com",
    "A photo",
    "Here is the photo.",
    [
      { data: firstImage, filename: "whatsapp-image.png", mimeType: "image/png" },
      { data: secondImage, filename: "whatsapp-image.jpg", mimeType: "image/jpeg" },
    ],
    "<strong>Here is the photo.</strong>",
  );
  const message = Buffer.from(raw, "base64url").toString("utf8");

  assert.match(message, /Content-Type: multipart\/mixed; boundary="bridge-the-gap-/);
  assert.match(message, /Content-Type: multipart\/alternative; boundary="bridge-the-gap-alternative-/);
  assert.match(message, /Content-Type: text\/html; charset="UTF-8"/);
  assert.match(message, /Content-Type: image\/png; name="whatsapp-image\.png"/);
  assert.match(message, /Content-Disposition: attachment; filename="whatsapp-image\.png"/);
  assert.match(message, /Content-Type: image\/jpeg; name="whatsapp-image\.jpg"/);
  assert.match(message, /Content-Disposition: attachment; filename="whatsapp-image\.jpg"/);
  assert.match(message, new RegExp(firstImage.toString("base64")));
  assert.match(message, new RegExp(secondImage.toString("base64")));
  assert.match(message, new RegExp(Buffer.from("Here is the photo.").toString("base64")));
  assert.match(
    message,
    new RegExp(Buffer.from("<strong>Here is the photo.</strong>").toString("base64")),
  );
});

test("keeps text-only messages as plain text email", () => {
  const raw = createRawEmail(
    "bridge@example.com",
    "recipient@example.com",
    "Hello",
    "Plain text body",
  );
  const message = Buffer.from(raw, "base64url").toString("utf8");

  assert.match(message, /Content-Type: text\/plain; charset="UTF-8"/);
  assert.doesNotMatch(message, /multipart\/mixed/);
});
