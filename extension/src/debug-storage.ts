/**
 * Debug script — dumps all localStorage keys from wallet.tempo.xyz
 * so we can find where the credential is stored.
 * 
 * This is injected via chrome.scripting.executeScript in MAIN world.
 */
export function dumpWalletStorage(): Record<string, any> {
  const result: Record<string, any> = {}

  // Dump all localStorage
  const lsKeys = Object.keys(localStorage)
  result._localStorageKeys = lsKeys

  for (const key of lsKeys) {
    const raw = localStorage.getItem(key)
    if (!raw) continue
    try {
      result[`ls:${key}`] = JSON.parse(raw)
    } catch {
      // Store first 200 chars of non-JSON values
      result[`ls:${key}`] = raw.substring(0, 200)
    }
  }

  // Dump all sessionStorage
  const ssKeys = Object.keys(sessionStorage)
  result._sessionStorageKeys = ssKeys

  for (const key of ssKeys) {
    const raw = sessionStorage.getItem(key)
    if (!raw) continue
    try {
      result[`ss:${key}`] = JSON.parse(raw)
    } catch {
      result[`ss:${key}`] = raw?.substring(0, 200)
    }
  }

  return result
}
