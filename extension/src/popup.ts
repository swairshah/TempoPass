/**
 * Tempo Access Key Extension — uses your EXISTING Tempo wallet passkey
 *
 * CONNECT (once):
 *   1. Extension opens wallet.tempo.xyz briefly in a tab
 *   2. Reads your passkey credential (ID + public key) from wallet localStorage
 *   3. Stores credential reference in extension — closes the tab
 *
 * CREATE ACCESS KEY (each session):
 *   1. Extension generates a P256 access key pair
 *   2. Your existing passkey signs the authorization (biometric prompt via RP ID claiming)
 *   3. Authorization tx sent to Tempo
 *   4. P256 access key stored in session storage
 *
 * TRANSACT (no biometric):
 *   Access key signs transactions — protocol enforces expiry + spending limits
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  type Hex,
} from 'viem'
import { tempo, CHAIN } from 'viem/chains'
import { Account, P256, tempoActions } from 'viem/tempo'

// ─── Constants ───
// Mainnet USDC (Bridged USDC Stargate) — the token you have in your wallet
const USDC_TOKEN = '0x20c000000000000000000000b9537d11c60e8b50' as const
const USDC_DECIMALS = 6
const USDC_SYMBOL = 'USDC'

// Use Tempo mainnet — feeToken tells Tempo which TIP-20 token pays for gas
const CHAIN = { ...tempo, feeToken: USDC_TOKEN } as typeof tempo
const EXPLORER_URL = 'https://explore.tempo.xyz'
const WALLET_URL = 'https://wallet.tempo.xyz'
// The RP ID the Tempo wallet uses — confirmed as 'tempo.xyz' from Chrome passkey dialog
const RP_IDS_TO_TRY = ['tempo.xyz', 'wallet.tempo.xyz']

// ─── Types ───
interface WalletCredential {
  id: string
  publicKey: string  // hex
  address: string
  rpId: string       // which rpId worked
  createdAt: number
}

interface AccessKeySession {
  rootAddress: string
  accessKeyPrivateKey: string
  accessKeyAddress: string
  expiry: number
  spendingLimit: string
  tokenAddress: string
  createdAt: number
}

interface TxLogEntry {
  hash: string
  amount: string
  to: string
  timestamp: number
  status: 'success' | 'error'
  error?: string
}

// ─── DOM Helpers ───
const $ = (id: string) => document.getElementById(id)!
const viewSetup = $('viewSetup')
const viewConnect = $('viewConnect')
const viewCreating = $('viewCreating')
const viewActive = $('viewActive')
const viewExpired = $('viewExpired')

const btnConnectWallet = $('btnConnectWallet') as HTMLButtonElement
const connectWalletAddr = $('connectWalletAddr')
const connectBalance = $('connectBalance')
const selectExpiry = $('selectExpiry') as HTMLSelectElement
const inputLimit = $('inputLimit') as HTMLInputElement
const btnCreateAccessKey = $('btnCreateAccessKey') as HTMLButtonElement
const btnDisconnect = $('btnDisconnect') as HTMLButtonElement
const creatingStatus = $('creatingStatus')
const activeWalletAddr = $('activeWalletAddr')
const activeKeyId = $('activeKeyId')
const activeExpiry = $('activeExpiry')
const activeRemaining = $('activeRemaining')
const inputRecipient = $('inputRecipient') as HTMLInputElement
const inputAmount = $('inputAmount') as HTMLInputElement
const btnSendTransfer = $('btnSendTransfer') as HTMLButtonElement
const btnRevokeKey = $('btnRevokeKey') as HTMLButtonElement
const btnNewKey = $('btnNewKey') as HTMLButtonElement
const toast = $('toast')
const txLog = $('txLog')
const txLogEntries = $('txLogEntries')

// ─── State ───
let credential: WalletCredential | null = null
let session: AccessKeySession | null = null
let txEntries: TxLogEntry[] = []

// ─── UI Helpers ───
function showView(view: HTMLElement) {
  ;[viewSetup, viewConnect, viewCreating, viewActive, viewExpired].forEach((v) =>
    v.classList.add('hidden')
  )
  view.classList.remove('hidden')
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  toast.textContent = message
  toast.className = `toast ${type}`
  toast.classList.remove('hidden')
  setTimeout(() => toast.classList.add('hidden'), 4000)
}

function shortenAddr(addr: string): string {
  return addr.slice(0, 8) + '...' + addr.slice(-6)
}

function formatExpiry(ts: number): string {
  const remaining = ts - Date.now() / 1000
  if (remaining <= 0) return 'Expired'
  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h remaining`
  return `${h}h ${m}m remaining`
}

// ─── Tempo Clients ───
function getPublicClient() {
  return createPublicClient({
    chain: CHAIN,
    transport: http(),
  }).extend(tempoActions())
}

/**
 * Creates a root account from the stored credential.
 * When this account signs, it triggers a biometric prompt via RP ID claiming.
 */
