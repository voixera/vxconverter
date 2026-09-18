"use client";

import React, { useState } from "react";
import { MediaCandidate } from "../lib/types";
import { X } from "lucide-react";

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
    <div className="w-full bg-vx-bg-elevated border border-vx-border-light/80 rounded-xl overflow-hidden shadow-2xl animate-fade-in vx-corner-mark">
      {/* Top Metadata Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-vx-surface/90 border-b border-vx-border text-xs font-mono">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-vx-accent animate-pulse" />
          <span className="font-semibold tracking-wider text-vx-text uppercase">
            VIEWER // {media.quality.toUpperCase()} · {media.extension.toUpperCase()}
          </span>
          <span className="hidden sm:inline-block text-vx-dim text-[10px]">
            [{media.mime}]
          </span>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-xs font-mono text-vx-dim hover:text-vx-text px-2 py-1 rounded bg-vx-subtle hover:bg-vx-border transition-colors"
            aria-label="Close media preview"
          >
            <X className="w-3.5 h-3.5" />
            <span>[ Close ]</span>
          </button>
        )}
      </div>

      {/* Media Player Canvas */}
      <div className="relative bg-black flex items-center justify-center min-h-[260px] max-h-[480px]">
        {isEmbed ? (
          <iframe
            src={media.media_url}
            className="w-full h-[320px] sm:h-[440px] border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : isAudio ? (
          <div className="flex flex-col items-center justify-center p-8 gap-5 w-full bg-gradient-to-b from-vx-surface to-vx-bg">
            {media.thumbnail_url && (
              <img
                src={media.thumbnail_url}
                alt={media.title}
                className="w-32 h-32 object-cover rounded-lg ring-1 ring-vx-border shadow-xl"
              />
            )}
            <div className="text-center">
              <p className="text-sm font-medium text-vx-text line-clamp-1">{media.title}</p>
              <p className="text-[11px] font-mono text-vx-dim mt-0.5 uppercase tracking-wider">
                {media.mime} · Audio Stream
              </p>
            </div>
            <audio
              controls
              onError={() => setPlaybackFailed(true)}
              className="w-full max-w-md accent-vx-accent"
            >
              <source src={media.media_url} type={media.mime} />
              Your browser does not support HTML5 audio playback.
            </audio>
          </div>
        ) : isPlayable && !playbackFailed ? (
          <video
            controls
            autoPlay
            preload="metadata"
            poster={media.thumbnail_url || undefined}
            onError={() => setPlaybackFailed(true)}
            className="w-full h-full max-h-[480px] object-contain"
          >
            <source src={media.media_url} type={media.mime} />
            Your browser does not support HTML5 video preview.
          </video>
        ) : media.thumbnail_url ? (
          <div className="relative w-full h-full flex flex-col items-center justify-center p-6 text-center">
            <img
              src={media.thumbnail_url}
              alt={media.title}
              className="max-h-[300px] object-contain rounded-lg ring-1 ring-vx-border opacity-70"
            />
            <div className="mt-3 px-3 py-1.5 rounded bg-vx-surface/90 border border-vx-border text-xs font-mono text-vx-dim">
              [ Direct browser preview restricted by source — use Download to retrieve media ]
            </div>
          </div>
        ) : (
          <div className="p-10 text-center text-xs font-mono text-vx-dim">
            &gt; Direct browser preview unavailable for this container format.
            <br />
            Click Download to save the complete media file.
          </div>
        )}
      </div>
    </div>
  );
}
