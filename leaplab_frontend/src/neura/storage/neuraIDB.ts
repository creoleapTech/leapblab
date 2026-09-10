/**
 * Neura IndexedDB storage – handles large Image Classifier projects that exceed localStorage quota.
 * localStorage limit ~5-10 MB, while a 20-image class can be 4-8 MB base64. IDB quota is 50MB+ and
 * stores structured clone directly (no JSON stringify overhead).
 */

const DB_NAME = 'leaplab-neura-v1'
const STORE_NAME = 'projects'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'type' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface NeuraStoredProject {
  type: string
  project: any
  updatedAt: number
}

export async function saveNeuraProject(type: string, project: any): Promise<{ ok: boolean; bytes?: number; error?: string }> {
  try {
    const db = await openDB()
    return new Promise(resolve => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const payload: NeuraStoredProject = { type, project, updatedAt: Date.now() }
      const req = store.put(payload)
      req.onsuccess = () => {
        // Also try to keep a tiny localStorage marker for fast boot (without images if needed)
        try {
          // Store a lightweight marker (just ids/counts) for quick existence check
          const marker = { type, updatedAt: Date.now(), sampleCounts: project?.classes?.map((c: any) => c.samples.length) }
          localStorage.setItem(`neura-idb-marker-${type}`, JSON.stringify(marker))
        } catch {}
        // Estimate bytes for UI (rough JSON size)
        let bytes = 0
        try { bytes = JSON.stringify(project).length } catch {}
        resolve({ ok: true, bytes })
      }
      req.onerror = () => resolve({ ok: false, error: String(req.error) })
      tx.oncomplete = () => db.close()
      tx.onerror = () => resolve({ ok: false, error: String(tx.error) })
    })
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export async function loadNeuraProject(type: string): Promise<any | null> {
  try {
    const db = await openDB()
    return new Promise(resolve => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(type)
      req.onsuccess = () => {
        const result = req.result as NeuraStoredProject | undefined
        resolve(result?.project ?? null)
      }
      req.onerror = () => resolve(null)
      tx.oncomplete = () => db.close()
    })
  } catch {
    return null
  }
}

export async function deleteNeuraProject(type: string): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const req = tx.objectStore(STORE_NAME).delete(type)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
      tx.oncomplete = () => db.close()
    })
    try { localStorage.removeItem(`neura-idb-marker-${type}`) } catch {}
  } catch {}
}

// Migration helper: if localStorage has a project but IDB is empty, migrate it
export async function migrateLocalStorageToIDB(type: string): Promise<boolean> {
  try {
    const raw = localStorage.getItem(`neura-project-${type}`)
    if (!raw) return false
    const existing = await loadNeuraProject(type)
    if (existing) return false // IDB already has data, don't overwrite
    const parsed = JSON.parse(raw)
    const res = await saveNeuraProject(type, parsed)
    return res.ok
  } catch { return false }
}
