/**
 * MPP content script — runs in ISOLATED world.
 *
 * Bridges between the page context (mpp-inject.ts) and the background
 * service worker. Also injects mpp-inject.js into the page.
 */

const EXTENSION_ID = '__TEMPO_MPP__'

// Inject the fetch wrapper into page context
const script = document.createElement('script')
script.src = chrome.runtime.getURL('mpp-inject.js')
script.onload = () => script.remove()
;(document.head || document.documentElement).appendChild(script)

// Listen for challenges from the page
window.addEventListener('message', async (event) => {
  if (event.source !== window) return
  if (event.data?.type !== `${EXTENSION_ID}:challenge`) return

  const { requestId, url, wwwAuthenticate, method } = event.data

  try {
    // Send to background for processing
    const response = await chrome.runtime.sendMessage({
      type: 'mpp:challenge',
      requestId,
      url,
      wwwAuthenticate,
      method,
    })

    // Send credential back to page
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
})
