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

export async function triggerDownload(mediaId: string, filename: string): Promise<void> {
  const res = await fetch("/api/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ media_id: mediaId, format: "original" }),
  });

  if (!res.ok) {
    const errPayload = await res.json().catch(() => null);
    throw new Error(errPayload?.error?.message || `Download failed with HTTP ${res.status}`);
  }

  const blob = await res.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(blobUrl);
  document.body.removeChild(a);
}
