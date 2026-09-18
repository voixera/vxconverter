"use client";

import React, { useState } from "react";
import { Download, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
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
      setStage("Validating media bytes...");
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
        className={`px-3 py-1.5 rounded text-xs font-mono font-medium transition-all duration-200 flex items-center gap-1.5 border select-none ${
          success
            ? "bg-vx-emerald/20 text-vx-emerald border-vx-emerald/40"
            : downloading
              ? "bg-vx-surface text-vx-dim border-vx-border cursor-wait"
              : "bg-vx-accent text-vx-bg border-vx-accent hover:bg-vx-accent-hover active:translate-y-0.5 shadow-sm"
        }`}
      >
        {success ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Saved</span>
          </>
        ) : downloading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-vx-accent" />
            <span>{stage || "Streaming..."}</span>
          </>
        ) : (
          <>
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
            {sizeLabel && (
              <span className="opacity-80 text-[10px] pl-0.5 font-mono">
                ({sizeLabel})
              </span>
            )}
          </>
        )}
      </button>

      {error && (
        <span className="flex items-center gap-1 text-[11px] font-mono text-vx-red pt-0.5">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>{error}</span>
        </span>
      )}
    </div>
  );
}
