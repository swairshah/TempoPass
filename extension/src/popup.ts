/**
 * Tempo Access Key Extension — popup UI
 * Tabbed interface: status | send | history
 */

import { parseUnits, formatUnits, type Hex } from 'viem'
import { Account, P256 } from 'viem/tempo'
import {
  USDC_TOKEN, USDC_SYMBOL, EXPLORER_URL, WALLET_URL,
  type WalletCredential, type AccessKeySession, type TxLogEntry,
  saveCredential, loadCredential, clearCredential,
  saveSession, loadSession, clearSession,
  loadTxLog, saveTxLog,
  shortenAddr, formatExpiry,
  getPublicClient, getRootAccount, getRootClient, getAccessKeyClient,
} from './shared'

// ─── DOM ───
const $ = (id: string) => document.getElementById(id)!
const viewSetup = $('viewSetup')
const viewConnect = $('viewConnect')
const viewCreating = $('viewCreating')
const viewExpired = $('viewExpired')
const tabBar = $('tabBar')
const tabStatus = $('tabStatus')
const tabSend = $('tabSend')
const tabHistory = $('tabHistory')

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
const btnRevokeKey = $('btnRevokeKey') as HTMLButtonElement
const btnNewKey = $('btnNewKey') as HTMLButtonElement
const inputRecipient = $('inputRecipient') as HTMLInputElement
const inputAmount = $('inputAmount') as HTMLInputElement
const btnSendTransfer = $('btnSendTransfer') as HTMLButtonElement
const txLogEntries = $('txLogEntries')
const txEmpty = $('txEmpty')
const toast = $('toast')

// ─── State ───
let credential: WalletCredential | null = null
let session: AccessKeySession | null = null
let txEntries: TxLogEntry[] = []

// ─── Views ───
const allViews = [viewSetup, viewConnect, viewCreating, viewExpired, tabStatus, tabSend, tabHistory]

function showView(view: HTMLElement) {
  allViews.forEach(v => v.classList.add('hidden'))
  tabBar.classList.add('hidden')
  view.classList.remove('hidden')
}

function showActiveTab(tabName: string) {
  ;[tabStatus, tabSend, tabHistory].forEach(v => v.classList.add('hidden'))
  allViews.filter(v => [viewSetup, viewConnect, viewCreating, viewExpired].includes(v))
    .forEach(v => v.classList.add('hidden'))
  tabBar.classList.remove('hidden')

  // Update tab buttons
  tabBar.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tabName)
  })

  // Show the selected tab content
  if (tabName === 'status') tabStatus.classList.remove('hidden')
  else if (tabName === 'send') tabSend.classList.remove('hidden')
  else if (tabName === 'history') { tabHistory.classList.remove('hidden'); renderTxLog() }
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  toast.textContent = message
  toast.className = `toast ${type}`
  toast.classList.remove('hidden')
  setTimeout(() => toast.classList.add('hidden'), 4000)
}

// ─── Tab bar clicks ───
tabBar.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.tab') as HTMLElement | null
  if (!btn?.dataset.tab) return
  showActiveTab(btn.dataset.tab)
})

// ─── Tx Log ───
function renderTxLog() {
  if (txEntries.length === 0) {
    txLogEntries.innerHTML = ''
    txEmpty.classList.remove('hidden')
    return
  }
  txEmpty.classList.add('hidden')
  txLogEntries.innerHTML = txEntries.map(e => {
    const time = new Date(e.timestamp)
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' })
    const statusClass = e.status === 'success' ? 'tx-status-ok' : 'tx-status-err'
    const statusIcon = e.status === 'success' ? '✓' : '✗'
    return `
      <div class="tx-entry">
        <div class="tx-left">
          <div class="tx-hash">
            <a href="${EXPLORER_URL}/tx/${e.hash}" target="_blank" rel="noopener">${shortenAddr(e.hash)}</a>
            <span class="${statusClass}"> ${statusIcon}</span>
          </div>
          <div class="tx-detail">→ ${shortenAddr(e.to)}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount">${e.amount} ${USDC_SYMBOL}</div>
          <div class="tx-time">${dateStr} ${timeStr}</div>
        </div>
      </div>`
  }).join('')
}

