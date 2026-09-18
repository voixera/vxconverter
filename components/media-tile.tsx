"use client";

import React, { useRef, useState } from "react";
import { motion } from "framer-motion";
import { MediaCandidate } from "../lib/types";
import { DownloadChip } from "./download-chip";
import { PeekState } from "./peek-state";
import { Eye, Copy, Check, Film, Music, Radio, ExternalLink } from "lucide-react";

interface MediaTileProps {
  media: MediaCandidate;
  index?: number;
}

export function MediaTile({ media, index = 0 }: MediaTileProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imgError, setImgError] = useState(false);
  const tileRef = useRef<HTMLDivElement>(null);

  const isAudio = media.kind === "audio" || media.mime.startsWith("audio/");
  const isStream = media.kind === "stream" || media.extension === "m3u8";

  const formatDuration = (s: number | null) => {
    if (!s) return null;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
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

  const kindColor = isAudio
    ? "text-purple-400/70"
    : isStream
    ? "text-blue-400/70"
    : "text-white/50";

  const KindIcon = isAudio ? Music : isStream ? Radio : Film;

  return (
    <motion.div
      ref={tileRef}
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, delay: index * 0.05, ease: "easeOut" }}
      whileHover={{ y: -2 }}
      className="relative flex flex-col rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.4)] hover:border-white/[0.12] hover:shadow-[0_8px_40px_rgba(0,0,0,0.5)] transition-all duration-300 group"
    >
      {/* Top accent line */}
      <div className={`absolute top-0 left-0 right-0 h-px ${isAudio ? "bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" : isStream ? "bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" : "bg-gradient-to-r from-transparent via-white/20 to-transparent"}`} />

      {/* Thumbnail / Preview area */}
      {showPreview ? (
        <PeekState media={media} onClose={() => setShowPreview(false)} />
      ) : (
        <div className="relative aspect-video bg-black/40 flex items-center justify-center overflow-hidden border-b border-white/[0.05] select-none">
          {media.thumbnail_url && !imgError ? (
            <>
              <img
                src={media.thumbnail_url}
                alt={media.title}
                onError={() => setImgError(true)}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 opacity-80 group-hover:opacity-100"
              />
              {/* Thumbnail overlay gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 w-full h-full p-6">
              <div className="p-3 rounded-2xl bg-white/[0.05] border border-white/[0.08]">
                <KindIcon className={`w-6 h-6 ${kindColor}`} />
              </div>
              <span className="font-mono text-[10px] text-white/20 uppercase tracking-widest">{media.mime}</span>
            </div>
          )}

          {/* Badges */}
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider backdrop-blur-md border ${
              isAudio
                ? "bg-purple-950/60 border-purple-500/20 text-purple-300/80"
                : isStream
                ? "bg-blue-950/60 border-blue-500/20 text-blue-300/80"
                : "bg-black/60 border-white/10 text-white/60"
            }`}>
              <KindIcon className="w-2.5 h-2.5" />
              {isAudio ? "AUDIO" : isStream ? "STREAM" : "VIDEO"}
            </span>
          </div>

          <div className="absolute top-2.5 right-2.5">
            <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-black/70 border border-white/10 text-white/70 backdrop-blur-md uppercase">
              {media.quality}
            </span>
          </div>

          {/* Direct badge */}
          {media.is_direct && (
            <div className="absolute bottom-2.5 right-2.5">
              <span className="px-1.5 py-0.5 rounded text-[8px] font-mono bg-emerald-950/60 border border-emerald-500/20 text-emerald-400/70 uppercase tracking-wider">
                DIRECT
              </span>
            </div>
          )}
        </div>
      )}

      {/* Info body */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        <div className="flex-1">
          <h3
            className="text-sm font-medium text-white/80 line-clamp-2 leading-snug group-hover:text-white transition-colors"
            title={media.title}
          >
            {media.title}
          </h3>

          {/* Meta tokens */}
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {metaTokens.map((token, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-white/10 text-[10px]">·</span>}
                <span className="font-mono text-[10px] text-white/30">{token}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/[0.05]">
          <div className="flex items-center gap-1.5">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowPreview((p) => !p)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-white/40 bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.08] hover:text-white/70 transition-all"
            >
              <Eye className="w-3 h-3" />
              <span>{showPreview ? "Close" : "Preview"}</span>
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={copyUrl}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-mono border border-white/[0.07] hover:bg-white/[0.08] transition-all"
              title="Copy URL"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-white/30" />
                  <span className="text-white/30">Copy</span>
                </>
              )}
            </motion.button>
          </div>

          <DownloadChip mediaId={media.id} filename={filename} filesize={media.filesize} mime={media.mime} />
        </div>
      </div>
    </motion.div>
  );
}
