"use client";

import React, { useState } from "react";
import { Download, Loader2, AlertCircle, Check } from "lucide-react";
import { triggerDownload } from "../lib/wire";

interface DownloadChipProps {
  mediaId: string;
  filename: string;
  filesize: number | null;
  mime: string;
}

export function DownloadChip({ mediaId, filename, filesize, mime }: DownloadChipProps) {
  const [downloading, setDownloading] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    setSuccess(false);
    setStage("Verifying stream...");

    try {
      setStage("Validating bytes...");
      await triggerDownload(mediaId, filename);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.message || "Download failed");
    } finally {
      setDownloading(false);
      setStage(null);
    }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes || bytes === 0) return null;
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
  };

  const sizeLabel = formatSize(filesize);

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleDownload}
        disabled={downloading}
        className={`px-3 py-1.5 rounded text-xs font-mono font-medium transition-all duration-150 flex items-center gap-1.5 border select-none ${
          success
            ? "bg-neutral-800 text-white border-neutral-600"
            : downloading
              ? "bg-neutral-900 text-neutral-400 border-neutral-800 cursor-wait"
              : "bg-white text-black border-white hover:bg-neutral-200 active:translate-y-0.5"
        }`}
      >
        {success ? (
          <>
            <Check className="w-3.5 h-3.5" />
            <span>Saved</span>
          </>
        ) : downloading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
            <span>{stage || "Streaming..."}</span>
          </>
        ) : (
          <>
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
            {sizeLabel && (
              <span className="opacity-75 text-[10px] pl-0.5 font-mono">
                ({sizeLabel})
              </span>
            )}
          </>
        )}
      </button>

      {error && (
        <span className="flex items-center gap-1 text-[11px] font-mono text-red-400 pt-0.5">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>{error}</span>
        </span>
      )}
    </div>
  );
}
