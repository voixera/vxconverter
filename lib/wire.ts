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

/**
 * Download via streaming fetch POST.
 * - Checks Content-Type before triggering save — catches JSON error responses.
 * - Streams response body via blob URL (works cross-browser, no server-side buffering on client).
 * - For yt-dlp relayed content, server streams bytes as they come.
 */
export async function triggerDownload(mediaId: string, filename: string): Promise<void> {
  const res = await fetch("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId }),
  });

  // Check if server returned an error JSON instead of media
  const ct = res.headers.get("content-type") || "";
  if (!res.ok || ct.includes("application/json")) {
    let msg = `Download failed (HTTP ${res.status})`;
    try {
      const errPayload = await res.json();
      msg = errPayload?.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }

  // Get filename from Content-Disposition if available
  const disposition = res.headers.get("content-disposition") || "";
  const nameMatch =
    /filename\*=UTF-8''([^;]+)/.exec(disposition) ||
    /filename="([^"]+)"/.exec(disposition);
  const dlFilename = nameMatch ? decodeURIComponent(nameMatch[1]) : filename;

  // Stream response body to blob, then trigger save
  // Using streaming approach: fetch → blob → anchor click
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = blobUrl;
  a.download = dlFilename;
  document.body.appendChild(a);
  a.click();
  // Delay revoke to ensure browser picks up the blob
  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
    document.body.removeChild(a);
  }, 5000);
}
