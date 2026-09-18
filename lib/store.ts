// ponytail: in-memory store, resets on cold start. Add Redis/DB when persistence needed.
import type { ScanResult, MediaCandidate } from "./types";

declare global {
  // survive Next.js hot reload in dev
  // eslint-disable-next-line no-var
  var __vx_history: ScanResult[] | undefined;
}

function getStore(): ScanResult[] {
  if (!globalThis.__vx_history) globalThis.__vx_history = [];
  return globalThis.__vx_history;
}

export function pushHistory(result: ScanResult): void {
  const store = getStore();
  // deduplicate by scan_id, keep latest 20
  const idx = store.findIndex((r) => r.scan_id === result.scan_id);
  if (idx !== -1) store.splice(idx, 1);
  store.unshift(result);
  if (store.length > 20) store.length = 20;
}

export function getHistory(): ScanResult[] {
  return getStore().slice();
}

export function getMediaById(mediaId: string): MediaCandidate | undefined {
  const store = getStore();
  for (const scan of store) {
    const found = scan.media.find((m) => m.id === mediaId);
    if (found) return found;
  }
  return undefined;
}
