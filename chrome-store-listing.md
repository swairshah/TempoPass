# Chrome Web Store Listing — TempoPass

## Name
TempoPass

## Short Description (132 chars max)
Delegate signing from your Tempo wallet with time-limited, spending-capped access keys. Auto-pay MPP content with no biometric prompts.

## Detailed Description

TempoPass lets you create time-limited, spending-capped signing keys for your existing Tempo wallet at wallet.tempo.xyz. Instead of authenticating with your passkey for every single transaction, you authorize an access key once — then it handles signing automatically until it expires or hits its spending limit.

HOW IT WORKS

1. Connect your wallet — the extension briefly opens wallet.tempo.xyz to read your passkey credential. No private keys are ever displayed, exported, or stored in plain text.

2. Create an access key — choose an expiry (1 hour to 10 days) and a USDC spending cap. Your passkey (Touch ID / Face ID) signs the on-chain authorization. This is the only biometric prompt you'll see.

3. Transact freely — send USDC transfers directly from the extension popup, or browse the web and let the access key auto-pay MPP (Micropayment Protocol) content. The Tempo protocol enforces your expiry and spending limits on-chain.

KEY FEATURES

• Time-limited keys: Choose from 1 hour to 10 days. When the key expires, it can no longer sign anything.
• Spending caps: Set a maximum USDC amount the key can spend. Enforced on-chain by the Tempo protocol, not just client-side.
• MPP auto-payments: Websites using the Micropayment Protocol (HTTP 402 + WWW-Authenticate: Payment) are paid automatically — no popups, no confirmation dialogs.
• Transaction history: View your recent transfers with links to the Tempo block explorer.
• No new wallets: Uses your existing Tempo passkey. Nothing new to back up.
• On-chain security: Access key limits are enforced by the Tempo smart contract, not by the extension.

SECURITY MODEL

Your passkey private key never leaves your device's secure enclave. The extension reads only your credential ID and public key from wallet.tempo.xyz (one-time setup). Access keys are P256 keypairs generated locally, authorized on-chain with your passkey, and stored in Chrome's session storage (cleared when Chrome closes). The spending limit and expiry are enforced by the Tempo protocol at the chain level.

PERMISSIONS EXPLAINED

• Storage: Saves your wallet credential reference and transaction history locally.
• Alarms: Checks access key expiry every minute.
• Scripting: Used once during wallet connection to read your credential from wallet.tempo.xyz.
• Host permissions (tempo.xyz): Required for the one-time credential read during wallet connection.
• Content scripts (all URLs): The MPP payment handler must run on every page to intercept HTTP 402 responses from any website that charges for content via the Micropayment Protocol.

NETWORK

• Chain: Tempo mainnet (Chain ID 4217)
• RPC: https://rpc.presto.tempo.xyz
• Explorer: https://explorer.tempo.xyz

This extension is open source. Your wallet, your keys, your rules.

## Category
Productivity

## Language
English

---

## Permissions Justification (for Chrome Web Store review form)

### storage
Stores the user's wallet credential reference (credential ID and public key only — no private keys) in chrome.storage.local, and the active access key session in chrome.storage.session. Also stores a transaction log of recent transfers (last 20 entries) for the history view.

### alarms
A single alarm ("checkExpiry") fires every 60 seconds to check whether the current access key has expired. If expired, the session is cleared from storage automatically.

### scripting
Used exactly once during wallet connection: the extension opens wallet.tempo.xyz in a background tab and executes a script to read the user's passkey credential ID and public key from that page's localStorage. The tab is immediately closed afterward. This is the only use of the scripting permission.

### activeTab
Used in conjunction with the scripting permission during wallet connection to access the wallet.tempo.xyz tab.

### host_permissions (https://wallet.tempo.xyz/*, https://*.tempo.xyz/*)
Required to execute the credential-reading script on wallet.tempo.xyz during the one-time wallet connection flow. The extension does not access or modify any other data on tempo.xyz.

### content_scripts — <all_urls>
The extension implements the Micropayment Protocol (MPP), an open standard for web monetization. MPP works by intercepting HTTP 402 (Payment Required) responses from any website and automatically paying the requested amount using the user's access key. Because any website can implement MPP, the content script must be injected on all pages to detect 402 responses. The content script is minimal (~50 lines) — it injects a fetch wrapper and bridges payment challenges to the background service worker.

### web_accessible_resources — <all_urls>
The MPP fetch wrapper (mpp-inject.js) must be injected into the page's MAIN world to intercept fetch() calls. It is made web-accessible so the content script can inject it via a <script> tag. This is required on all URLs for the same reason as the content script: any website may implement MPP.

## Single Purpose Description
Delegates time-limited, spending-capped signing authority from Tempo wallets via on-chain access keys, and automatically pays MPP-enabled websites using those keys.
