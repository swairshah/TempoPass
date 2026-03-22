/**
 * MPP content script — runs in ISOLATED world.
 *
 * Bridges between the page context (mpp-inject.ts) and the background
 * service worker. Also injects mpp-inject.js into the page and
 * exposes the connected wallet address to pages.
 */

const EXTENSION_ID = '__TEMPO_MPP__'

// Inject the fetch wrapper into page context
const script = document.createElement('script')
script.src = chrome.runtime.getURL('mpp-inject.js')
script.onload = () => script.remove()
;(document.head || document.documentElement).appendChild(script)

// Expose wallet address to the page (so sites can check if user already paid)
async function exposeWalletAddress() {
  try {
    const data = await chrome.storage.local.get('walletCredential')
    if (data.walletCredential?.address) {
      window.postMessage({
        type: `${EXTENSION_ID}:wallet`,
        address: data.walletCredential.address,
      }, '*')
    }
  } catch {}
}
exposeWalletAddress()

// Listen for challenges from the page
window.addEventListener('message', async (event) => {
  if (event.source !== window) return

  // Handle challenge messages
  if (event.data?.type === `${EXTENSION_ID}:challenge`) {
    const { requestId, url, wwwAuthenticate, method } = event.data

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'mpp:challenge',
        requestId,
        url,
        wwwAuthenticate,
        method,
      })

      window.postMessage({
        type: `${EXTENSION_ID}:credential`,
        requestId,
        credential: response.credential,
        error: response.error,
      }, '*')
    } catch (err: any) {
      window.postMessage({
        type: `${EXTENSION_ID}:credential`,
        requestId,
        error: err.message || 'Extension communication failed',
      }, '*')
    }
  }

  // Handle wallet address requests from pages
  if (event.data?.type === `${EXTENSION_ID}:getWallet`) {
    exposeWalletAddress()
  }
})
