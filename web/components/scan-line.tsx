"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, ShieldCheck, Search, Cpu, Check } from "lucide-react";

const STAGES = [
  { label: "Verifying destination & SSRF policy", icon: ShieldCheck },
  { label: "Connecting & negotiating content headers", icon: Search },
  { label: "Inspecting HTML, OpenGraph, JSON-LD metadata", icon: Cpu },
  { label: "Extracting media streams & validating containers", icon: Loader2 },
  { label: "Compiling candidate catalog", icon: Check },
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
      className="w-full max-w-xl mx-auto my-6 p-4 rounded bg-neutral-950/90 backdrop-blur border border-neutral-800 font-mono text-xs text-neutral-400 shadow-2xl"
    >
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-neutral-800 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span className="text-white font-semibold tracking-widest uppercase">
            ENGINE_V4_VX // PIPELINE_ACTIVE
          </span>
        </div>
        <span className="text-neutral-500">STAGE {currentStage + 1}/5</span>
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
                isLatest ? "text-white font-medium" : "text-neutral-500 text-[11px]"
              }`}
            >
              <Icon
                className={`w-3.5 h-3.5 shrink-0 ${
                  isLatest ? "text-white animate-spin" : "text-neutral-400"
                }`}
              />
              <span>{stage.label}</span>
              {isLatest && (
                <span className="inline-block w-1.5 h-3 bg-white animate-pulse ml-auto" />
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
