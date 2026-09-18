"use client";

import React, { useState } from "react";
import { MediaCandidate } from "../lib/types";
import { DownloadChip } from "./download-chip";
import { PeekState } from "./peek-state";

interface MediaTileProps {
  media: MediaCandidate;
}

export function MediaTile({ media }: MediaTileProps) {
  const [showPreview, setShowPreview] = useState(false);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return null;
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
  };

  const filename = `${media.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "vx-media"}-${media.quality}.${media.extension}`;

  const metaTokens = [
    media.extension.toUpperCase(),
    media.quality.toUpperCase(),
    media.width && media.height ? `${media.width}×${media.height}` : null,
    formatDuration(media.duration),
    formatSize(media.filesize),
  ].filter(Boolean);

  return (
    <div className="flex flex-col bg-vx-surface border border-vx-border hover:border-vx-border-light transition-colors rounded overflow-hidden">
      {/* Top Media Preview Area */}
      {showPreview ? (
        <PeekState media={media} onClose={() => setShowPreview(false)} />
      ) : (
        <div className="relative aspect-video bg-vx-bg flex items-center justify-center overflow-hidden group border-b border-vx-border/60">
          {media.thumbnail_url ? (
            <img
              src={media.thumbnail_url}
              alt={media.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-vx-dim p-4">
              <svg
                className="w-8 h-8 opacity-40 mb-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <span className="font-mono text-[11px] text-vx-dim/70">
                {media.mime}
              </span>
            </div>
          )}

          {/* Quality Tag Badge */}
          <div className="absolute top-2 right-2 bg-vx-bg/90 backdrop-blur-sm border border-vx-border px-2 py-0.5 rounded text-[11px] font-mono text-vx-text">
            {media.quality.toUpperCase()}
          </div>
        </div>
      )}

      {/* Metadata & Controls Footer */}
      <div className="p-3.5 flex flex-col justify-between flex-1 gap-3">
        <div>
          <h3
            className="text-sm font-medium text-vx-text line-clamp-2 title"
            title={media.title}
          >
            {media.title}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-vx-dim">
            {metaTokens.map((token, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="opacity-40">·</span>}
                <span>{token}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-vx-border/50">
          <button
            onClick={() => setShowPreview((prev) => !prev)}
            className="px-2.5 py-1.5 rounded text-xs font-mono text-vx-text bg-vx-subtle border border-vx-border hover:bg-vx-border/40 transition-colors"
          >
            {showPreview ? "[ Hide ]" : "[ Preview ]"}
          </button>

          <DownloadChip
            mediaId={media.id}
            filename={filename}
            filesize={media.filesize}
            mime={media.mime}
          />
        </div>
      </div>
    </div>
  );
}
