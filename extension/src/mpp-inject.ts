/**
 * MPP fetch wrapper — injected into page context (MAIN world).
 *
 * Wraps window.fetch to detect HTTP 402 responses with WWW-Authenticate: Payment.
 * When detected, sends the challenge to the extension via window.postMessage,
 * waits for the credential, and retries the request.
 */

const EXTENSION_ID = '__TEMPO_MPP__'

// Wallet address (set by content script)
;(window as any).__TEMPO_WALLET_ADDRESS__ = null

// Store the original fetch
const originalFetch = window.fetch.bind(window)

// Pending payment resolutions
const pendingPayments = new Map<string, {
  resolve: (credential: string) => void
  reject: (error: Error) => void
}>()

// Listen for messages from the content script
window.addEventListener('message', (event) => {
  if (event.source !== window) return

  // Credential responses
  if (event.data?.type === `${EXTENSION_ID}:credential`) {
    const { requestId, credential, error } = event.data
    const pending = pendingPayments.get(requestId)
    if (!pending) return
    pendingPayments.delete(requestId)

    if (error) {
      pending.reject(new Error(error))
    } else {
      pending.resolve(credential)
    }
  }

  // Wallet address from extension
  if (event.data?.type === `${EXTENSION_ID}:wallet`) {
    ;(window as any).__TEMPO_WALLET_ADDRESS__ = event.data.address
    window.dispatchEvent(new CustomEvent('tempo:wallet', {
      detail: { address: event.data.address }
    }))
  }
})

// Wrap fetch
window.fetch = async function mppFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Attach wallet address to all requests so servers can check existing access
  const addr = (window as any).__TEMPO_WALLET_ADDRESS__
  if (addr) {
    const headers = new Headers(init?.headers)
    if (!headers.has('X-Wallet-Address')) {
      headers.set('X-Wallet-Address', addr)
    }
    init = { ...init, headers }
  }

  const response = await originalFetch(input, init)

  // Only intercept 402 responses with Payment challenge
  if (response.status !== 402) return response

  const wwwAuth = response.headers.get('www-authenticate')
  if (!wwwAuth || !wwwAuth.startsWith('Payment ')) return response

  // Generate a unique request ID
  const requestId = crypto.randomUUID()

  // Get the request URL for display
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  // Send challenge to content script → background
  window.postMessage({
    type: `${EXTENSION_ID}:challenge`,
    requestId,
    url,
    wwwAuthenticate: wwwAuth,
    method: init?.method || 'GET',
  }, '*')

  // Wait for credential from extension
  const credential = await new Promise<string>((resolve, reject) => {
    pendingPayments.set(requestId, { resolve, reject })
    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingPayments.has(requestId)) {
        pendingPayments.delete(requestId)
        reject(new Error('Payment timeout'))
      }
    }, 60000)
  })

  // Retry with credential
  const retryInit: RequestInit = { ...init, headers: new Headers(init?.headers) }
  ;(retryInit.headers as Headers).set('Authorization', credential)

  return originalFetch(input, retryInit)
}

console.log('[Tempo MPP] Payment-aware fetch active')
