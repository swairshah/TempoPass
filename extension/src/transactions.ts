/**
 * Transactions tab — send transfers and view transaction history.
 * Uses the access key from session storage (no biometric prompts).
 */

import { parseUnits, formatUnits } from 'viem'
import {
  USDC_TOKEN, USDC_SYMBOL, EXPLORER_URL,
  type WalletCredential, type AccessKeySession, type TxLogEntry,
  loadCredential, loadSession, loadTxLog, saveTxLog,
  shortenAddr, formatExpiry,
  getPublicClient, getAccessKeyClient,
} from './shared'

// ─── DOM ───
const $ = (id: string) => document.getElementById(id)!
const viewNoKey = $('viewNoKey')
const viewActive = $('viewActive')
const walletAddr = $('walletAddr')
const keyAddr = $('keyAddr')
const keyExpiry = $('keyExpiry')
const keyRemaining = $('keyRemaining')
const statusMeta = $('statusMeta')
const inputRecipient = $('inputRecipient') as HTMLInputElement
const inputAmount = $('inputAmount') as HTMLInputElement
const btnSend = $('btnSend') as HTMLButtonElement
const txLogEl = $('txLog')
const txEmpty = $('txEmpty')
const toast = $('toast')

// ─── State ───
let credential: WalletCredential | null = null
let session: AccessKeySession | null = null
let txEntries: TxLogEntry[] = []

// ─── UI ───
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  toast.textContent = message
  toast.className = `toast ${type}`
  toast.classList.remove('hidden')
  setTimeout(() => toast.classList.add('hidden'), 4000)
}

function renderTxLog() {
  if (txEntries.length === 0) {
    txLogEl.innerHTML = ''
    txEmpty.classList.remove('hidden')
    return
  }
  txEmpty.classList.add('hidden')

  txLogEl.innerHTML = txEntries.map(e => {
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

async function refreshStatus() {
  if (!session || !credential) return
  walletAddr.textContent = shortenAddr(credential.address)
  keyAddr.textContent = shortenAddr(session.accessKeyAddress)
  keyExpiry.textContent = formatExpiry(session.expiry)
  statusMeta.textContent = formatExpiry(session.expiry)

  try {
    const remaining = await getPublicClient().accessKey.getRemainingLimit({
      account: session.rootAddress as `0x${string}`,
      accessKey: session.accessKeyAddress as `0x${string}`,
      token: USDC_TOKEN,
    })
    keyRemaining.textContent = formatUnits(remaining, 6) + ` ${USDC_SYMBOL}`
  } catch {
    keyRemaining.textContent = session.spendingLimit + ' USDC (est.)'
  }
}

// ─── Send ───
async function handleSend() {
  if (!session || !credential) return

  const recipient = inputRecipient.value.trim()
  if (!recipient || !recipient.startsWith('0x') || recipient.length !== 42) {
    showToast('enter a valid recipient address', 'error')
    return
  }

  const amount = parseFloat(inputAmount.value)
  if (isNaN(amount) || amount <= 0) {
    showToast('enter a valid amount', 'error')
    return
  }

  if (Date.now() / 1000 > session.expiry) {
    showToast('access key expired — create a new one from the popup', 'error')
    return
  }

  btnSend.disabled = true
  btnSend.textContent = 'sending...'

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
    renderTxLog()
    await refreshStatus()
  } catch (err: any) {
    console.error('Transfer error:', err)
    const msg = err.shortMessage || err.message || 'transfer failed'
    const displayMsg = msg.includes('SpendingLimit') ? 'spending limit exceeded' : msg.substring(0, 80)
    showToast(displayMsg, 'error')
    txEntries.unshift({
      hash: '0x' + '0'.repeat(64),
      amount: amount.toString(),
      to: recipient,
      timestamp: Date.now(),
      status: 'error',
      error: displayMsg.substring(0, 50),
    })
    await saveTxLog(txEntries.slice(0, 20))
    renderTxLog()
  } finally {
    btnSend.disabled = false
    btnSend.textContent = 'send →'
  }
}

// ─── Events ───
btnSend.addEventListener('click', handleSend)

// Allow Enter to send
inputAmount.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSend()
})

// ─── Init ───
async function init() {
  credential = await loadCredential()
  session = await loadSession()
  txEntries = await loadTxLog()

  if (!credential || !session || Date.now() / 1000 > session.expiry) {
    viewNoKey.classList.remove('hidden')
    viewActive.classList.add('hidden')
    return
  }

  viewNoKey.classList.add('hidden')
  viewActive.classList.remove('hidden')

  renderTxLog()
  await refreshStatus()
}

init()
