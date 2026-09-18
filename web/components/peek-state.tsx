"use client";

import React, { useState } from "react";
import { MediaCandidate } from "../lib/types";

interface PeekStateProps {
  media: MediaCandidate;
  onClose?: () => void;
}

export function PeekState({ media, onClose }: PeekStateProps) {
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <div className="w-full bg-vx-surface border border-vx-border rounded overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-vx-subtle border-b border-vx-border text-xs font-mono text-vx-dim">
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-vx-cyan" />
          <span>INSPECTOR_PREVIEW // {media.quality.toUpperCase()}</span>
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="hover:text-vx-text px-1 text-sm font-mono"
          >
            ✕
          </button>
        )}
      </div>

      <div className="relative bg-black flex items-center justify-center min-h-[240px] max-h-[460px]">
        {media.media_url.includes("embed") || media.media_url.includes("youtube-nocookie.com") ? (
          <iframe
            src={media.media_url}
            className="w-full h-[320px] sm:h-[400px] border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : !videoFailed ? (
          <video
            controls
            preload="metadata"
            poster={media.thumbnail_url || undefined}
            onError={() => setVideoFailed(true)}
            className="w-full h-full max-h-[460px] object-contain"
          >
            <source src={media.media_url} type={media.mime} />
            Your browser does not support HTML5 video preview.
          </video>
        ) : media.thumbnail_url ? (
          <div className="relative w-full h-full flex flex-col items-center justify-center p-4">
            <img
              src={media.thumbnail_url}
              alt={media.title}
              className="max-h-[320px] object-contain rounded"
            />
            <span className="mt-2 text-xs font-mono text-vx-dim">
              [ Stream preview restricted by source - thumbnail fallback active ]
            </span>
          </div>
        ) : (
          <div className="p-8 text-center text-xs font-mono text-vx-dim">
            &gt; Stream preview not available directly in browser context.
            <br />
            Use Download to retrieve the media file.
          </div>
        )}
      </div>
    </div>
  );
}
