/**
 * Background service worker for Tempo Access Key extension.
 * 
 * Opens the extension UI as a standalone window (not a popup bubble)
 * so that WebAuthn/Touch ID dialogs don't close it.
 */

let windowId: number | null = null

// Click extension icon → open as standalone window
chrome.action.onClicked.addListener(async () => {
  // If window already exists, focus it
  if (windowId !== null) {
    try {
      const win = await chrome.windows.get(windowId)
      if (win) {
        await chrome.windows.update(windowId, { focused: true })
        return
      }
    } catch {
      windowId = null
    }
  }

  // Open popup.html in a standalone popup window
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 420,
    height: 700,
  })
  windowId = win.id ?? null
})

// Track when our window is closed
chrome.windows.onRemoved.addListener((id) => {
  if (id === windowId) windowId = null
})

// Handle access key expiry checks
chrome.alarms?.create('checkExpiry', { periodInMinutes: 1 })

chrome.alarms?.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkExpiry') {
    const data = await chrome.storage.session.get('accessKeySession')
    if (data.accessKeySession) {
      const session = data.accessKeySession
      if (session.expiry && Date.now() / 1000 > session.expiry) {
        await chrome.storage.session.remove('accessKeySession')
        console.log('[Tempo] Access key expired, session cleared')
      }
    }
  }
})

console.log('[Tempo Access Key] Background service worker loaded')
