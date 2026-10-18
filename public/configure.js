const state = { bridges: [], savedBridges: [], activeId: "", relinkRequested: false, dirty: false };
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((item) => [item.id, item]));

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function toast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (elements.toast.className = "toast"), 3000);
}

function activeBridge() {
  return state.bridges.find((bridge) => bridge.id === state.activeId);
}

function markChanged() {
  state.dirty = true;
  elements.saveState.textContent = "You have unsaved changes.";
}

function renderBridgeList() {
  elements.bridgeList.replaceChildren();
  for (const bridge of state.bridges) {
    const row = document.createElement("article");
    row.className = "bridge-list-item";
    const copy = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = bridge.name;
    const details = document.createElement("p");
    const chats = `${bridge.whatsappChats.length} WhatsApp ${bridge.whatsappChats.length === 1 ? "chat" : "chats"}`;
    const recipients = `${bridge.monitoredEmails.length} email ${bridge.monitoredEmails.length === 1 ? "recipient" : "recipients"}`;
    details.textContent = `${chats} · ${recipients} · Prefix ${bridge.outgoingPrefix}`;
    copy.append(name, details);
    const open = document.createElement("button");
    open.className = "button-secondary bridge-open-button";
    open.type = "button";
    open.textContent = "Open";
    open.addEventListener("click", () => openBridge(bridge.id));
    row.append(copy, open);
    elements.bridgeList.append(row);
  }
}

