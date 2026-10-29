// A short-lived in-memory cache for slow Shopify lookups (products, orders,
// the shop's name) that the live chat screens would otherwise repeat on every
// refresh. undefined (Shopify couldn't be asked) is never cached, so the next
// load tries again.
const store: Map<string, { at: number; value: Promise<unknown> }> = ((globalThis as { helpDeskMemo?: Map<string, { at: number; value: Promise<unknown> }> }).helpDeskMemo ??= new Map());
const MAX_ENTRIES = 2000;

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { at: Date.now(), value });
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
  // A failed or unanswered lookup isn't kept.
  value.then((result) => { if (result === undefined) store.delete(key); }, () => store.delete(key));
  return value;
}

export function forget(key: string) {
  store.delete(key);
}