function getRootAccount() {
  if (!credential) throw new Error('No credential')
  return Account.fromWebAuthnP256(
    { id: credential.id, publicKey: credential.publicKey as Hex },
    { rpId: credential.rpId }
  )
}

function getRootClient() {
  return createWalletClient({
    account: getRootAccount(),
    chain: CHAIN,
    transport: http(),
  }).extend(tempoActions())
}

function getAccessKeyClient() {
  if (!session) throw new Error('No session')
  const rootAccount = getRootAccount()
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

// ─── Storage ───
async function saveCredential(cred: WalletCredential) {
  credential = cred
  await chrome.storage.local.set({ walletCredential: cred })
}

async function loadCredential(): Promise<WalletCredential | null> {
  const data = await chrome.storage.local.get('walletCredential')
  return data.walletCredential || null
}

async function clearCredential() {
  credential = null
  await chrome.storage.local.remove('walletCredential')
}

async function saveSession(s: AccessKeySession) {
  session = s
  await chrome.storage.session.set({ accessKeySession: s })
}

async function loadSession(): Promise<AccessKeySession | null> {
  const data = await chrome.storage.session.get('accessKeySession')
  return data.accessKeySession || null
}

async function clearSession() {
  session = null
  await chrome.storage.session.remove('accessKeySession')
}

function addTxEntry(entry: TxLogEntry) {
  txEntries.unshift(entry)
  if (txEntries.length > 10) txEntries.pop()
  renderTxLog()
  chrome.storage.local.set({ txLog: txEntries })
}

function renderTxLog() {
  if (txEntries.length === 0) { txLog.classList.add('hidden'); return }
  txLog.classList.remove('hidden')
  txLogEntries.innerHTML = txEntries.map(e => `
    <div class="tx-entry">
      <div class="tx-hash">
        <a href="${EXPLORER_URL}/tx/${e.hash}" target="_blank" rel="noopener">${shortenAddr(e.hash)}</a>
      </div>
      <div class="tx-info">
        ${e.amount} USDC → ${shortenAddr(e.to)}
        <span class="${e.status === 'success' ? 'tx-status-ok' : 'tx-status-err'}">
          ${e.status === 'success' ? '✓' : '✗ ' + (e.error || '')}
        </span>
      </div>
    </div>`).join('')
}

// ─── Refresh Views ───
async function refreshConnectView() {
  if (!credential) return
  connectWalletAddr.textContent = shortenAddr(credential.address)
  connectBalance.textContent = 'Loading...'
  try {
    const bal = await getPublicClient().token.getBalance({
      token: USDC_TOKEN,
      account: credential.address as `0x${string}`,
    })
    connectBalance.textContent = formatUnits(bal, 6) + ` ${USDC_SYMBOL}`
  } catch {
    connectBalance.textContent = 'Error loading'
  }
}

async function refreshActiveView() {
  if (!session || !credential) return
  activeWalletAddr.textContent = shortenAddr(credential.address)
  activeKeyId.textContent = shortenAddr(session.accessKeyAddress)
  activeExpiry.textContent = formatExpiry(session.expiry)
  if (Date.now() / 1000 > session.expiry) { showView(viewExpired); return }
  try {
    const remaining = await getPublicClient().accessKey.getRemainingLimit({
      account: session.rootAddress as `0x${string}`,
      accessKey: session.accessKeyAddress as `0x${string}`,
      token: USDC_TOKEN,
    })
    activeRemaining.textContent = formatUnits(remaining, 6) + ` ${USDC_SYMBOL}`
  } catch {
    activeRemaining.textContent = session.spendingLimit + ' USDC (est.)'
  }
}

// ═══════════════════════════════════════════
// CONNECT: Read credential from wallet.tempo.xyz
// ═══════════════════════════════════════════

/**
 * The script injected into wallet.tempo.xyz's page context (MAIN world)
 * to read the credential from localStorage.
 * 
 * The wagmi KeyManager.localStorage stores credentials under keys
 * like "tempo.credentials" or similar. We scan localStorage for
 * anything that looks like a WebAuthn credential.
 */
function extractCredentialFromWalletPage(): { id: string; publicKey: string } | null {
  // Tempo wallet stores credentials in localStorage with these exact keys:
  //   tempo.lastCredentialId          = "rC2LNTqug-eSVdCi85FzMA"
  //   tempo.publicKeysByCredential.v1 = {"rC2LNTqug-eSVdCi85FzMA":"0x04a38d..."}
  //   tempo.credentialsByEmail.v2     = {"user@example.com":{"id":"rC2LNTqug-eSVdCi85FzMA"}}

  // Method 1: Use tempo.lastCredentialId + tempo.publicKeysByCredential.v1
  const lastCredId = localStorage.getItem('tempo.lastCredentialId')
  const pubKeyMapRaw = localStorage.getItem('tempo.publicKeysByCredential.v1')

  if (lastCredId && pubKeyMapRaw) {
    try {
      const pubKeyMap = JSON.parse(pubKeyMapRaw)
      const publicKey = pubKeyMap[lastCredId]
      if (publicKey && typeof publicKey === 'string' && publicKey.startsWith('0x')) {
        return { id: lastCredId, publicKey }
      }
    } catch {}
  }

  // Method 2: Use tempo.credentialsByEmail.v2 to find credential ID, then look up public key
  const credsByEmailRaw = localStorage.getItem('tempo.credentialsByEmail.v2')
  if (credsByEmailRaw && pubKeyMapRaw) {
    try {
      const credsByEmail = JSON.parse(credsByEmailRaw)
      const pubKeyMap = JSON.parse(pubKeyMapRaw)
      // Get the first credential from any email
      for (const email of Object.keys(credsByEmail)) {
        const cred = credsByEmail[email]
        const credId = cred?.id || cred
        if (typeof credId === 'string') {
          const publicKey = pubKeyMap[credId]
          if (publicKey && typeof publicKey === 'string' && publicKey.startsWith('0x')) {
            return { id: credId, publicKey }
          }
        }
      }
    } catch {}
  }

  // Method 3: Fallback — deep scan all localStorage for any credential-like data
  for (const key of Object.keys(localStorage)) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Look for { "someId": "0x04..." } pattern (public key map)
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v.startsWith('0x04') && v.length > 60) {
            return { id: k, publicKey: v }
          }
        }
      }
    } catch {}
  }

  return null
}

