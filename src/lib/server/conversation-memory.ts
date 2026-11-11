/** Process-local housekeeping only. Never expires durable records. */
export const MEMORY_INTERVAL_MS = 5_000;
export const MEMORY_BATCH = 200;
export const MESSAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const MESSAGE_CACHE_MAX_ENTRIES = 10_000;
export const MESSAGE_CACHE_MAX_BYTES = 4 * 1024 * 1024;
export type MemoryOptions = {
  now?: () => number;
  schedule?: (task: () => void, milliseconds: number) => () => void;
  cacheMaxEntries?: number;
  cacheMaxBytes?: number;
};

export function periodic(task: () => void, options: MemoryOptions): () => void {
  if (options.schedule) return options.schedule(task, MEMORY_INTERVAL_MS);
  const timer = setInterval(task, MEMORY_INTERVAL_MS);
  timer.unref(); // Not a service, cron or guarantee while the process is suspended.
  return () => clearInterval(timer);
}

/** Incremental round-robin, at most batch entries per call. Busy rows survive.
 * Accessors must ALSO check expiry: physical collection is not authorization.
 */
export function stateSweeper<T>(
  states: Map<string, T>, expired: (value: T) => boolean,
  busy: (key: string) => boolean, removed: (key: string, value: T) => void = () => {}
) {
  let cursor = states.entries();
  let remaining = 0;
  return () => {
    // Freeze each pass's work budget: continuous insertions must not keep an
    // iterator following the growing tail forever and starve old rows.
    if (remaining <= 0) { cursor = states.entries(); remaining = states.size; }
    for (let n = 0; n < MEMORY_BATCH && remaining > 0; n++) {
      const next = cursor.next();
      if (next.done) { remaining = 0; break; }
      remaining--;
      const [key, value] = next.value;
      if (!busy(key) && expired(value)) { states.delete(key); removed(key, value); }
    }
  };
}

/** FIFO bounded technical cache. Reads/repeats never extend an entry's TTL.
 * Capacity eviction is NOT a claim of durable deduplication.
 */
export function messageCache(options: MemoryOptions = {}) {
  const now = options.now ?? Date.now;
  const maxEntries = options.cacheMaxEntries ?? MESSAGE_CACHE_MAX_ENTRIES;
  const maxBytes = options.cacheMaxBytes ?? MESSAGE_CACHE_MAX_BYTES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid memory budget");
  const rows = new Map<string, { value: string; until: number; weight: number }>();
  let bytes = 0;
  function drop(key: string) {
    const row = rows.get(key);
    if (row) { bytes -= row.weight; rows.delete(key); }
  }
  const sweep = stateSweeper(rows, row => now() >= row.until, () => false,
    (_key, row) => { bytes -= row.weight; });
  return {
    get(key: string) {
      const row = rows.get(key);
      if (row && now() >= row.until) { drop(key); return undefined; }
      return row?.value;
    },
    set(key: string, value: string) {
      const prior = rows.get(key);
      if (prior && now() < prior.until) return; // No sliding TTL on replay.
      drop(key);
      // Estimated payload accounting, not an exact JavaScript heap measurement.
      const weight = Buffer.byteLength(key) + Buffer.byteLength(value) + 128;
      if (weight > maxBytes) return; // Never truncate original IDs.
      while (rows.size && (rows.size >= maxEntries || bytes + weight > maxBytes)) {
        drop(rows.keys().next().value!);
      }
      rows.set(key, { value, weight, until: now() + MESSAGE_CACHE_TTL_MS });
      bytes += weight;
    },
    sweep,
    stats: () => ({ entries: rows.size, estimatedBytes: bytes, maxEntries, maxBytes }),
    clear() { rows.clear(); bytes = 0; }
  };
}
