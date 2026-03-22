/**
 * Background service worker for Tempo Access Key extension.
 * Handles access key expiry checks.
 */

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
