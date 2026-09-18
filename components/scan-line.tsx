"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, Search, Cpu, Database, Zap } from "lucide-react";
import gsap from "gsap";

const STAGES = [
  { label: "SSRF policy check + destination verify", icon: ShieldCheck, code: "guard.validate(url)" },
  { label: "Connect + negotiate content headers", icon: Search, code: "fetcher.probe(headers)" },
  { label: "Parse HTML · OpenGraph · JSON-LD", icon: Cpu, code: "extractor.run(html)" },
  { label: "Extract stream candidates + validate bytes", icon: Database, code: "validator.chunk(stream)" },
  { label: "Compile media catalog", icon: Zap, code: "catalog.finalize()" },
];

export function ScanLine() {
  const [stage, setStage] = useState(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setStage((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (progressRef.current) {
      gsap.to(progressRef.current, {
        width: `${((stage + 1) / STAGES.length) * 100}%`,
        duration: 0.4,
        ease: "power2.out",
      });
    }
  }, [stage]);

  useEffect(() => {
    if (containerRef.current) {
      gsap.from(containerRef.current, { opacity: 0, y: 10, duration: 0.4, ease: "power2.out" });
    }
  }, []);

  return (
    <div ref={containerRef} className="w-full max-w-lg mx-auto mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl overflow-hidden shadow-2xl">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-pulse shadow-[0_0_6px_rgba(255,255,255,0.4)]" />
          <span className="font-mono text-[10px] font-bold tracking-[0.25em] text-white/60 uppercase">
            ENGINE_V4_VX PIPELINE
          </span>
        </div>
        <span className="font-mono text-[9px] text-white/20 uppercase tracking-widest">
          {stage + 1}/{STAGES.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-px bg-white/[0.05] relative">
        <div
          ref={progressRef}
          className="absolute top-0 left-0 h-full bg-white/40 shadow-[0_0_8px_rgba(255,255,255,0.3)]"
          style={{ width: "0%" }}
        />
      </div>

      {/* Stage list */}
      <div className="p-4 space-y-2.5">
        <AnimatePresence>
          {STAGES.map((s, i) => {
            if (i > stage) return null;
            const isActive = i === stage;
            const Icon = s.icon;
            return (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex items-center gap-3 ${isActive ? "text-white" : "text-white/25"}`}
              >
                <div className={`shrink-0 p-1 rounded ${isActive ? "bg-white/10" : ""}`}>
                  <Icon className={`w-3 h-3 ${isActive ? "text-white animate-pulse" : "text-white/20"}`} />
                </div>
                <span className={`font-mono text-[11px] flex-1 ${isActive ? "font-medium" : ""}`}>
                  {s.label}
                </span>
                <span className={`font-mono text-[9px] ${isActive ? "text-white/40" : "text-white/10"} hidden sm:block`}>
                  {s.code}
                </span>
                {isActive && (
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity }}
                    className="w-1 h-3.5 bg-white/60 rounded-sm shrink-0"
                  />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