function renderTags(container, items, type) {
  container.replaceChildren();
  for (const item of items) {
    const tag = document.createElement("span");
    tag.className = "tag";
    const text = document.createElement("span");
    text.textContent = item;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${item}`);
    remove.addEventListener("click", () => {
      const bridge = activeBridge();
      const key = type === "chat" ? "whatsappChats" : "monitoredEmails";
      bridge[key] = bridge[key].filter((value) => value !== item);
      renderAllTags();
      markChanged();
    });
    tag.append(text, remove);
    container.append(tag);
  }
}

function renderAllTags() {
  const bridge = activeBridge();
  if (!bridge) return;
  renderTags(elements.chatTags, bridge.whatsappChats, "chat");
  renderTags(elements.emailTags, bridge.monitoredEmails, "email");
}

function readBridgeFields() {
  const bridge = activeBridge();
  if (!bridge) return;
  bridge.name = elements.bridgeName.value.trim();
  bridge.outgoingPrefix = elements.outgoingPrefix.value.trim();
  bridge.emailSubjectTemplate = elements.emailSubjectTemplate.value;
  bridge.emailBodyTemplate = elements.emailBodyTemplate.value;
  bridge.whatsappReplyTemplate = elements.whatsappReplyTemplate.value;
}

function openBridge(id) {
  const bridge = state.bridges.find((item) => item.id === id);
  if (!bridge) return;
  state.activeId = bridge.id;
  elements.bridgeName.value = bridge.name;
  elements.outgoingPrefix.value = bridge.outgoingPrefix;
  elements.emailSubjectTemplate.value = bridge.emailSubjectTemplate;
  elements.emailBodyTemplate.value = bridge.emailBodyTemplate;
  elements.whatsappReplyTemplate.value = bridge.whatsappReplyTemplate;
  elements.bridgeEditorTitle.textContent = bridge.name;
  elements.deleteBridge.disabled = state.bridges.length === 1;
  state.dirty = false;
  elements.saveState.textContent = "Settings are saved locally.";
  renderAllTags();
  elements.bridgeListView.hidden = true;
  elements.bridgeEditor.hidden = false;
}

function closeBridge() {
  readBridgeFields();
  if (state.dirty && !confirm("Discard your unsaved changes?")) return;
  if (state.dirty) state.bridges = structuredClone(state.savedBridges);
  state.dirty = false;
  state.activeId = "";
  elements.bridgeEditor.hidden = true;
  elements.bridgeListView.hidden = false;
  renderBridgeList();
}

function addItem(type) {
  const bridge = activeBridge();
  const input = type === "chat" ? elements.chatInput : elements.emailInput;
  const value = input.value.trim();
  if (!bridge || !value) return;
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    toast("Enter a valid email address.", true);
    return;
  }
  const list = type === "chat" ? bridge.whatsappChats : bridge.monitoredEmails;
  if (!list.some((item) => item.toLowerCase() === value.toLowerCase())) list.push(value);
  input.value = "";
  renderAllTags();
  markChanged();
}

function showCreateDialog() {
  elements.createBridgeForm.reset();
  elements.newBridgePrefix.value = "!";
  elements.createBridgeDialog.showModal();
  elements.newBridgeName.focus();
}

function closeCreateDialog() {
  elements.createBridgeDialog.close();
}

async function createBridge(event) {
  event.preventDefault();
  const bridge = {
    id: `bridge-${Date.now().toString(36)}`,
    name: elements.newBridgeName.value.trim(),
    whatsappChats: [elements.newBridgeChat.value.trim()],
    monitoredEmails: [elements.newBridgeEmail.value.trim().toLowerCase()],
    outgoingPrefix: elements.newBridgePrefix.value.trim(),
    emailSubjectTemplate: "[Bridge the Gap] {{message_short}}",
    emailBodyTemplate: "{{message}}\n\nReply to this email and your reply will be sent back to WhatsApp.",
    whatsappReplyTemplate: "Email reply from {{email}}:\n{{message}}",
  };
  if (!bridge.name || !bridge.whatsappChats[0] || !bridge.monitoredEmails[0] || !bridge.outgoingPrefix) {
    toast("Complete every field before creating the bridge.", true);
    return;
  }
  elements.createBridgeButton.disabled = true;
  elements.createBridgeButton.textContent = "Creating...";
  try {
    const saved = await persistSettings([...state.bridges, bridge]);
    state.bridges = structuredClone(saved.bridges);
    state.savedBridges = structuredClone(saved.bridges);
    closeCreateDialog();
    renderBridgeList();
    openBridge(bridge.id);
    toast("Bridge created.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.createBridgeButton.disabled = false;
    elements.createBridgeButton.textContent = "Create bridge";
  }
}

async function deleteBridge() {
  if (state.bridges.length === 1) return;
  const bridge = activeBridge();
  if (!bridge || !confirm(`Delete “${bridge.name}”?`)) return;
  elements.deleteBridge.disabled = true;
  try {
    const saved = await persistSettings(state.bridges.filter((item) => item.id !== bridge.id));
    state.bridges = structuredClone(saved.bridges);
    state.savedBridges = structuredClone(saved.bridges);
    state.dirty = false;
    closeBridge();
    toast("Bridge deleted.");
  } catch (error) {
    toast(error.message, true);
    elements.deleteBridge.disabled = false;
  }
}

async function loadSettings() {
  const settings = await request("/api/settings");
  state.bridges = structuredClone(settings.bridges);
  state.savedBridges = structuredClone(settings.bridges);
  renderBridgeList();
}

async function loadAvailableChats() {
  const chats = await request("/api/whatsapp/chats");
  elements.availableChats.replaceChildren();
  for (const chat of chats) {
    const option = document.createElement("option");
    option.value = chat.name;
    option.label = chat.type === "group" ? "WhatsApp group" : "Direct chat";
    elements.availableChats.append(option);
  }
}

function validateBridges(bridges) {
  return bridges.find(
    (bridge) => !bridge.name || !bridge.outgoingPrefix || !bridge.whatsappChats.length || !bridge.monitoredEmails.length,
  );
}

function persistSettings(bridges) {
  return request("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bridges }),
  });
}

async function saveSettings(event) {
  event.preventDefault();
  readBridgeFields();
  const incomplete = validateBridges(state.bridges);
  if (incomplete) {
    toast(`Complete the chats, recipients, name, and prefix for “${incomplete.name || "Untitled bridge"}”.`, true);
    return;
  }
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "Saving...";
  try {
    const saved = await persistSettings(state.bridges);
    state.bridges = structuredClone(saved.bridges);
    state.savedBridges = structuredClone(saved.bridges);
    state.dirty = false;
    const bridge = activeBridge();
    elements.bridgeEditorTitle.textContent = bridge.name;
    elements.saveState.textContent = "All changes saved.";
    toast("Bridge saved.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = "Save changes";
  }
}

async function refreshStatus() {
  try {
    const status = await request("/api/status");
    const wa = status.whatsapp;
    elements.whatsappStatus.textContent = wa.connected ? "Connected" : statusText(wa.state);
    elements.gmailStatus.textContent = status.gmail.connected
      ? status.gmail.accountEmail || "Connected"
      : "Not connected";
    elements.whatsappDot.classList.toggle("online", wa.connected);
    elements.gmailDot.classList.toggle("online", status.gmail.connected);
    elements.gmailConnect.textContent = status.gmail.connected ? "Switch account" : "Connect Gmail";
    elements.gmailDisconnect.hidden = !status.gmail.connected;

    const ready = wa.connected && status.gmail.connected;
    elements.overallDot.classList.toggle("online", ready);
    elements.overallStatus.textContent = ready ? "Bridge is running" : "Setup needs attention";
    elements.lastCheck.textContent = status.bridge.lastGmailCheckAt
      ? `Inbox last checked ${relativeTime(status.bridge.lastGmailCheckAt)}.`
      : "Waiting for the first inbox check.";

    const showQrPanel = !wa.connected && (wa.relinking || wa.state === "waiting_for_qr" || state.relinkRequested);
    elements.qrPanel.hidden = !showQrPanel;
    elements.qrImage.hidden = !wa.qrDataUrl;
    elements.qrLoading.hidden = Boolean(wa.qrDataUrl) || Boolean(wa.lastError);
    elements.retryQrButton.hidden =
      !wa.lastError && (wa.relinking || wa.state === "waiting_for_qr" || wa.state === "connecting");
    elements.qrError.textContent = wa.lastError || "";
    if (wa.qrDataUrl) {
      elements.qrImage.src = wa.qrDataUrl;
      state.relinkRequested = false;
    }
    elements.relinkButton.textContent = wa.connected ? "Link a different account" : "Create QR code";
    elements.relinkButton.disabled = Boolean(wa.relinking);
  } catch {
    elements.overallStatus.textContent = "Bridge is offline";
  }
}

function statusText(status) {
  if (status === "waiting_for_qr") return "Waiting for QR scan";
  if (status === "connecting") return "Connecting";
  return "Not connected";
}

function relativeTime(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  return `${Math.floor(seconds / 60)} minutes ago`;
}

async function requestRelink() {
  const currentlyConnected = elements.whatsappDot.classList.contains("online");
  if (currentlyConnected && !confirm("This will unlink the current WhatsApp account. Continue?")) return;
  state.relinkRequested = true;
  elements.qrPanel.hidden = false;
  elements.qrImage.hidden = true;
  elements.qrLoading.hidden = false;
  elements.qrError.textContent = "";
  elements.relinkButton.disabled = true;
  try {
    await request("/api/whatsapp/relink", { method: "POST" });
    await refreshStatus();
  } catch (error) {
    state.relinkRequested = false;
    toast(error.message, true);
  }
}

async function disconnectGmail() {
  if (!confirm("Disconnect the current Gmail account?")) return;
  elements.gmailDisconnect.disabled = true;
  try {
    await request("/api/gmail/disconnect", { method: "POST" });
    await refreshStatus();
    toast("Gmail disconnected.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.gmailDisconnect.disabled = false;
  }
}

elements.settingsForm.addEventListener("submit", saveSettings);
elements.addChat.addEventListener("click", () => addItem("chat"));
elements.addEmail.addEventListener("click", () => addItem("email"));
elements.addBridge.addEventListener("click", showCreateDialog);
elements.createBridgeForm.addEventListener("submit", createBridge);
elements.cancelCreateBridge.addEventListener("click", closeCreateDialog);
elements.cancelCreateBridgeBottom.addEventListener("click", closeCreateDialog);
elements.closeBridge.addEventListener("click", closeBridge);
elements.deleteBridge.addEventListener("click", deleteBridge);
elements.relinkButton.addEventListener("click", requestRelink);
elements.retryQrButton.addEventListener("click", requestRelink);
elements.gmailDisconnect.addEventListener("click", disconnectGmail);
elements.bridgeName.addEventListener("input", () => {
  const bridge = activeBridge();
  if (bridge) bridge.name = elements.bridgeName.value;
});
elements.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); addItem("chat"); }
});
elements.emailInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); addItem("email"); }
});
elements.createBridgeDialog.addEventListener("click", (event) => {
  if (event.target === elements.createBridgeDialog) closeCreateDialog();
});
for (const input of document.querySelectorAll("#bridgeEditor input, #bridgeEditor textarea")) {
  input.addEventListener("input", markChanged);
}

try {
  await loadSettings();
  await Promise.all([loadAvailableChats(), refreshStatus()]);
  setInterval(refreshStatus, 5000);
  if (new URLSearchParams(location.search).get("gmail") === "connected") {
    toast("Gmail connected.");
    history.replaceState({}, "", "/configure");
  }
} catch (error) {
  toast(error.message, true);
}
