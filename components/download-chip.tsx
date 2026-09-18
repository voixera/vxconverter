"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Loader2, AlertCircle, Check, X } from "lucide-react";
import { triggerDownload } from "../lib/wire";
import type { MediaCandidate } from "../lib/types";

interface DownloadChipProps {
  mediaId: string;
  media?: MediaCandidate;
  filename: string;
  filesize: number | null;
  mime: string;
}

export function DownloadChip({ mediaId, media, filename, filesize, mime }: DownloadChipProps) {
  const [state, setState] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const formatSize = (bytes: number | null) => {
    if (!bytes) return null;
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
  };
  const sizeLabel = formatSize(filesize);

  const handleDownload = async () => {
    if (state === "downloading") return;
    setError(null);
    setProgress("Connecting...");
    setState("downloading");

    try {
      await triggerDownload(media || mediaId, filename, (loaded, total) => {
        if (total) {
          const pct = Math.round((loaded / total) * 100);
          setProgress(`${pct}%`);
        } else {
          setProgress(`${formatSize(loaded) ?? "..."}`);
        }
      });
      setState("done");
      setTimeout(() => setState("idle"), 4000);
    } catch (e: any) {
      if (e?.message === "Cancelled") {
        setState("idle");
        return;
      }
      setError(e.message || "Download failed");
      setState("error");
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={handleDownload}
        disabled={state === "downloading"}
        className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-semibold border transition-all duration-200 overflow-hidden ${
          state === "done"
            ? "bg-emerald-950/40 border-emerald-500/20 text-emerald-400"
            : state === "downloading"
            ? "bg-white/[0.06] border-white/[0.08] text-white/40 cursor-wait"
            : state === "error"
            ? "bg-red-950/30 border-red-500/20 text-red-400 hover:bg-red-950/50"
            : "bg-white text-black border-white hover:bg-white/90 shadow-[0_0_16px_rgba(255,255,255,0.12)]"
        }`}
      >
        {/* Idle shimmer */}
        {state === "idle" && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-black/10 to-transparent"
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 3 }}
          />
        )}

        {state === "done" ? (
          <>
            <Check className="w-3 h-3" />
            <span>Saved</span>
          </>
        ) : state === "downloading" ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{progress || "..."}</span>
          </>
        ) : state === "error" ? (
          <>
            <Download className="w-3 h-3" />
            <span>Retry</span>
          </>
        ) : (
          <>
            <Download className="w-3 h-3" />
            <span>Download</span>
            {sizeLabel && <span className="text-black/40 text-[9px]">{sizeLabel}</span>}
          </>
        )}
      </motion.button>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-1.5 max-w-[240px]"
          >
            <AlertCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
            <span className="font-mono text-[10px] text-red-400/80 leading-snug flex-1">{error}</span>
            <button
              onClick={() => {
                setError(null);
                setState("idle");
              }}
              className="text-red-400/40 hover:text-red-400 shrink-0 ml-1"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
