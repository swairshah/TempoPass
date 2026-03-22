<p align="center">
  <img src="extension/icons/icon128.png" alt="Tempo Access Key" width="96">
</p>

<h1 align="center">Tempo Access Key Browser Extension</h1>

<p align="center">
  A Chrome extension that creates time-limited, spending-capped access keys for your existing Tempo wallet. Uses your actual wallet passkey — no private keys, no new wallets.
</p>


```
┌─────────────────────────────────────────────────────────┐
│  CONNECT (once)                                         │
│  Click "Connect Wallet" → reads your passkey credential │
│  from wallet.tempo.xyz (opens briefly, then closes)     │
├─────────────────────────────────────────────────────────┤
│  CREATE ACCESS KEY (each session)                       │
│  Set expiry (1h–10d) + spending limit ($X pathUSD)      │
│  → Your wallet passkey signs → Touch ID / Face ID       │
│  → P256 access key authorized on-chain                  │
├─────────────────────────────────────────────────────────┤
│  TRANSACT (no biometric needed!)                        │
│  Access key signs all transactions automatically        │
│  Protocol enforces expiry + spending limits on-chain    │
│  When expired → passkey prompt again for a new key      │
└─────────────────────────────────────────────────────────┘
```

## Key Design

- Uses your EXISTING Tempo wallet passkey
- Chrome's "Site RP ID Claiming" (Chrome 122+) lets the extension trigger your wallet.tempo.xyz passkey directly
- The extension reads your credential from wallet.tempo.xyz's localStorage (one-time setup)
- No private keys ever displayed or typed
- On-chain enforcement of expiry & spending limits by the Tempo protocol

## Getting Started

### 1. Prerequisites
- Chrome 122+ (for WebAuthn RP ID claiming)
- An existing Tempo wallet at [wallet.tempo.xyz](https://wallet.tempo.xyz)

### 2. Install & Build
```bash
npm install
npm run build:ext
```

### 3. Load in Chrome
1. `chrome://extensions/` → enable **Developer mode**
2. Load unpacked → select `extension/dist`
3. Click the extension icon

### 4. Connect & Use
1. **Connect Wallet** — briefly opens wallet.tempo.xyz to read your credential
2. **Create Access Key** — set expiry + limit → passkey biometric prompt
3. **Send Transfers** — instant, no biometric needed

## Project Structure

```
tempo-extension/
├── test-access-key.ts          # Standalone TypeScript PoC
├── extension/
│   ├── src/popup.ts            # Extension UI + passkey bridge logic
│   ├── src/background.ts       # Service worker
│   ├── public/                 # manifest.json, popup.html, popup.css
│   ├── build.mjs               # esbuild bundler
│   └── dist/                   # Built extension — load this in Chrome
└── package.json
```

## Network

| Property | Value |
|----------|-------|
| Chain ID | `4217` |
| RPC | `https://rpc.presto.tempo.xyz` |
| Explorer | `https://explorer.tempo.xyz` |

## Tech Stack

- [viem/tempo](https://viem.sh/tempo) — Tempo TypeScript SDK
- Chrome Extension MV3 + WebAuthn RP ID Claiming
- [esbuild](https://esbuild.github.io) — Bundler
