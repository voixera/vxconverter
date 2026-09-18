"use client";

import React, { useState } from "react";
import { MediaCandidate } from "../lib/types";

interface PeekStateProps {
  media: MediaCandidate;
  onClose?: () => void;
}

export function PeekState({ media, onClose }: PeekStateProps) {
  const [playbackFailed, setPlaybackFailed] = useState(false);

  const isEmbed =
    media.kind === "stream" &&
    (media.media_url.includes("embed") ||
      media.media_url.includes("youtube-nocookie.com") ||
      media.media_url.includes("player.vimeo.com"));

  const isAudio = media.kind === "audio" || media.mime.startsWith("audio/");
  const isPlayable = media.playable !== false && !isEmbed;

  return (
    <div className="w-full bg-vx-surface border border-vx-border rounded overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-vx-subtle border-b border-vx-border text-xs font-mono text-vx-dim">
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-vx-cyan" />
          <span>ENGINE_V4_VX // PREVIEW // {media.quality.toUpperCase()}</span>
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="hover:text-vx-text px-1 text-sm font-mono"
            aria-label="Close preview"
          >
            ✕
          </button>
        )}
      </div>

      <div className="relative bg-black flex items-center justify-center min-h-[240px] max-h-[460px]">
        {isEmbed ? (
          <iframe
            src={media.media_url}
            className="w-full h-[320px] sm:h-[400px] border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : isAudio ? (
          <div className="flex flex-col items-center justify-center p-6 gap-4 w-full">
            {media.thumbnail_url && (
              <img
                src={media.thumbnail_url}
                alt={media.title}
                className="w-28 h-28 object-cover rounded shadow"
              />
            )}
            <audio
              controls
              onError={() => setPlaybackFailed(true)}
              className="w-full max-w-md"
            >
              <source src={media.media_url} type={media.mime} />
              Your browser does not support HTML5 audio playback.
            </audio>
          </div>
        ) : isPlayable && !playbackFailed ? (
          <video
            controls
            preload="metadata"
            poster={media.thumbnail_url || undefined}
            onError={() => setPlaybackFailed(true)}
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
            <span className="mt-3 text-xs font-mono text-vx-dim">
              [ Preview unavailable — download only ]
            </span>
          </div>
        ) : (
          <div className="p-8 text-center text-xs font-mono text-vx-dim">
            &gt; Preview unavailable — download only.
            <br />
            Use Download to retrieve the media file.
          </div>
        )}
      </div>
    </div>
  );
}
