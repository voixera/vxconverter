"use client";

import React, { useState } from "react";
import { MediaCandidate } from "../lib/types";
import { DownloadChip } from "./download-chip";
import { PeekState } from "./peek-state";
import { Eye, Copy, Check, Film, Music, Radio, Sparkles } from "lucide-react";

interface MediaTileProps {
  media: MediaCandidate;
}

export function MediaTile({ media }: MediaTileProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const filename = `${(media.title || "vx-media")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "vx-media"}-${media.quality}.${media.extension}`;

  const isAudio = media.kind === "audio" || media.mime.startsWith("audio/");
  const isStream = media.kind === "stream" || media.extension === "m3u8";

  const metaTokens = [
    media.extension.toUpperCase(),
    media.quality.toUpperCase(),
    media.width && media.height ? `${media.width}×${media.height}` : null,
    formatDuration(media.duration),
    formatSize(media.filesize),
  ].filter(Boolean);

  const copyUrl = () => {
    navigator.clipboard.writeText(media.media_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col bg-vx-surface/90 backdrop-blur border border-vx-border hover:border-vx-border-light transition-all duration-200 rounded-xl overflow-hidden shadow-lg group vx-corner-mark">
      {/* Media Preview or Thumbnail Header */}
      {showPreview ? (
        <PeekState media={media} onClose={() => setShowPreview(false)} />
      ) : (
        <div className="relative aspect-[16/9] bg-vx-bg flex items-center justify-center overflow-hidden border-b border-vx-border">
          {media.thumbnail_url ? (
            <img
              src={media.thumbnail_url}
              alt={media.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-vx-dim p-4">
              {isAudio ? (
                <Music className="w-8 h-8 text-vx-accent opacity-60 mb-2" />
              ) : isStream ? (
                <Radio className="w-8 h-8 text-vx-cyan opacity-60 mb-2" />
              ) : (
                <Film className="w-8 h-8 text-vx-accent opacity-60 mb-2" />
              )}
              <span className="font-mono text-[11px] text-vx-dim/70">
                {media.mime}
              </span>
            </div>
          )}

          {/* Type Badge */}
          <div className="absolute top-2.5 left-2.5 bg-vx-bg/90 backdrop-blur-md border border-vx-border px-2 py-0.5 rounded text-[10px] font-mono text-vx-accent font-semibold tracking-wider uppercase">
            {isAudio ? "AUDIO" : isStream ? "STREAM" : "VIDEO"}
          </div>

          {/* Quality Tag Badge */}
          <div className="absolute top-2.5 right-2.5 bg-vx-bg/90 backdrop-blur-md border border-vx-border px-2.5 py-0.5 rounded text-[10px] font-mono text-vx-text font-bold">
            {media.quality.toUpperCase()}
          </div>
        </div>
      )}

      {/* Info & Actions Body */}
      <div className="p-4 flex flex-col justify-between flex-1 gap-3.5">
        <div>
          <h3
            className="text-sm font-medium text-vx-text line-clamp-2 leading-snug group-hover:text-vx-accent transition-colors"
            title={media.title}
          >
            {media.title}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-vx-dim">
            {metaTokens.map((token, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="opacity-30">·</span>}
                <span className="text-vx-dim/90">{token}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-vx-border/60">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowPreview((prev) => !prev)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-mono text-vx-text bg-vx-subtle border border-vx-border hover:bg-vx-border/60 hover:text-vx-accent transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{showPreview ? "[ Hide ]" : "[ Preview ]"}</span>
            </button>

            <button
              onClick={copyUrl}
              className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-mono text-vx-dim hover:text-vx-text border border-vx-border/60 hover:bg-vx-subtle transition-colors"
              title="Copy Media URL"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-vx-emerald" />
                  <span className="text-vx-emerald">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

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
