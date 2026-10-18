import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const port = positiveInteger("PORT", 3000);
  const host = process.env.HOST?.trim() || "127.0.0.1";
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && !adminPassword) {
    throw new Error("ADMIN_PASSWORD is required when HOST is exposed beyond this computer");
  }

  return {
    port,
    host,
    adminPassword,
    gmail: {
      clientId: required("GOOGLE_CLIENT_ID"),
      clientSecret: required("GOOGLE_CLIENT_SECRET"),
      redirectUri:
        process.env.GOOGLE_REDIRECT_URI?.trim() ||
        `http://localhost:${port}/auth/google/callback`,
      pollIntervalMs: positiveInteger("GMAIL_POLL_INTERVAL_MS", 30_000),
    },
    stateDir: path.resolve(process.env.STATE_DIR?.trim() || ".data"),
  };
}
