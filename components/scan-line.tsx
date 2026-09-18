"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, ShieldCheck, Search, Cpu, CheckCircle2 } from "lucide-react";

const STAGES = [
  { label: "Validating destination & SSRF policy", icon: ShieldCheck },
  { label: "Establishing connection & negotiating headers", icon: Search },
  { label: "Inspecting HTML, OpenGraph, JSON-LD metadata", icon: Cpu },
  { label: "Extracting media streams & validating containers", icon: Loader2 },
  { label: "Compiling candidate catalog", icon: CheckCircle2 },
];

export function ScanLine() {
  const [currentStage, setCurrentStage] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStage((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 450);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="w-full max-w-2xl mx-auto my-6 p-4 rounded-lg bg-vx-surface/90 backdrop-blur border border-vx-border font-mono text-xs text-vx-dim shadow-xl"
    >
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-vx-border/50 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-vx-accent animate-pulse" />
          <span className="text-vx-accent font-semibold tracking-widest uppercase">
            ENGINE_V4_VX // PIPELINE_ACTIVE
          </span>
        </div>
        <span className="text-vx-dim/70">STAGE {currentStage + 1}/5</span>
      </div>

      <div className="space-y-2">
        {STAGES.slice(0, currentStage + 1).map((stage, idx) => {
          const isLatest = idx === currentStage;
          const Icon = stage.icon;

          return (
            <motion.div
              key={stage.label}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex items-center gap-2.5 transition-all ${
                isLatest ? "text-vx-text font-medium" : "text-vx-dim/60 text-[11px]"
              }`}
            >
              <Icon
                className={`w-3.5 h-3.5 shrink-0 ${
                  isLatest ? "text-vx-accent animate-spin" : "text-vx-emerald"
                }`}
              />
              <span>{stage.label}</span>
              {isLatest && (
                <span className="inline-block w-1.5 h-3 bg-vx-accent animate-pulse-fast ml-auto" />
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
