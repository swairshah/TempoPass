/**
 * Background service worker for Tempo Access Key extension.
 *
 * Handles:
 * - Access key expiry checks
 * - MPP payment processing (receives challenges from content script,
 *   signs Tempo transfers with access key, returns credentials)
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  type Hex,
} from 'viem'
import { tempo } from 'viem/chains'
import { Account, tempoActions } from 'viem/tempo'
import { Challenge, Credential } from 'mppx'

// ─── Constants ───
const USDC_TOKEN = '0x20c000000000000000000000b9537d11c60e8b50' as const
const CHAIN = { ...tempo, feeToken: USDC_TOKEN } as typeof tempo

// ─── Storage helpers ───
async function loadSession() {
  const data = await chrome.storage.session.get('accessKeySession')
  return data.accessKeySession || null
}

async function loadCredential() {
  const data = await chrome.storage.local.get('walletCredential')
  return data.walletCredential || null
}

// ─── MPP Payment Handler ───

interface MppRequest {
  type: 'mpp:challenge'
  requestId: string
  url: string
  wwwAuthenticate: string
  method: string
}

async function handleMppChallenge(msg: MppRequest): Promise<{ credential?: string; error?: string }> {
  // 1. Load access key session
  const session = await loadSession()
  const walletCred = await loadCredential()
  if (!session || !walletCred) {
    return { error: 'No active access key. Open the extension to create one.' }
  }

  // Check expiry
  if (Date.now() / 1000 > session.expiry) {
    return { error: 'Access key expired. Open the extension to create a new one.' }
  }

  try {
    // 2. Parse the challenge
    const challenge = Challenge.deserialize(msg.wwwAuthenticate)

    // Only handle Tempo charges for now
    if (challenge.method !== 'tempo') {
      return { error: `Unsupported payment method: ${challenge.method}. Only Tempo is supported.` }
    }

    const request = challenge.request as {
      amount: string
      currency: string
      decimals: number
      recipient?: string
      memo?: string
      chainId?: number
    }

    const amountHuman = formatUnits(BigInt(request.amount), request.decimals)
    console.log(`[MPP] Payment challenge: ${amountHuman} to ${request.recipient} for ${msg.url}`)

    // 3. Build and sign the transfer using the access key
    const rootAccount = Account.fromWebAuthnP256(
      { id: walletCred.id, publicKey: walletCred.publicKey as Hex },
      { rpId: walletCred.rpId }
    )
    const accessKey = Account.fromP256(session.accessKeyPrivateKey as Hex, {
      access: rootAccount,
    })

    const client = createWalletClient({
      account: accessKey,
      chain: CHAIN,
      transport: http(),
    }).extend(tempoActions())

    // 4. Execute the transfer
    const result = await client.token.transferSync({
      token: request.currency as `0x${string}`,
      to: request.recipient as `0x${string}`,
      amount: BigInt(request.amount),
      memo: request.memo as `0x${string}` | undefined,
    })

    console.log(`[MPP] Payment sent: ${result.receipt.transactionHash}`)

    // 5. Build the credential
    const credential = Credential.serialize({
      challenge,
      payload: {
        type: 'hash',
        hash: result.receipt.transactionHash,
      },
    })

    // 6. Log the transaction
    const txLog = (await chrome.storage.local.get('txLog')).txLog || []
    txLog.unshift({
      hash: result.receipt.transactionHash,
      amount: amountHuman,
      to: request.recipient || msg.url,
      timestamp: Date.now(),
      status: 'success',
    })
    await chrome.storage.local.set({ txLog: txLog.slice(0, 20) })

    return { credential: `Payment ${credential}` }
  } catch (err: any) {
    console.error('[MPP] Payment error:', err)
    return { error: err.shortMessage || err.message || 'Payment failed' }
  }
}

// ─── Message listener ───
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'mpp:challenge') {
    handleMppChallenge(msg).then(sendResponse)
    return true // async response
  }
})

// ─── Expiry checks ───
chrome.alarms?.create('checkExpiry', { periodInMinutes: 1 })

chrome.alarms?.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkExpiry') {
    const session = await loadSession()
    if (session?.expiry && Date.now() / 1000 > session.expiry) {
      await chrome.storage.session.remove('accessKeySession')
      console.log('[Tempo] Access key expired, session cleared')
    }
  }
})

console.log('[Tempo Access Key] Background service worker loaded (MPP enabled)')