// ─── Refresh ───
async function refreshConnectView() {
  if (!credential) return
  connectWalletAddr.textContent = shortenAddr(credential.address)
  connectBalance.textContent = '...'
  try {
    const bal = await getPublicClient().token.getBalance({
      token: USDC_TOKEN,
      account: credential.address as `0x${string}`,
    })
    connectBalance.textContent = formatUnits(bal, 6) + ` ${USDC_SYMBOL}`
  } catch {
    connectBalance.textContent = 'error'
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
// CONNECT
// ═══════════════════════════════════════════

function extractCredentialFromWalletPage(): { id: string; publicKey: string } | null {
  const lastCredId = localStorage.getItem('tempo.lastCredentialId')
  const pubKeyMapRaw = localStorage.getItem('tempo.publicKeysByCredential.v1')

  if (lastCredId && pubKeyMapRaw) {
    try {
      const pubKeyMap = JSON.parse(pubKeyMapRaw)
      const publicKey = pubKeyMap[lastCredId]
      if (publicKey && typeof publicKey === 'string' && publicKey.startsWith('0x'))
        return { id: lastCredId, publicKey }
    } catch {}
  }

  const credsByEmailRaw = localStorage.getItem('tempo.credentialsByEmail.v2')
  if (credsByEmailRaw && pubKeyMapRaw) {
    try {
      const credsByEmail = JSON.parse(credsByEmailRaw)
      const pubKeyMap = JSON.parse(pubKeyMapRaw)
      for (const email of Object.keys(credsByEmail)) {
        const cred = credsByEmail[email]
        const credId = cred?.id || cred
        if (typeof credId === 'string') {
          const publicKey = pubKeyMap[credId]
          if (publicKey && typeof publicKey === 'string' && publicKey.startsWith('0x'))
            return { id: credId, publicKey }
        }
      }
    } catch {}
  }

  for (const key of Object.keys(localStorage)) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v.startsWith('0x04') && v.length > 60)
            return { id: k, publicKey: v }
        }
      }
    } catch {}
  }
  return null
}

async function handleConnectWallet() {
  btnConnectWallet.disabled = true
  showView(viewCreating)
  creatingStatus.textContent = 'opening wallet.tempo.xyz...'
  let tabId: number | undefined

  try {
    const tab = await chrome.tabs.create({ url: WALLET_URL, active: false })
    tabId = tab.id

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tab load timeout')), 15000)
      const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          clearTimeout(timeout)
          resolve()
        }
      }
      chrome.tabs.onUpdated.addListener(listener)
    })

    creatingStatus.textContent = 'reading credential...'
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId! },
      world: 'MAIN' as any,
      func: extractCredentialFromWalletPage,
    })
    try { await chrome.tabs.remove(tabId!) } catch {}
    tabId = undefined

    const result = results?.[0]?.result
    if (!result) throw new Error('Could not find passkey credential. Log in to wallet.tempo.xyz first.')

    const account = Account.fromWebAuthnP256({ id: result.id, publicKey: result.publicKey as Hex })
    const cred: WalletCredential = {
      id: result.id,
      publicKey: result.publicKey,
      address: account.address,
      rpId: 'tempo.xyz',
      createdAt: Date.now(),
    }
    await saveCredential(cred)
    credential = cred
    showToast('connected: ' + shortenAddr(account.address), 'success')
    showView(viewConnect)
    await refreshConnectView()
  } catch (err: any) {
    if (tabId) try { await chrome.tabs.remove(tabId) } catch {}
    showToast(err.message || 'failed to connect', 'error')
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
  if (isNaN(spendingLimit) || spendingLimit <= 0) { showToast('enter a valid limit', 'error'); return }

  btnCreateAccessKey.disabled = true
  showView(viewCreating)

  try {
    creatingStatus.textContent = 'generating p256 access key...'
    const accessKeyPrivateKey = P256.randomPrivateKey()
    const rootAccount = getRootAccount(credential)
    const accessKey = Account.fromP256(accessKeyPrivateKey, { access: rootAccount })
    const rootClient = getRootClient(credential)
    const expiryTimestamp = Math.floor(Date.now() / 1000) + expiryHours * 3600
    const spendingLimitRaw = parseUnits(spendingLimit.toString(), 6)

    creatingStatus.textContent = 'authenticate with passkey...'
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
    session = newSession

    txEntries.unshift({
      hash: authResult.receipt.transactionHash,
      amount: '0',
      to: 'key authorization',
      timestamp: Date.now(),
      status: 'success',
    })
    await saveTxLog(txEntries.slice(0, 20))

    showToast('access key created!', 'success')
    showActiveTab('status')
    await refreshActiveView()
  } catch (err: any) {
    showToast(err.shortMessage || err.message || 'failed', 'error')
    showView(viewConnect)
  } finally {
    btnCreateAccessKey.disabled = false
  }
}

