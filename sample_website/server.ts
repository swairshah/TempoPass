/**
 * Sample MPP-enabled blog server.
 *
 * Serves a blog with one free preview and a paid full article.
 * Payment: 0.01 USDC via Tempo MPP (Machine Payment Protocol).
 *
 * Pure MPP — the server issues 402 challenges, verifies credentials,
 * and returns receipts. No custom wallet tracking; the client caches
 * and resends credentials on repeat visits.
 *
 * Usage:
 *   npx tsx sample_website/server.ts
 *   Open http://localhost:3000
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Challenge, Credential } from 'mppx'
import { createPublicClient, http } from 'viem'
import { tempo } from 'viem/chains'
import { tempoActions } from 'viem/tempo'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = 3000

// ─── Config ───
const RECIPIENT = '0xe5aa3b5c91e34da13dabc02f12f004ae5c69f9a7' as const
const USDC_TOKEN = '0x20c000000000000000000000b9537d11c60e8b50' as const
const USDC_DECIMALS = 6
const ARTICLE_PRICE = '10000' // 0.01 USDC (6 decimals)
const SECRET_KEY = 'tempo-blog-demo-secret-key-2026'
const REALM = `localhost:${PORT}`

// ─── Tempo client for on-chain verification ───
const tempoClient = createPublicClient({
  chain: tempo,
  transport: http(),
}).extend(tempoActions())

// ─── Article content ───
const ARTICLE = {
  title: 'The Architecture of Machine Payments',
  author: 'XYZ',
  date: 'March 21, 2026',
  preview: `
The internet was built for humans. Every payment flow — from credit card forms to 
subscription management — assumes a human is at the keyboard, clicking buttons and 
filling out forms. But that assumption is breaking down.

AI agents are the new users of the web. They call APIs, consume data, generate content, 
and increasingly need to pay for these services. The Machine Payment Protocol (MPP) is 
an open standard that gives machines a native way to pay — no accounts, no forms, no 
API keys. Just HTTP.

The core insight is beautifully simple: revive the HTTP 402 status code. When a server 
needs payment, it returns 402 with a payment challenge. The client fulfills the payment 
and retries. The server delivers the resource with a receipt.
`.trim(),
  full: `
The internet was built for humans. Every payment flow — from credit card forms to 
subscription management — assumes a human is at the keyboard, clicking buttons and 
filling out forms. But that assumption is breaking down.

AI agents are the new users of the web. They call APIs, consume data, generate content, 
and increasingly need to pay for these services. The Machine Payment Protocol (MPP) is 
an open standard that gives machines a native way to pay — no accounts, no forms, no 
API keys. Just HTTP.

The core insight is beautifully simple: revive the HTTP 402 status code. When a server 
needs payment, it returns 402 with a payment challenge. The client fulfills the payment 
and retries. The server delivers the resource with a receipt.

## The Three-Step Dance

Every MPP transaction follows a three-step dance between client and server:

**Step 1: The Challenge.** The client requests a resource. The server responds with 
HTTP 402 and a \`WWW-Authenticate: Payment\` header containing the price, currency, 
and destination. This is the machine equivalent of seeing a price tag.

**Step 2: The Payment.** The client's wallet parses the challenge, signs a stablecoin 
transfer on the Tempo blockchain, and gets a transaction hash. Settlement happens in 
under 500 milliseconds.

**Step 3: The Credential.** The client retries the original request, this time including 
an \`Authorization: Payment\` header with the transaction hash as proof. The server 
verifies the payment on-chain and delivers the resource.

## Why Stablecoins?

Traditional payment methods — credit cards, bank transfers, subscriptions — carry 
enormous overhead for small, frequent transactions. A credit card charge costs a 
minimum of $0.30 plus percentage fees. That makes it impossible to charge $0.001 
for an API call or $0.01 for an article.

Stablecoins on Tempo solve this. The chain was purpose-built for payments:

- **Sub-second finality**: Transactions settle in ~500ms
- **No volatile gas token**: Fees are paid in the same stablecoin you're transferring
- **Native session keys**: Delegate spending authority with on-chain limits
- **Micropayments**: Charge as little as $0.0001 per request

## Access Keys: The Missing Piece

The most powerful feature of this stack is **access keys**. Instead of signing every 
transaction with your root key (which requires biometric authentication), you can 
create a time-limited P256 key with a spending cap.

For example: "This key can spend up to $10 USDC over the next 10 hours."

An AI agent — or a browser extension — can use this access key to pay for hundreds 
of micropayments without any human intervention. The blockchain enforces the limits. 
When the key expires or the cap is reached, it simply stops working.

This is the architecture of autonomous commerce: humans set the boundaries, machines 
operate within them, and the protocol enforces everything cryptographically.

## The Future

We're at the beginning of a fundamental shift in how the internet handles money. 
MPP is not just a protocol for AI agents — it's a new primitive for the web itself. 
Any resource, any service, any piece of content can now have a price that machines 
can discover and pay in milliseconds.

The 402 status code waited 30 years to find its purpose. Now it has one.
`.trim(),
}

// ─── Verify a credential and return full content if valid ───
async function verifyAndServe(authHeader: string, res: any): Promise<boolean> {
  try {
    const credential = Credential.deserialize(authHeader.slice('Payment '.length))
    const challenge = credential.challenge

    // Verify challenge was issued by us (HMAC check)
    const isValid = Challenge.verify(challenge as any, { secretKey: SECRET_KEY })
    if (!isValid) {
      console.log('[MPP] Invalid challenge signature — rejected')
      return false
    }

    // Verify payment on-chain
    const payload = credential.payload as { type: string; hash?: string }
    if (payload.type === 'hash' && payload.hash) {
      try {
        const receipt = await tempoClient.getTransactionReceipt({
          hash: payload.hash as `0x${string}`,
        })
        if (receipt.status !== 'success') {
          console.log('[MPP] Transaction failed on-chain')
          return false
        }
        const tx = await tempoClient.getTransaction({
          hash: payload.hash as `0x${string}`,
        })
        console.log(`[MPP] Verified payment from ${tx.from} (tx: ${payload.hash.slice(0, 12)}...)`)
      } catch (e) {
        console.log('[MPP] Could not verify tx on-chain, accepting for demo:', payload.hash)
      }
    }

    // Payment valid — serve content with receipt
    const receiptHeader = Credential.serialize({
      challenge: credential.challenge,
      payload: credential.payload,
    })

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Payment-Receipt',
      'Payment-Receipt': receiptHeader,
    })
    res.end(JSON.stringify({
      title: ARTICLE.title,
      author: ARTICLE.author,
      date: ARTICLE.date,
      content: ARTICLE.full,
    }))
    return true
  } catch (err: any) {
    console.error('[MPP] Credential verification error:', err.message)
    return false
  }
}

// ─── Server ───
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://${req.headers.host}`)

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Expose-Headers': 'WWW-Authenticate, Payment-Receipt',
    })
    res.end()
    return
  }

  // Serve static files
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(readFileSync(join(__dirname, 'index.html'), 'utf-8'))
    return
  }

  if (url.pathname === '/style.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' })
    res.end(readFileSync(join(__dirname, 'style.css'), 'utf-8'))
    return
  }

  // Free preview
  if (url.pathname === '/api/preview') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({
      title: ARTICLE.title,
      author: ARTICLE.author,
      date: ARTICLE.date,
      content: ARTICLE.preview,
      price: '0.01',
      currency: 'USDC',
    }))
    return
  }

  // Paid full content — pure MPP
  if (url.pathname === '/api/full') {
    // If client presents a credential, verify it
    const authHeader = req.headers['authorization']
    if (authHeader && authHeader.startsWith('Payment ')) {
      const served = await verifyAndServe(authHeader, res)
      if (served) return
    }

    // No credential or invalid — issue 402 challenge
    const challenge = Challenge.from({
      secretKey: SECRET_KEY,
      realm: REALM,
      method: 'tempo',
      intent: 'charge',
      request: {
        amount: ARTICLE_PRICE,
        currency: USDC_TOKEN,
        decimals: USDC_DECIMALS,
        recipient: RECIPIENT,
        description: `Full article: ${ARTICLE.title}`,
      },
    })

    res.writeHead(402, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': Challenge.serialize(challenge),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'WWW-Authenticate, Payment-Receipt',
    })
    res.end(JSON.stringify({
      error: 'Payment required',
      price: '0.01 USDC',
      description: `Full article: ${ARTICLE.title}`,
    }))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`\n🎵 Tempo Blog (MPP-enabled)`)
  console.log(`   http://localhost:${PORT}`)
  console.log(`\n   Preview: free`)
  console.log(`   Full article: 0.01 USDC via MPP`)
  console.log(`   Recipient: ${RECIPIENT}\n`)
})