async function handleConnectWallet() {
  btnConnectWallet.disabled = true
  showView(viewCreating)
  creatingStatus.textContent = 'Opening wallet.tempo.xyz...'

  let tabId: number | undefined

  try {
    // 1. Open wallet.tempo.xyz in a new tab
    const tab = await chrome.tabs.create({ url: WALLET_URL, active: false })
    tabId = tab.id

    // 2. Wait for the page to load
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tab load timeout')), 15000)
      
      const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          clearTimeout(timeout)
          resolve()
        }
      }
      chrome.tabs.onUpdated.addListener(listener)
    })

    creatingStatus.textContent = 'Reading wallet credential...'

    // 3. Inject script to read credential from localStorage (MAIN world)
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId! },
      world: 'MAIN' as any,
      func: extractCredentialFromWalletPage,
    })

    // 4. Close the tab
    try { await chrome.tabs.remove(tabId!) } catch {}
    tabId = undefined

    const result = results?.[0]?.result
    if (!result) {
      throw new Error(
        'Could not find your passkey credential in wallet.tempo.xyz. ' +
        'Make sure you have logged in to wallet.tempo.xyz at least once in this browser.'
      )
    }

    // 5. Derive account address from public key
    // Try each possible rpId to figure out which one was used
    const account = Account.fromWebAuthnP256(
      { id: result.id, publicKey: result.publicKey as Hex },
      // rpId doesn't affect address derivation, just signing
    )

    // We'll try to determine the correct rpId during the first sign
    const cred: WalletCredential = {
      id: result.id,
      publicKey: result.publicKey,
      address: account.address,
      rpId: 'tempo.xyz', // confirmed from Chrome passkey dialog
      createdAt: Date.now(),
    }
    await saveCredential(cred)

    showToast('Wallet connected! Address: ' + shortenAddr(account.address), 'success')
    showView(viewConnect)
    await refreshConnectView()
  } catch (err: any) {
    console.error('Connect wallet error:', err)
    // Clean up tab if still open
    if (tabId) try { await chrome.tabs.remove(tabId) } catch {}
    showToast(err.message || 'Failed to connect wallet', 'error')
    showView(viewSetup)
  } finally {
    btnConnectWallet.disabled = false
  }
}

