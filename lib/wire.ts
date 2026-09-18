import { ApiResponse, ScanResult } from "./types";

export async function analyzeUrl(url: string): Promise<ScanResult> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  const payload: ApiResponse<ScanResult> = await res.json().catch(() => ({
    ok: false,
    error: {
      code: "PARSE_ERROR",
      message: "Received invalid JSON from engine",
    },
  }));

  if (!payload.ok || !payload.data) {
    throw new Error(payload.error?.message || `Inspection failed with HTTP ${res.status}`);
  }

  return payload.data;
}

export async function fetchHistory(): Promise<ScanResult[]> {
  const res = await fetch("/api/history");
  if (!res.ok) return [];
  const payload: ApiResponse<ScanResult[]> = await res.json().catch(() => ({
    ok: false,
  }));
  return payload.data || [];
}

/**
 * Trigger a streaming download by navigating the browser to the GET download endpoint.
 * No JS blob buffering — browser streams directly to disk.
 */
export async function triggerDownload(mediaId: string, _filename: string): Promise<void> {
  // Use GET endpoint: browser navigates, Content-Disposition attachment triggers save dialog.
  // File name comes from the server-side Content-Disposition header.
  const url = `/api/download?media_id=${encodeURIComponent(mediaId)}`;
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
