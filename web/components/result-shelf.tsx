"use client";

import React from "react";
import { ScanResult } from "../lib/types";
import { MediaTile } from "./media-tile";
import { SourcePill } from "./source-pill";

interface ResultShelfProps {
  result: ScanResult;
  onReset?: () => void;
}

export function ResultShelf({ result, onReset }: ResultShelfProps) {
  const count = result.media_count;

  return (
    <section className="w-full max-w-5xl mx-auto my-8 space-y-4">
      {/* Top Inspector Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-vx-surface border border-vx-border rounded">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold text-vx-text">
            {count} {count === 1 ? "media found" : "media candidates found"}
          </span>
          <SourcePill
            url={result.source_url}
            provider={result.provider}
            cached={result.cached}
          />
        </div>

        {onReset && (
          <button
            onClick={onReset}
            className="text-xs font-mono text-vx-dim hover:text-vx-text px-2 py-1 rounded border border-vx-border bg-vx-bg transition-colors"
          >
            [ Clear Inspection ]
          </button>
        )}
      </div>

      {/* Grid or Single Layout */}
      <div
        className={`grid gap-4 ${
          count === 1
            ? "grid-cols-1 max-w-2xl mx-auto"
            : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        }`}
      >
        {result.media.map((media) => (
          <MediaTile key={media.id} media={media} />
        ))}
      </div>
    </section>
  );
}