// ═══════════════════════════════════════════
// CREATE ACCESS KEY
// ═══════════════════════════════════════════

async function handleCreateAccessKey() {
  if (!credential) return

  const expiryHours = parseInt(selectExpiry.value)
  const spendingLimit = parseFloat(inputLimit.value)
  if (isNaN(spendingLimit) || spendingLimit <= 0) {
    showToast('Enter a valid spending limit', 'error')
    return
  }

  btnCreateAccessKey.disabled = true
  showView(viewCreating)

  try {
    creatingStatus.textContent = 'Generating P256 access key...'
    const accessKeyPrivateKey = P256.randomPrivateKey()
    const rootAccount = getRootAccount()
    const accessKey = Account.fromP256(accessKeyPrivateKey, { access: rootAccount })

    const rootClient = getRootClient()
    const expiryTimestamp = Math.floor(Date.now() / 1000) + expiryHours * 3600
    const spendingLimitRaw = parseUnits(spendingLimit.toString(), 6)

    creatingStatus.textContent = 'Authenticate with your passkey (Touch ID)...'

    // Single passkey prompt — rpId confirmed as 'tempo.xyz'
    const authResult = await rootClient.accessKey.authorizeSync({
      accessKey,
      expiry: expiryTimestamp,
      limits: [{ token: USDC_TOKEN, limit: spendingLimitRaw }],
    })

    const newSession: AccessKeySession = {
      rootAddress: credential.address,
      accessKeyPrivateKey,
      accessKeyAddress: accessKey.accessKeyAddress,
      expiry: expiryTimestamp,
      spendingLimit: spendingLimit.toString(),
      tokenAddress: USDC_TOKEN,
      createdAt: Date.now(),
    }
    await saveSession(newSession)

    addTxEntry({
      hash: authResult.receipt.transactionHash,
      amount: '0',
      to: 'Key Authorization',
      timestamp: Date.now(),
      status: 'success',
    })

    showToast('Access key created! No more biometric prompts until expiry.', 'success')
    showView(viewActive)
    await refreshActiveView()
  } catch (err: any) {
    console.error('Create access key error:', err)
    showToast(err.shortMessage || err.message || 'Failed to create access key', 'error')
    showView(viewConnect)
  } finally {
    btnCreateAccessKey.disabled = false
  }
}

