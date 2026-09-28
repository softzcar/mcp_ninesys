// Caché en memoria con TTL por clave. Suficiente para un proceso PM2 único por
// servidor; el objetivo es evitar martillar la API con lecturas idénticas dentro
// de la ventana de frescura de cada recurso (ver CACHE_TTL en constants.ts).

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

const store = new Map<string, Entry<unknown>>();

/**
 * Devuelve el valor cacheado si sigue fresco; si no, ejecuta el loader, cachea
 * y devuelve el resultado. Los errores del loader NO se cachean.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && now - hit.fetchedAt < ttlMs) {
    return hit.value;
  }
  const value = await loader();
  store.set(key, { value, fetchedAt: now });
  return value;
}

export function invalidate(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
