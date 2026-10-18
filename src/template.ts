export type TemplateValues = Record<string, string>;

export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    return Object.hasOwn(values, key) ? values[key] : match;
  });
}

export function templateValues(values: {
  message: string;
  sender?: string;
  senderPhone?: string;
  chat?: string;
  group?: string;
  email?: string;
  subject?: string;
}): TemplateValues {
  const oneLine = values.message.replace(/\s+/g, " ").trim();
  return {
    message: values.message,
    message_short: oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 57)}...`,
    sender: values.sender ?? "",
    sender_phone: values.senderPhone ?? "",
    chat: values.chat ?? values.group ?? "",
    group: values.group ?? values.chat ?? "",
    email: values.email ?? "",
    subject: values.subject ?? "",
  };
}

export function renderEmailHtml(template: string, values: TemplateValues): string {
  const messageToken = /\{\{\s*message\s*\}\}/i.exec(template);
  const intro = messageToken ? renderTemplate(template.slice(0, messageToken.index), values).trim() : "";
  const message = messageToken ? values.message : renderTemplate(template, values);
  const footer = messageToken
    ? renderTemplate(template.slice(messageToken.index + messageToken[0].length), values).trim()
    : "";
  const phone = values.sender_phone
    ? `<span style="color:#667085">${escapeHtml(values.sender_phone)}</span>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f7f6;color:#17211b;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7f6;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e1e7e3;border-radius:16px">
          <tr><td style="padding:24px 26px 18px">
            <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#148447">Bridge the Gap</div>
            <div style="margin-top:14px;font-size:14px;line-height:1.6;color:#475467">
              <strong style="color:#17211b">${escapeHtml(values.sender || "WhatsApp sender")}</strong>${phone ? ` &nbsp;${phone}` : ""}<br>
              <span>${escapeHtml(values.chat || "WhatsApp conversation")}</span>
            </div>
            ${intro ? `<div style="margin-top:14px;font-size:14px;line-height:1.6;color:#475467">${formatText(intro)}</div>` : ""}
          </td></tr>
          <tr><td style="padding:0 26px 24px">
            <div style="border-left:4px solid #25d366;background:#f1faf4;border-radius:4px 12px 12px 4px;padding:18px 20px;font-size:18px;line-height:1.55;color:#17211b">${formatText(message)}</div>
          </td></tr>
          ${footer ? `<tr><td style="border-top:1px solid #e7ece9;padding:18px 26px 22px;font-size:13px;line-height:1.6;color:#667085">${formatText(footer)}</td></tr>` : ""}
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function renderEmailPlainText(body: string, values: TemplateValues): string {
  const details = [
    `Sender: ${values.sender || "WhatsApp sender"}`,
    values.sender_phone ? `WhatsApp number: ${values.sender_phone}` : "",
    `Conversation: ${values.chat || "WhatsApp conversation"}`,
  ].filter(Boolean);
  return `${details.join("\n")}\n\n${body}`;
}

function formatText(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
