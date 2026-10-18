<div align="center">

# Bridge the Gap

### A small, self-hosted bridge between WhatsApp conversations and email

[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-315c48?style=flat-square)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-315c48?style=flat-square)](https://www.typescriptlang.org/)
[![Self-hosted](https://img.shields.io/badge/self--hosted-local%20first-315c48?style=flat-square)](#where-data-lives)

</div>

Some people live in WhatsApp groups. Others prefer email.

I made Bridge the Gap so friends and family can stay in the same conversation without forcing either side to change how they communicate. A WhatsApp message with a chosen prefix becomes an email. The email reply returns to the WhatsApp conversation that started it.

## How a conversation moves

| WhatsApp | Bridge the Gap | Email |
|---|---|---|
| Someone writes `! Dinner is at 8` | Removes the prefix and keeps the sender and chat context | The recipient gets a clear email |
| The original message stays in the group | Remembers which message and conversation created the email | The recipient replies normally |
| A quoted reply appears under the original message | Sends the reply back to the correct place | No WhatsApp account is needed |

The bridge reacts with `🟢` after Gmail accepts the email and `🔴` if forwarding fails.

## What it supports

- WhatsApp groups and direct chats
- Any participant in a configured conversation
- Separate routes for different people or groups
- A different prefix, recipient list, and templates for each bridge
- Sender name, WhatsApp number when available, and conversation name in email
- Images and multi-image albums
- Quoted WhatsApp replies for email responses
- Gmail reaction emails cleaned down to the actual emoji
- Account switching for Gmail and WhatsApp
- Local configuration and persistent sessions

## Quick start

### 1. Install

Requirements:

- Node.js 20 or newer
- A Gmail account
- A WhatsApp account that can link another device

```bash
Clone the repository
cd whatsapp-email-bridge
nvm use
npm install
cp .env.example .env
```

### 2. Prepare Gmail OAuth

Google requires an OAuth client before the app can connect to Gmail:

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the Gmail API.
3. Configure the OAuth consent screen.
4. Add your Gmail account as a test user while the app is in testing mode.
5. Create an OAuth client with the type **Web application**.
6. Add `http://localhost:3000/auth/google/callback` as an authorized redirect URI.
7. Put the client ID and secret in `.env`.

The running app also includes the same instructions at `/setup`, with the correct callback URL for that installation.

### 3. Configure the environment

```dotenv
PORT=3000
HOST=127.0.0.1
ADMIN_PASSWORD=

GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

GMAIL_POLL_INTERVAL_MS=30000
STATE_DIR=.data
```

Use `HOST=0.0.0.0` and set a strong `ADMIN_PASSWORD` when hosting the app publicly. Bridge routes are created from the web interface after startup.

### 4. Start the app

```bash
npm start
```

Open:

- Landing page: [http://localhost:3000](http://localhost:3000)
- Setup guide: [http://localhost:3000/setup](http://localhost:3000/setup)
- Configuration: [http://localhost:3000/configure](http://localhost:3000/configure)

Connect Gmail, link WhatsApp by scanning the QR code from **WhatsApp → Settings → Linked Devices**, then create the first bridge route.

## Multiple bridges

The WhatsApp and Gmail connections belong to the installation. Message routes are separate.

For example:

| Bridge | Watches | Prefix | Sends to |
|---|---|---|---|
| Family updates | Family group | `!` | A relative’s email |
| Project notes | Project group | `>>` | A collaborator’s email |

Each route controls:

- Its private display name
- WhatsApp groups or direct chats to monitor
- Email recipients allowed to reply
- Trigger prefix
- Email subject and body templates
- WhatsApp reply template

## Template values

- `{{message}}`
- `{{message_short}}`
- `{{sender}}`
- `{{sender_phone}}`
- `{{chat}}`
- `{{email}}`
- `{{subject}}`

## Where data lives

Bridge the Gap stores local runtime data under `.data/`:

- WhatsApp linked-device credentials
- Google OAuth tokens
- Message routing state
- Saved bridge configuration

The real `.env` and `.data/` directory are ignored by Git. Treat both like passwords and include the state directory in private deployment backups.

When exposing the app outside your computer:

- Set a strong `ADMIN_PASSWORD`.
- Serve it only through HTTPS.
- Keep `.data/` on a persistent private volume.
- Do not expose the configuration routes without authentication.

The server refuses to bind to a public host without an admin password.

## Important WhatsApp limitation

This project uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp linked-device library. It does not require a WhatsApp Business account, which is what makes personal groups possible, but WhatsApp can change or restrict this behavior.

Use human-sized message volumes. A separate WhatsApp number is safer if losing access to a primary number would be costly.

## Development

```bash
npm test
npm run typecheck
```

Main folders:

```text
public/   landing page, setup guide, and configuration UI
src/      Gmail, WhatsApp, routing, settings, and server code
test/     behavior tests for routing, templates, media, and email
.data/    local private runtime state, never committed
```

## Current scope

This repository is designed for one trusted installation with one linked WhatsApp account and one connected Gmail account. It does not provide hosted user accounts, billing, or isolation between unrelated customers.

That smaller scope is deliberate. Run it for people you know, adapt it, and open an issue when a real use case exposes something missing.
