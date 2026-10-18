import fs from "node:fs/promises";
import path from "node:path";

export type BridgeRoute = {
  id: string;
  name: string;
  whatsappChats: string[];
  monitoredEmails: string[];
  outgoingPrefix: string;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  whatsappReplyTemplate: string;
};

export type BridgeSettings = {
  bridges: BridgeRoute[];
};

type LegacySettings = Partial<BridgeRoute> & { whatsappGroups?: string[] };

export class SettingsStore {
  private settings: BridgeSettings = { bridges: [] };

  constructor(private readonly stateDir: string) {}

  async load(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    try {
      const saved = JSON.parse(await fs.readFile(this.filePath, "utf8")) as
        | Partial<BridgeSettings>
        | LegacySettings;
      const migrated =
        "bridges" in saved && Array.isArray(saved.bridges)
          ? { bridges: saved.bridges.map(migrateBridge) }
          : { bridges: [migrateBridge(saved as LegacySettings)] };
      this.settings = validateSettings(migrated);
      await this.save();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  get(): BridgeSettings {
    return structuredClone(this.settings);
  }

  async update(value: unknown): Promise<BridgeSettings> {
    this.settings = validateSettings(value);
    await this.save();
    return this.get();
  }

  private async save(): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(this.settings, null, 2));
    await fs.rename(temporaryPath, this.filePath);
  }

  private get filePath(): string {
    return path.join(this.stateDir, "settings.json");
  }
}

export function validateSettings(value: unknown): BridgeSettings {
  if (!value || typeof value !== "object") throw new Error("Settings must be an object");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.bridges)) throw new Error("Bridges must be a list");
  if (input.bridges.length > 25) throw new Error("You cannot create more than 25 bridges");
  const bridges = input.bridges.map((bridge, index) => validateBridge(bridge, index));
  if (new Set(bridges.map((bridge) => bridge.id)).size !== bridges.length) {
    throw new Error("Each bridge must have a unique ID");
  }
  return { bridges };
}

function validateBridge(value: unknown, index: number): BridgeRoute {
  if (!value || typeof value !== "object") throw new Error(`Bridge ${index + 1} is invalid`);
  const input = value as Record<string, unknown>;
  const id = requiredString(input.id, "Bridge ID", 80);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
    throw new Error("Bridge IDs can only contain letters, numbers, dashes, and underscores");
  }
  const monitoredEmails = stringList(input.monitoredEmails, "Email addresses").map((email) =>
    email.toLowerCase(),
  );
  if (!monitoredEmails.every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("Enter valid email addresses");
  }
  return {
    id,
    name: requiredString(input.name, "Bridge name", 100),
    whatsappChats: stringList(input.whatsappChats, "WhatsApp chats"),
    monitoredEmails,
    outgoingPrefix: requiredString(input.outgoingPrefix, "Message prefix", 80),
    emailSubjectTemplate: requiredString(input.emailSubjectTemplate, "Email subject", 500),
    emailBodyTemplate: requiredString(input.emailBodyTemplate, "Email body", 10_000),
    whatsappReplyTemplate: requiredString(
      input.whatsappReplyTemplate,
      "WhatsApp reply template",
      10_000,
    ),
  };
}

function migrateBridge(value: LegacySettings): LegacySettings {
  const migrated = {
    ...value,
    id: value.id || "default",
    name: value.name || "My first bridge",
    whatsappChats: value.whatsappChats ?? value.whatsappGroups,
  };
  if (migrated.whatsappReplyTemplate === "Reply: {{message}}") {
    migrated.whatsappReplyTemplate = "Email reply from {{email}}:\n{{message}}";
  }
  const previousDefaultBodies = [
    "From {{sender}} in {{chat}}:\n\n{{message}}\n\nReply to this email and your reply will be sent back to WhatsApp.",
    "{{message}}\n\nReply to this email and your reply will be sent to the {{group}} WhatsApp group.",
    "{{message}}\n\nReply to this email and your reply will be sent back to {{chat}} on WhatsApp.",
  ];
  if (migrated.emailBodyTemplate && previousDefaultBodies.includes(migrated.emailBodyTemplate)) {
    migrated.emailBodyTemplate =
      "{{message}}\n\nReply to this email and your reply will be sent back to WhatsApp.";
  }
  return migrated;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  const items = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (items.length === 0) throw new Error(`Add at least one ${label.toLowerCase()}`);
  if (items.length > 25) throw new Error(`${label} cannot contain more than 25 items`);
  return items;
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new Error(`${label} cannot be empty`);
  if (result.length > maxLength) throw new Error(`${label} is too long`);
  return result;
}
