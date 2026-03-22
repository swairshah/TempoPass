/**
 * Shared constants, types, storage helpers, and client constructors
 * used by both popup.ts and transactions.ts
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  type Hex,
} from 'viem'
import { tempo } from 'viem/chains'
import { Account, tempoActions } from 'viem/tempo'

// ─── Constants ───
export const USDC_TOKEN = '0x20c000000000000000000000b9537d11c60e8b50' as const
export const USDC_DECIMALS = 6
export const USDC_SYMBOL = 'USDC'
export const CHAIN = { ...tempo, feeToken: USDC_TOKEN } as typeof tempo
export const EXPLORER_URL = 'https://explore.tempo.xyz'
export const WALLET_URL = 'https://wallet.tempo.xyz'

// ─── Types ───
export interface WalletCredential {
  id: string
  publicKey: string
  address: string
  rpId: string
  createdAt: number
}

export interface AccessKeySession {
  rootAddress: string
  accessKeyPrivateKey: string
  accessKeyAddress: string
  expiry: number
  spendingLimit: string
  tokenAddress: string
  createdAt: number
}

export interface TxLogEntry {
  hash: string
  amount: string
  to: string
  timestamp: number
  status: 'success' | 'error'
  error?: string
}

// ─── Storage ───
export async function saveCredential(cred: WalletCredential) {
  await chrome.storage.local.set({ walletCredential: cred })
}

export async function loadCredential(): Promise<WalletCredential | null> {
  const data = await chrome.storage.local.get('walletCredential')
  return data.walletCredential || null
}

export async function clearCredential() {
  await chrome.storage.local.remove('walletCredential')
}

export async function saveSession(s: AccessKeySession) {
  await chrome.storage.session.set({ accessKeySession: s })
}

export async function loadSession(): Promise<AccessKeySession | null> {
  const data = await chrome.storage.session.get('accessKeySession')
  return data.accessKeySession || null
}

export async function clearSession() {
  await chrome.storage.session.remove('accessKeySession')
}

export async function loadTxLog(): Promise<TxLogEntry[]> {
  const data = await chrome.storage.local.get('txLog')
  return data.txLog || []
}

export async function saveTxLog(entries: TxLogEntry[]) {
  await chrome.storage.local.set({ txLog: entries })
}

// ─── UI Helpers ───
export function shortenAddr(addr: string): string {
  return addr.slice(0, 8) + '...' + addr.slice(-6)
}

export function formatExpiry(ts: number): string {
  const remaining = ts - Date.now() / 1000
  if (remaining <= 0) return 'expired'
  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h ${m}m`
}

// ─── Tempo Clients ───
export function getPublicClient() {
  return createPublicClient({
    chain: CHAIN,
    transport: http(),
  }).extend(tempoActions())
}

export function getRootAccount(credential: WalletCredential) {
  return Account.fromWebAuthnP256(
    { id: credential.id, publicKey: credential.publicKey as Hex },
    { rpId: credential.rpId }
  )
}

export function getRootClient(credential: WalletCredential) {
  return createWalletClient({
    account: getRootAccount(credential),
    chain: CHAIN,
    transport: http(),
  }).extend(tempoActions())
}

export function getAccessKeyClient(credential: WalletCredential, session: AccessKeySession) {
  const rootAccount = getRootAccount(credential)
  const accessKey = Account.fromP256(session.accessKeyPrivateKey as Hex, {
    access: rootAccount,
  })
  return {
    client: createWalletClient({
      account: accessKey,
      chain: CHAIN,
      transport: http(),
    }).extend(tempoActions()),
    accessKey,
  }
}
