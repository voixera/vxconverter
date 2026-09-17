"use client";

import React, { useEffect, useState } from "react";

const STEPS = [
  "resolving url & verifying ssrf guard...",
  "checking upstream response & headers...",
  "sniffing public media objects...",
  "running probe book (generic, html5, opengraph, jsonld)...",
  "building deduplicated catalog...",
];

export function ScanLine() {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => (prev < STEPS.length - 1 ? prev + 1 : prev));
    }, 600);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto my-6 p-4 rounded bg-vx-surface border border-vx-border font-mono text-xs text-vx-dim">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-vx-border/50 text-[11px] text-vx-dim/70">
        <span className="w-2 h-2 rounded-full bg-vx-accent animate-pulse" />
        <span>VX_CORE // RUNTIME_INSPECTOR</span>
      </div>
      <div className="space-y-1.5">
        {STEPS.slice(0, currentStep + 1).map((step, idx) => {
          const isLatest = idx === currentStep;
          return (
            <div
              key={step}
              className={`flex items-center gap-2 transition-opacity duration-200 ${
                isLatest ? "text-vx-text" : "text-vx-dim/60"
              }`}
            >
              <span className="text-vx-accent select-none">&gt;</span>
              <span>{step}</span>
              {isLatest && (
                <span className="inline-block w-1.5 h-3 bg-vx-accent animate-pulse-fast ml-1" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
