import { ApiResponse, MediaCandidate, ScanResult } from "./types";

export async function analyzeUrl(url: string): Promise<ScanResult> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const payload: ApiResponse<ScanResult> & { error?: { code: string; message: string } } = await res
    .json()
    .catch(() => ({ ok: false, error: { code: "PARSE_ERROR", message: "Received invalid JSON from engine" } }));

  if (!payload.ok || !payload.data) {
    throw new Error(payload.error?.message || `Inspection failed with HTTP ${res.status}`);
  }
  return payload.data;
}

export async function fetchHistory(): Promise<ScanResult[]> {
  const res = await fetch("/api/history");
  if (!res.ok) return [];
  const payload: ApiResponse<ScanResult[]> = await res.json().catch(() => ({ ok: false }));
  return payload.data || [];
}

export type ProgressCallback = (loaded: number, total: number | null) => void;

/**
 * Download a media candidate through the Engine V4 VX server relay.
 *
 * The server validates the real container and, when `convert` is set, performs
 * a REAL ffmpeg transcode. We stream the response straight to disk and trust
 * the Content-Disposition/content-type the engine provides — no client-side
 * guessing that could save an HTML error page as a video.
 */
export async function triggerDownload(
  mediaOrId: string | MediaCandidate,
  filename: string,
  onProgress?: ProgressCallback,
  convert?: "mp3" | "m4a" | "wav" | "mp4" | "webm" | null,
): Promise<void> {
  const mediaObj = typeof mediaOrId === "object" ? mediaOrId : undefined;
  const mediaId = typeof mediaOrId === "string" ? mediaOrId : mediaOrId.id;

  let res: Response;
  try {
    res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_id: mediaId, media: mediaObj, convert: convert || undefined, filename }),
    });
  } catch (netErr: any) {
    throw new Error(netErr?.message || "Network error contacting the download relay");
  }

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  if (!res.ok || isJson) {
    let message = `Download failed (HTTP ${res.status})`;
    try {
      const payload = await res.json();
      message = payload?.error?.message || message;
      if (payload?.error?.code) message = `[${payload.error.code}] ${message}`;
    } catch {}
    throw new Error(message);
  }

  const disposition = res.headers.get("content-disposition") || "";
  const nameMatch = /filename\*=UTF-8''([^;\s]+)/.exec(disposition) || /filename="([^"]+)"/.exec(disposition);
  const dlFilename = nameMatch ? decodeURIComponent(nameMatch[1]) : filename;
  const totalBytes = res.headers.get("content-length") ? Number(res.headers.get("content-length")) : null;

  if (!res.body) {
    throw new Error("Download relay returned an empty body");
  }

  // Preferred path: File System Access API (streams to disk without buffering).
  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({ suggestedName: dlFilename });
      const writable = await handle.createWritable();
      const reader = res.body.getReader();
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length) {
          await writable.write(value);
          loaded += value.byteLength;
          onProgress?.(loaded, totalBytes);
        }
      }
      await writable.close();
      return;
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error("Cancelled");
      // Fall through to blob path on any other error.
    }
  }

  // Fallback: accumulate to a Blob (bounded by the server; conversions are already bounded).
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, totalBytes);
    }
  }

  const blob = new Blob(chunks as unknown as ArrayBuffer[], { type: ct || "application/octet-stream" });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = blobUrl;
  a.download = dlFilename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
    if (document.body.contains(a)) document.body.removeChild(a);
  }, 15000);
}
