"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScanResult } from "../lib/types";
import { MediaTile } from "./media-tile";
import { SourcePill } from "./source-pill";
import { Layers, Film, Music, Radio, Sparkles, RotateCcw } from "lucide-react";

interface ResultShelfProps {
  result: ScanResult;
  onReset?: () => void;
}

export function ResultShelf({ result, onReset }: ResultShelfProps) {
  const [filter, setFilter] = useState<"all" | "video" | "audio" | "stream">("all");

  const filteredMedia = result.media.filter((m) => {
    if (filter === "all") return true;
    if (filter === "video") return m.kind === "video";
    if (filter === "audio") return m.kind === "audio" || m.mime.startsWith("audio/");
    if (filter === "stream") return m.kind === "stream";
    return true;
  });

  const count = result.media_count;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full max-w-5xl mx-auto my-10 space-y-5"
    >
      {/* Top Inspector Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-vx-surface/80 backdrop-blur-md border border-vx-border rounded-lg shadow-lg">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-vx-emerald animate-pulse" />
            <span className="font-mono text-xs font-semibold tracking-wider text-vx-text uppercase">
              {count} {count === 1 ? "CANDIDATE DISCOVERED" : "CANDIDATES DISCOVERED"}
            </span>
          </div>
          <SourcePill
            url={result.source_url}
            provider={result.provider}
            cached={result.cached}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Filter Pills */}
          <div className="hidden sm:flex items-center gap-1 bg-vx-bg p-1 rounded border border-vx-border text-[11px] font-mono">
            <button
              onClick={() => setFilter("all")}
              className={`px-2 py-0.5 rounded transition-colors ${
                filter === "all" ? "bg-vx-accent text-vx-bg font-bold" : "text-vx-dim hover:text-vx-text"
              }`}
            >
              All ({count})
            </button>
            <button
              onClick={() => setFilter("video")}
              className={`px-2 py-0.5 rounded transition-colors ${
                filter === "video" ? "bg-vx-accent text-vx-bg font-bold" : "text-vx-dim hover:text-vx-text"
              }`}
            >
              Videos
            </button>
            <button
              onClick={() => setFilter("audio")}
              className={`px-2 py-0.5 rounded transition-colors ${
                filter === "audio" ? "bg-vx-accent text-vx-bg font-bold" : "text-vx-dim hover:text-vx-text"
              }`}
            >
              Audio
            </button>
            <button
              onClick={() => setFilter("stream")}
              className={`px-2 py-0.5 rounded transition-colors ${
                filter === "stream" ? "bg-vx-accent text-vx-bg font-bold" : "text-vx-dim hover:text-vx-text"
              }`}
            >
              Streams
            </button>
          </div>

          {onReset && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 text-xs font-mono text-vx-dim hover:text-vx-text px-2.5 py-1.5 rounded border border-vx-border bg-vx-bg hover:bg-vx-subtle transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>[ Clear ]</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid Layout with Stagger Animation */}
      <motion.div
        layout
        className={`grid gap-4 ${
          filteredMedia.length === 1
            ? "grid-cols-1 max-w-xl mx-auto"
            : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        }`}
      >
        <AnimatePresence mode="popLayout">
          {filteredMedia.map((media, idx) => (
            <motion.div
              key={media.id}
              layout
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25, delay: idx * 0.05 }}
            >
              <MediaTile media={media} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </motion.section>
  );
}
