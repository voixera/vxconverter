import { ApiResponse, MediaCandidate, ScanResult } from "./types";

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
 * Client-side HLS segment downloader & assembler.
 * Used when server relay receives 403 or for direct high-speed client streams.
 */
async function clientDownloadHls(
  masterUrl: string,
  filename: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const res = await fetch(masterUrl);
  if (!res.ok) throw new Error(`HLS fetch failed: ${res.status}`);
  let text = await res.text();
  let playlistUrl = masterUrl;

  // Master playlist variant selection
  if (text.includes("#EXT-X-STREAM-INF")) {
    const lines = text.split("\n");
    let bestUrl = "";
    let maxBw = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        const bwMatch = /BANDWIDTH=(\d+)/i.exec(line);
        const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        const nextLine = (lines[i + 1] || "").trim();
        if (nextLine && !nextLine.startsWith("#")) {
          if (bw >= maxBw || !bestUrl) {
            maxBw = bw;
            try {
              bestUrl = new URL(nextLine, masterUrl).toString();
            } catch {}
          }
        }
      }
    }
    if (bestUrl) {
      playlistUrl = bestUrl;
      const subRes = await fetch(playlistUrl);
      if (subRes.ok) text = await subRes.text();
    }
  }

  // Extract all segment URLs
  const lines = text.split("\n");
  const segmentUrls: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith("#")) {
      try {
        const absSegment = new URL(line, playlistUrl).toString();
        segmentUrls.push(absSegment);
      } catch {}
    }
  }

  if (segmentUrls.length === 0) {
    throw new Error("No media segments found in HLS playlist");
  }

  const baseName = filename.replace(/\.[^.]+$/, "");
  const finalFilename = `${baseName}.mp4`;

  // Path A: File System Access API
  if (typeof window !== "undefined" && "showSaveFilePicker" in window && (window as any).showSaveFilePicker) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: finalFilename,
        types: [{ description: "MP4 Video", accept: { "video/mp4": [".mp4"] } }],
      });
      const writable = await handle.createWritable();
      for (let i = 0; i < segmentUrls.length; i++) {
        const segUrl = segmentUrls[i];
        const segRes = await fetch(segUrl);
        if (segRes.ok && segRes.body) {
          const reader = segRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.length > 0) {
              await writable.write(value);
            }
          }
        }
        onProgress?.(i + 1, segmentUrls.length);
      }
      await writable.close();
      return;
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error("Cancelled");
    }
  }

  // Path B: Blob Accumulator
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < segmentUrls.length; i++) {
    const segUrl = segmentUrls[i];
    const segRes = await fetch(segUrl);
    if (segRes.ok && segRes.body) {
      const reader = segRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          chunks.push(value);
        }
      }
    }
    onProgress?.(i + 1, segmentUrls.length);
  }

  const blob = new Blob(chunks as unknown as ArrayBuffer[], { type: "video/mp4" });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = blobUrl;
  a.download = finalFilename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
    if (document.body.contains(a)) document.body.removeChild(a);
  }, 15000);
}

/**
 * Download media automatically to user's disk via server streaming relay with client fallback.
 */
export async function triggerDownload(
  mediaOrId: string | MediaCandidate,
  filename: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const mediaObj = typeof mediaOrId === "object" ? mediaOrId : undefined;
  const mediaId = typeof mediaOrId === "string" ? mediaOrId : mediaOrId.id;

  let res: Response | null = null;
  let serverErrorMsg = "";

  try {
    res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_id: mediaId, media: mediaObj }),
    });
  } catch (netErr: any) {
    serverErrorMsg = netErr?.message || "Server connection failed";
  }

  const ct = res?.headers.get("content-type") || "";
  const isServerOk = res && res.ok && !ct.includes("application/json");

  // If server failed (e.g. 502/403 upstream block), execute client-side direct stream download
  if (!res || !isServerOk) {
    if (res && !res.ok) {
      try {
        const errPayload = await res.json();
        serverErrorMsg = errPayload?.error?.message || `Server returned ${res.status}`;
      } catch {}
    }

    if (mediaObj?.media_url) {
      const isHls = mediaObj.media_url.includes(".m3u8") || mediaObj.mime.includes("mpegurl");
      if (isHls) {
        try {
          await clientDownloadHls(mediaObj.media_url, filename, onProgress);
          return;
        } catch (clientErr: any) {
          if (clientErr?.message === "Cancelled") throw clientErr;
          const msg = clientErr?.message || "";
          if (msg.includes("403") || msg.includes("Failed to fetch")) {
            throw new Error("Stream is protected by Cloudflare security. Use [Preview] to watch.");
          }
          throw new Error(`Download failed: ${msg || serverErrorMsg}`);
        }
      } else {
        try {
          const directRes = await fetch(mediaObj.media_url);
          if (directRes.ok && directRes.body) {
            const blob = await directRes.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
              URL.revokeObjectURL(blobUrl);
              if (document.body.contains(a)) document.body.removeChild(a);
            }, 15000);
            return;
          }
        } catch {}
      }
    }

    if (serverErrorMsg.includes("403") || serverErrorMsg.includes("Cloudflare")) {
      throw new Error("Stream is protected by Cloudflare security. Use [Preview] to watch.");
    }

    throw new Error(serverErrorMsg || "Download failed");
  }

  const serverRes = res;

  // Server streaming download path
  const disposition = serverRes.headers.get("content-disposition") || "";
  const nameMatch =
    /filename\*=UTF-8''([^;\s]+)/.exec(disposition) ||
    /filename="([^"]+)"/.exec(disposition);
  const dlFilename = nameMatch ? decodeURIComponent(nameMatch[1]) : filename;
  const totalBytes = serverRes.headers.get("content-length") ? Number(serverRes.headers.get("content-length")) : null;

  // Path A: File System Access API
  if (typeof window !== "undefined" && "showSaveFilePicker" in window && serverRes.body) {
    try {
      const ext = dlFilename.split(".").pop() || "mp4";
      const mimeMap: Record<string, string> = {
        mp4: "video/mp4",
        webm: "video/webm",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        wav: "audio/wav",
        ogg: "audio/ogg",
        m3u8: "application/x-mpegurl",
      };
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: dlFilename,
        types: [{ description: "Media", accept: { [mimeMap[ext] || "application/octet-stream"]: [`.${ext}`] } }],
      });
      const writable = await handle.createWritable();

      const reader = serverRes.body.getReader();
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          await writable.write(value);
          loaded += value.byteLength;
          onProgress?.(loaded, totalBytes);
        }
      }
      await writable.close();
      return;
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error("Cancelled");
    }
  }

  // Path B: ReadableStream accumulator
  if (serverRes.body) {
    const reader = serverRes.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.(loaded, totalBytes);
      }
    }

    const blob = new Blob(chunks as unknown as ArrayBuffer[], { type: ct || "video/mp4" });
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
    return;
  }

  throw new Error("Stream response body is empty");
}
