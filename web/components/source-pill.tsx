import React from "react";

interface SourcePillProps {
  url: string;
  provider?: string;
  cached?: boolean;
}

export function SourcePill({ url, provider, cached }: SourcePillProps) {
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // fallback
  }

  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-vx-subtle border border-vx-border text-xs font-mono">
      <span className="w-1.5 h-1.5 rounded-full bg-vx-emerald" />
      <span className="text-vx-text font-medium">{hostname}</span>
      {provider && (
        <span className="text-vx-dim text-[10px] px-1.5 py-0.5 rounded bg-vx-bg border border-vx-border/60 uppercase tracking-wider">
          {provider}
        </span>
      )}
      {cached && (
        <span className="text-vx-cyan text-[10px] px-1.5 py-0.5 rounded bg-vx-cyan/10 border border-vx-cyan/30 uppercase tracking-wider">
          cached
        </span>
      )}
    </div>
  );
}