// ═══════════════════════════════════════════
// SEND TRANSFER
// ═══════════════════════════════════════════

async function handleSendTransfer() {
  if (!session) return

  const recipient = inputRecipient.value.trim()
  if (!recipient || !recipient.startsWith('0x') || recipient.length !== 42) {
    showToast('Enter a valid recipient address', 'error')
    return
  }

  const amount = parseFloat(inputAmount.value)
  if (isNaN(amount) || amount <= 0) {
    showToast('Enter a valid amount', 'error')
    return
  }

  if (Date.now() / 1000 > session.expiry) {
    showToast('Access key expired', 'error')
    showView(viewExpired)
    return
  }

  btnSendTransfer.disabled = true
  btnSendTransfer.textContent = '⏳ Sending...'

  try {
    const { client: akClient } = getAccessKeyClient()
    const result = await akClient.token.transferSync({
      token: USDC_TOKEN,
      to: recipient as `0x${string}`,
      amount: parseUnits(amount.toString(), 6),
    })

    showToast(`Sent ${amount} ${USDC_SYMBOL}!`, 'success')
    addTxEntry({
      hash: result.receipt.transactionHash,
      amount: amount.toString(),
      to: recipient,
      timestamp: Date.now(),
      status: 'success',
    })
    await refreshActiveView()
  } catch (err: any) {
    console.error('Transfer error:', err)
    const msg = err.shortMessage || err.message || 'Transfer failed'
    showToast(msg.includes('SpendingLimit') ? 'Spending limit exceeded!' : msg.substring(0, 100), 'error')
    addTxEntry({
      hash: '0x' + '0'.repeat(64),
      amount: amount.toString(),
      to: recipient,
      timestamp: Date.now(),
      status: 'error',
      error: msg.substring(0, 50),
    })
  } finally {
    btnSendTransfer.disabled = false
    btnSendTransfer.textContent = 'Send with Access Key'
  }
}

// ═══════════════════════════════════════════
// OTHER HANDLERS
// ═══════════════════════════════════════════

async function handleRevoke() {
  if (!confirm("Clear this access key? You'll need your passkey to create a new one.")) return
  await clearSession()
  showToast('Access key cleared', 'info')
  showView(viewConnect)
  await refreshConnectView()
}

async function handleDisconnect() {
  if (!confirm('Disconnect your wallet from this extension?')) return
  await clearSession()
  await clearCredential()
  txEntries = []
  await chrome.storage.local.remove('txLog')
  showToast('Wallet disconnected', 'info')
  showView(viewSetup)
}

// ─── Event Listeners ───
btnConnectWallet.addEventListener('click', handleConnectWallet)
btnCreateAccessKey.addEventListener('click', handleCreateAccessKey)
btnDisconnect.addEventListener('click', handleDisconnect)
btnSendTransfer.addEventListener('click', handleSendTransfer)
btnRevokeKey.addEventListener('click', handleRevoke)
btnNewKey.addEventListener('click', () => { showView(viewConnect); refreshConnectView() })

// ─── Init ───
async function init() {
  const logData = await chrome.storage.local.get('txLog')
  txEntries = logData.txLog || []
  renderTxLog()

  credential = await loadCredential()
  if (!credential) { showView(viewSetup); return }

  session = await loadSession()
  if (session) {
    if (Date.now() / 1000 > session.expiry) {
      showView(viewExpired)
    } else {
      showView(viewActive)
      await refreshActiveView()
    }
  } else {
    showView(viewConnect)
    await refreshConnectView()
  }
}

init()
