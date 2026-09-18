"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScanResult } from "../lib/types";
import { MediaTile } from "./media-tile";
import { SourcePill } from "./source-pill";
import { RotateCcw, Film, Music, Radio, Layers } from "lucide-react";

interface ResultShelfProps {
  result: ScanResult;
  onReset?: () => void;
}

type FilterType = "all" | "video" | "audio" | "stream";

const FILTERS: { key: FilterType; label: string; icon: React.ReactNode }[] = [
  { key: "all", label: "All", icon: <Layers className="w-3 h-3" /> },
  { key: "video", label: "Video", icon: <Film className="w-3 h-3" /> },
  { key: "audio", label: "Audio", icon: <Music className="w-3 h-3" /> },
  { key: "stream", label: "Stream", icon: <Radio className="w-3 h-3" /> },
];

export function ResultShelf({ result, onReset }: ResultShelfProps) {
  const [filter, setFilter] = useState<FilterType>("all");

  const filteredMedia = result.media.filter((m) => {
    if (filter === "all") return true;
    if (filter === "video") return m.kind === "video";
    if (filter === "audio") return m.kind === "audio" || m.mime.startsWith("audio/");
    if (filter === "stream") return m.kind === "stream";
    return true;
  });

  const counts = {
    all: result.media.length,
    video: result.media.filter((m) => m.kind === "video").length,
    audio: result.media.filter((m) => m.kind === "audio" || m.mime.startsWith("audio/")).length,
    stream: result.media.filter((m) => m.kind === "stream").length,
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full max-w-5xl mx-auto mb-12 space-y-5"
    >
      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl shadow-[0_4px_32px_rgba(0,0,0,0.4)]">
        <div className="flex flex-wrap items-center gap-3">
          {/* Count */}
          <div className="flex items-center gap-2 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)] animate-pulse" />
            <span className="text-xs font-bold tracking-widest text-white/80 uppercase">
              {result.media_count} {result.media_count === 1 ? "candidate" : "candidates"} found
            </span>
          </div>
          <SourcePill url={result.source_url} provider={result.provider} cached={result.cached} />
        </div>

        <div className="flex items-center gap-2">
          {/* Filter tabs */}
          <div className="hidden sm:flex items-center gap-0.5 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]">
            {FILTERS.map(({ key, label, icon }) => {
              const count = counts[key];
              if (key !== "all" && count === 0) return null;
              const active = filter === key;
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-[10px] font-medium transition-all duration-200 ${
                    active
                      ? "bg-white text-black shadow-sm"
                      : "text-white/30 hover:text-white/60"
                  }`}
                >
                  {icon}
                  <span>{label}</span>
                  <span className={`text-[9px] ${active ? "text-black/40" : "text-white/20"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {onReset && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={onReset}
              className="flex items-center gap-1.5 text-[10px] font-mono text-white/25 hover:text-white/60 px-3 py-1.5 rounded-lg border border-white/[0.07] hover:bg-white/[0.05] transition-all"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Clear</span>
            </motion.button>
          )}
        </div>
      </div>

      {/* Cards grid */}
      <motion.div
        layout
        className={`grid gap-4 ${
          filteredMedia.length === 1
            ? "grid-cols-1 max-w-sm mx-auto"
            : filteredMedia.length === 2
            ? "grid-cols-1 sm:grid-cols-2 max-w-2xl mx-auto"
            : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        }`}
      >
        <AnimatePresence mode="popLayout">
          {filteredMedia.map((media, idx) => (
            <motion.div
              key={media.id}
              layout
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.2 }}
            >
              <MediaTile media={media} index={idx} />
            </motion.div>
          ))}
        </AnimatePresence>

        {filteredMedia.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="col-span-full py-12 text-center font-mono text-[11px] text-white/20"
          >
            No {filter} candidates in this scan.
          </motion.div>
        )}
      </motion.div>
    </motion.section>
  );
}