// ═══════════════════════════════════════════
// SEND TRANSFER
// ═══════════════════════════════════════════

async function handleSendTransfer() {
  if (!session || !credential) return
  const recipient = inputRecipient.value.trim()
  if (!recipient || !recipient.startsWith('0x') || recipient.length !== 42) {
    showToast('enter a valid address', 'error'); return
  }
  const amount = parseFloat(inputAmount.value)
  if (isNaN(amount) || amount <= 0) { showToast('enter a valid amount', 'error'); return }
  if (Date.now() / 1000 > session.expiry) { showToast('key expired', 'error'); showView(viewExpired); return }

  btnSendTransfer.disabled = true
  btnSendTransfer.textContent = 'sending...'

  try {
    const { client: akClient } = getAccessKeyClient(credential, session)
    const result = await akClient.token.transferSync({
      token: USDC_TOKEN,
      to: recipient as `0x${string}`,
      amount: parseUnits(amount.toString(), 6),
    })
    showToast(`sent ${amount} ${USDC_SYMBOL}`, 'success')
    txEntries.unshift({
      hash: result.receipt.transactionHash,
      amount: amount.toString(),
      to: recipient,
      timestamp: Date.now(),
      status: 'success',
    })
    await saveTxLog(txEntries.slice(0, 20))
    await refreshActiveView()
  } catch (err: any) {
    const msg = err.shortMessage || err.message || 'transfer failed'
    const display = msg.includes('SpendingLimit') ? 'spending limit exceeded' : msg.substring(0, 80)
    showToast(display, 'error')
    txEntries.unshift({
      hash: '0x' + '0'.repeat(64),
      amount: amount.toString(),
      to: recipient,
      timestamp: Date.now(),
      status: 'error',
      error: display.substring(0, 50),
    })
    await saveTxLog(txEntries.slice(0, 20))
  } finally {
    btnSendTransfer.disabled = false
    btnSendTransfer.textContent = 'send →'
  }
}

// ═══════════════════════════════════════════
// OTHER HANDLERS
// ═══════════════════════════════════════════

async function handleRevoke() {
  if (!confirm('Clear this access key?')) return
  await clearSession()
  session = null
  showToast('access key cleared', 'info')
  showView(viewConnect)
  await refreshConnectView()
}

async function handleDisconnect() {
  if (!confirm('Disconnect wallet?')) return
  await clearSession()
  await clearCredential()
  await saveTxLog([])
  credential = null; session = null; txEntries = []
  showToast('disconnected', 'info')
  showView(viewSetup)
}

// ─── Events ───
btnConnectWallet.addEventListener('click', handleConnectWallet)
btnCreateAccessKey.addEventListener('click', handleCreateAccessKey)
btnDisconnect.addEventListener('click', handleDisconnect)
btnSendTransfer.addEventListener('click', handleSendTransfer)
btnRevokeKey.addEventListener('click', handleRevoke)
btnNewKey.addEventListener('click', () => { showView(viewConnect); refreshConnectView() })

// ─── Init ───
async function init() {
  txEntries = await loadTxLog()
  credential = await loadCredential()
  if (!credential) { showView(viewSetup); return }

  session = await loadSession()
  if (session) {
    if (Date.now() / 1000 > session.expiry) {
      showView(viewExpired)
    } else {
      showActiveTab('status')
      await refreshActiveView()
    }
  } else {
    showView(viewConnect)
    await refreshConnectView()
  }
}

init()
