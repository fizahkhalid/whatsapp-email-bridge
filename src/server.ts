import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import { Bridge } from "./bridge.js";
import { loadConfig } from "./config.js";
import { GmailClient } from "./gmail.js";
import { StateStore } from "./state.js";
import { SettingsStore } from "./settings.js";
import { LinkedWhatsAppClient } from "./whatsapp.js";

const config = loadConfig();
const state = new StateStore(config.stateDir);
await state.load();
const settings = new SettingsStore(config.stateDir);
await settings.load();

const gmail = new GmailClient(config.gmail, config.stateDir);
await gmail.loadSavedCredentials();

const whatsapp = new LinkedWhatsAppClient(config.stateDir);
whatsapp.setMonitoredChats(allWhatsAppChats(settings.get()));
const bridge = new Bridge(gmail, whatsapp, state, settings);
const app = express();

app.use(express.json({ limit: "100kb" }));
app.use(["/configure", "/configure.html", "/configure.js", "/api", "/auth/google"], (request, response, next) => {
  if (!config.adminPassword && isLoopback(request.ip)) {
    next();
    return;
  }
  const authorization = request.headers.authorization;
  const encoded = authorization?.startsWith("Basic ") ? authorization.slice(6) : "";
  const decoded = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
  const suppliedPassword = decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : "";
  if (config.adminPassword && secureEqual(suppliedPassword, config.adminPassword)) {
    next();
    return;
  }
  response.setHeader("WWW-Authenticate", 'Basic realm="Bridge the Gap"');
  response.status(401).send("Configuration access requires the admin password.");
});
app.use(express.static(path.resolve("public")));

app.get("/configure", (_request, response) => {
  response.sendFile(path.resolve("public/configure.html"));
});

app.get("/setup", (_request, response) => {
  response.sendFile(path.resolve("public/setup.html"));
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    gmailConnected: gmail.isConnected(),
    whatsappConnected: whatsapp.isConnected(),
  });
});

app.get("/api/status", (_request, response) => {
  response.json({
    gmail: { connected: gmail.isConnected(), accountEmail: gmail.getAccountEmail() || undefined },
    whatsapp: whatsapp.getStatus(),
    bridge: bridge.getStatus(),
    pollIntervalMs: config.gmail.pollIntervalMs,
  });
});

app.get("/api/whatsapp/chats", (_request, response) => {
  response.json(whatsapp.getAvailableChats());
});

app.get("/api/settings", (_request, response) => {
  response.json(settings.get());
});

app.put("/api/settings", async (request, response) => {
  try {
    const saved = await settings.update(request.body);
    whatsapp.setMonitoredChats(allWhatsAppChats(saved));
    response.json(saved);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/whatsapp/relink", (_request, response) => {
  void whatsapp.relink().catch(console.error);
  response.status(202).json({ ok: true });
});

app.post("/api/gmail/disconnect", async (_request, response) => {
  try {
    await gmail.disconnect();
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

let oauthState: { value: string; expiresAt: number } | undefined;

app.get("/auth/google", (_request, response) => {
  oauthState = {
    value: crypto.randomBytes(24).toString("hex"),
    expiresAt: Date.now() + 10 * 60_000,
  };
  response.redirect(gmail.getAuthorizationUrl(oauthState.value));
});

app.get("/auth/google/callback", async (request, response) => {
  const code = typeof request.query.code === "string" ? request.query.code : undefined;
  const returnedState = typeof request.query.state === "string" ? request.query.state : undefined;
  if (!code || !oauthState || returnedState !== oauthState.value || Date.now() > oauthState.expiresAt) {
    response.status(400).send("Invalid or expired Google authorization request.");
    return;
  }

  oauthState = undefined;
  try {
    await gmail.finishAuthorization(code);
    response.redirect("/configure?gmail=connected");
  } catch (error) {
    console.error(error);
    response.status(500).send("Could not connect Gmail. Check the server log.");
  }
});

app.listen(config.port, config.host, () => {
  console.info(`Bridge the Gap listening at http://${config.host}:${config.port}`);
});

await whatsapp.start((message) => bridge.handleWhatsApp(message));

setInterval(() => {
  void bridge.pollGmail().catch(console.error);
}, config.gmail.pollIntervalMs).unref();

void bridge.pollGmail().catch(console.error);

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function allWhatsAppChats(settingsValue: ReturnType<SettingsStore["get"]>): string[] {
  return [...new Set(settingsValue.bridges.flatMap((bridge) => bridge.whatsappChats))];
}
