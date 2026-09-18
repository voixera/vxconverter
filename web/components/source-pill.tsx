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
    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-neutral-900 border border-neutral-800 text-xs font-mono">
      <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
      <span className="text-neutral-200 font-medium">{hostname}</span>
      {provider && (
        <span className="text-neutral-400 text-[10px] px-1.5 py-0.5 rounded bg-black border border-neutral-800 uppercase tracking-wider">
          {provider}
        </span>
      )}
      {cached && (
        <span className="text-neutral-300 text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 uppercase tracking-wider">
          cached
        </span>
      )}
    </div>
  );
}
