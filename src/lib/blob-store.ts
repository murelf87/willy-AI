// Almacén de imágenes grandes en el navegador (IndexedDB): guarda el ARCHIVO ORIGINAL de cada foto, sin recomprimir ni reducir, y sin el
// límite de unos 5 MB de localStorage. Si IndexedDB no está disponible, se usa la memoria de la pestaña (no sobrevive a recargar).

const DB = "willy-libro-img";
const STORE = "img";
const memory = new Map<string, Blob>();

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putBlob(key: string, blob: Blob): Promise<boolean> {
  memory.set(key, blob);
  const db = await open();
  if (!db) return false;
  const ok = (await run(db, "readwrite", (s) => s.put(blob, key))) !== null;
  db.close();
  return ok;
}

export async function getBlob(key: string): Promise<Blob | null> {
  const db = await open();
  if (db) {
    const found = await run<Blob>(db, "readonly", (s) => s.get(key) as IDBRequest<Blob>);
    db.close();
    if (found) return found;
  }
  return memory.get(key) ?? null;
}

export async function delBlob(key: string): Promise<void> {
  memory.delete(key);
  const db = await open();
  if (!db) return;
  await run(db, "readwrite", (s) => s.delete(key));
  db.close();
}
