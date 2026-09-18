import { ApiResponse, ScanResult } from "./types";

export async function analyzeUrl(url: string): Promise<ScanResult> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const payload: ApiResponse<ScanResult> = await res.json().catch(() => ({
    ok: false,
    error: { code: "PARSE_ERROR", message: "Received invalid JSON from engine" },
  }));

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

type ProgressCallback = (loaded: number, total: number | null) => void;

/**
 * Download media via server relay.
 *
 * 1. POST /api/download → server fetches + validates + streams bytes
 * 2. Check Content-Type — JSON = error, throw with message
 * 3. Chrome 86+: File System Access API (showSaveFilePicker) — true streaming,
 *    zero RAM buffering, reports byte progress
 * 4. Fallback: ReadableStream → Uint8Array accumulator → Blob → anchor click
 *    Tracks bytes for progress even without Content-Length
 */
export async function triggerDownload(
  mediaId: string,
  filename: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const res = await fetch("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId }),
  });

  // Error detection — server returns JSON on failure
  const ct = res.headers.get("content-type") || "";
  if (!res.ok || ct.includes("application/json")) {
    let msg = `Download failed (HTTP ${res.status})`;
    try {
      const errPayload = await res.json();
      msg = errPayload?.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }

  // Extract server-provided filename from Content-Disposition
  const disposition = res.headers.get("content-disposition") || "";
  const nameMatch =
    /filename\*=UTF-8''([^;\s]+)/.exec(disposition) ||
    /filename="([^"]+)"/.exec(disposition);
  const dlFilename = nameMatch ? decodeURIComponent(nameMatch[1]) : filename;
  const totalBytes = res.headers.get("content-length") ? Number(res.headers.get("content-length")) : null;

  // Path A: File System Access API — true streaming to disk, no RAM buffer
  if (typeof window !== "undefined" && "showSaveFilePicker" in window && res.body) {
    try {
      const ext = dlFilename.split(".").pop() || "mp4";
      const mimeMap: Record<string, string> = {
        mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg",
        m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", m3u8: "application/x-mpegurl",
      };
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: dlFilename,
        types: [{ description: "Media", accept: { [mimeMap[ext] || "application/octet-stream"]: [`.${ext}`] } }],
      });
      const writable = await handle.createWritable();

      if (onProgress) {
        // Pipe with progress tracking
        const reader = res.body.getReader();
        let loaded = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writable.write(value);
          loaded += value.byteLength;
          onProgress(loaded, totalBytes);
        }
      } else {
        await res.body.pipeTo(writable);
      }
      await writable.close();
      return;
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error("Cancelled");
      // Fall through to blob method
    }
  }

  // Path B: ReadableStream accumulator → Blob → anchor click
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, totalBytes);
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
      document.body.removeChild(a);
    }, 10000);
    return;
  }

  throw new Error("Response body is empty");
}
