/**
 * MPP fetch wrapper — injected into page context (MAIN world).
 *
 * Wraps window.fetch to detect HTTP 402 responses with WWW-Authenticate: Payment.
 * When detected, sends the challenge to the extension via window.postMessage,
 * waits for the credential, and retries the request.
 *
 * Caches credentials per URL so repeat requests (e.g. page refresh) resend
 * the existing proof-of-payment instead of triggering a new charge.
 */

const EXTENSION_ID = '__TEMPO_MPP__'
const CACHE_PREFIX = '__mpp_cred:'

// Store the original fetch
const originalFetch = window.fetch.bind(window)

// Pending payment resolutions
const pendingPayments = new Map<string, {
  resolve: (credential: string) => void
  reject: (error: Error) => void
}>()

// ─── Credential cache (localStorage) ───
function cacheKey(url: string): string {
  try {
    const u = new URL(url, location.origin)
    return CACHE_PREFIX + u.origin + u.pathname
  } catch {
    return CACHE_PREFIX + url
  }
}

function getCachedCredential(url: string): string | null {
  try { return localStorage.getItem(cacheKey(url)) } catch { return null }
}

function setCachedCredential(url: string, credential: string) {
  try { localStorage.setItem(cacheKey(url), credential) } catch {}
}

function clearCachedCredential(url: string) {
  try { localStorage.removeItem(cacheKey(url)) } catch {}
}

// Listen for credential responses from the content script
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.type !== `${EXTENSION_ID}:credential`) return

  const { requestId, credential, error } = event.data
  const pending = pendingPayments.get(requestId)
  if (!pending) return
  pendingPayments.delete(requestId)

  if (error) {
    pending.reject(new Error(error))
  } else {
    pending.resolve(credential)
  }
})

// Wrap fetch
window.fetch = async function mppFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  // Check for a cached credential and attach it
  const cached = getCachedCredential(url)
  if (cached) {
    const headers = new Headers(init?.headers)
    if (!headers.has('Authorization')) {
      headers.set('Authorization', cached)
    }
    const cachedResponse = await originalFetch(input, { ...init, headers })

    // If server accepts the cached credential → done
    if (cachedResponse.status !== 402) return cachedResponse

    // Credential rejected (expired challenge, server restart, etc.) → clear and fall through
    clearCachedCredential(url)
  }

  const response = await originalFetch(input, init)

  // Only intercept 402 responses with Payment challenge
  if (response.status !== 402) return response

  const wwwAuth = response.headers.get('www-authenticate')
  if (!wwwAuth || !wwwAuth.startsWith('Payment ')) return response

  // Generate a unique request ID
  const requestId = crypto.randomUUID()

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

  const paidResponse = await originalFetch(input, retryInit)

  // Cache the credential for future requests to this URL
  if (paidResponse.ok) {
    setCachedCredential(url, credential)
  }

  return paidResponse
}

console.log('[Tempo MPP] Payment-aware fetch active')
