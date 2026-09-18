"use client";

import React, { useState } from "react";
import { triggerDownload } from "../lib/wire";

interface DownloadChipProps {
  mediaId: string;
  filename: string;
  filesize: number | null;
  mime: string;
}

export function DownloadChip({ mediaId, filename, filesize, mime }: DownloadChipProps) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      await triggerDownload(mediaId, filename);
    } catch (e: any) {
      setError(e.message || "Failed");
    } finally {
      setDownloading(false);
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
        className={`px-3 py-1.5 rounded text-xs font-mono font-medium transition-all duration-150 flex items-center gap-1.5 border ${
          downloading
            ? "bg-vx-surface text-vx-dim border-vx-border cursor-wait"
            : "bg-vx-accent text-vx-bg border-vx-accent hover:bg-vx-accent-hover active:translate-y-0.5"
        }`}
      >
        {downloading ? (
          <>
            <svg
              className="animate-spin h-3.5 w-3.5 text-vx-dim"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
            <span>Streaming...</span>
          </>
        ) : (
          <>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            <span>Download</span>
            {sizeLabel && (
              <span className="opacity-80 text-[10px] pl-1 font-mono">
                ({sizeLabel})
              </span>
            )}
          </>
        )}
      </button>
      {error && (
        <span className="text-[11px] font-mono text-vx-red">
          &gt; {error}
        </span>
      )}
    </div>
  );
}
