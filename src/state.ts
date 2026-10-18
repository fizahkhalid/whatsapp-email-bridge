import fs from "node:fs/promises";
import path from "node:path";
import type { WhatsAppQuote } from "./whatsapp.js";

type StateData = {
  processedWhatsAppIds: string[];
  processedGmailIds: string[];
  emailThreads: Record<string, EmailThreadRoute | LegacyEmailThreadRoute>;
};

type EmailThreadRoute = {
  bridgeId?: string;
  chatJid: string;
  chatName: string;
  recipient: string;
  quote?: WhatsAppQuote;
};
type LegacyEmailThreadRoute = { groupJid: string; groupName: string; recipient: string };

const EMPTY_STATE: StateData = {
  processedWhatsAppIds: [],
  processedGmailIds: [],
  emailThreads: {},
};

export class StateStore {
  private data: StateData = structuredClone(EMPTY_STATE);
  private saveQueue = Promise.resolve();

  constructor(
    private readonly stateDir: string,
    private readonly maxIds = 2_000,
  ) {}

  async load(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StateData>;
      this.data = {
        processedWhatsAppIds: parsed.processedWhatsAppIds ?? [],
        processedGmailIds: parsed.processedGmailIds ?? [],
        emailThreads: parsed.emailThreads ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  hasWhatsApp(id: string): boolean {
    return this.data.processedWhatsAppIds.includes(id);
  }

  hasGmail(id: string): boolean {
    return this.data.processedGmailIds.includes(id);
  }

  markWhatsApp(id: string): Promise<void> {
    this.data.processedWhatsAppIds = this.append(this.data.processedWhatsAppIds, id);
    return this.save();
  }

  markGmail(id: string): Promise<void> {
    this.data.processedGmailIds = this.append(this.data.processedGmailIds, id);
    return this.save();
  }

  getEmailThreadIds(): string[] {
    return Object.keys(this.data.emailThreads);
  }

  getEmailThread(threadId: string) {
    const route = this.data.emailThreads[threadId];
    if (!route) return undefined;
    if ("chatJid" in route) return route;
    return {
      chatJid: route.groupJid,
      chatName: route.groupName,
      recipient: route.recipient,
    };
  }

  markEmailThread(
    threadId: string,
    route: EmailThreadRoute,
  ): Promise<void> {
    this.data.emailThreads[threadId] = route;
    const entries = Object.entries(this.data.emailThreads).slice(-this.maxIds);
    this.data.emailThreads = Object.fromEntries(entries);
    return this.save();
  }

  private get filePath(): string {
    return path.join(this.stateDir, "state.json");
  }

  private append(ids: string[], id: string): string[] {
    return [...ids.filter((existing) => existing !== id), id].slice(-this.maxIds);
  }

  private save(): Promise<void> {
    this.saveQueue = this.saveQueue.then(async () => {
      const temporaryPath = `${this.filePath}.tmp`;
      await fs.writeFile(temporaryPath, JSON.stringify(this.data, null, 2));
      await fs.rename(temporaryPath, this.filePath);
    });
    return this.saveQueue;
  }
}
