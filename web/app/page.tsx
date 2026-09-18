"use client";

import { FormEvent, useEffect, useState } from "react";
import { ResultShelf } from "../components/result-shelf";
import { ScanLine } from "../components/scan-line";
import { analyzeUrl, fetchHistory } from "../lib/wire";
import { HealthData, ScanResult } from "../lib/types";

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((payload: { data?: HealthData }) => setHealth(payload.data || null))
      .catch(() => setHealth(null));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const parsed = new URL(url.trim());
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter valid URL");
      return;
    }

    setBusy(true);
    try {
      const next = await analyzeUrl(url.trim());
      setResult(next);
      setHistory((items) => [next, ...items.filter((item) => item.scan_id !== next.scan_id)].slice(0, 5));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inspection failed");
    } finally {
      setBusy(false);
    }
  }

  async function showHistory() {
    setError(null);
    try {
      setHistory(await fetchHistory());
    } catch {
      setError("Could not load inspection history");
    }
  }

  return (
    <main className="min-h-screen vx-grid-bg px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between border-b border-vx-border pb-5">
          <div className="flex items-center gap-3 font-mono">
            <img src="/logo.png" alt="VX Converter" className="h-9 w-9 rounded object-cover" />
            <div>
              <p className="text-sm font-bold tracking-[0.2em] text-vx-text">CONVERTER</p>
              <p className="text-[10px] uppercase tracking-widest text-vx-dim">public media inspector</p>
            </div>
          </div>
          <span className="hidden items-center gap-2 font-mono text-[11px] text-vx-dim sm:flex">
            <span className={`h-2 w-2 rounded-full ${health ? "bg-vx-emerald" : "bg-vx-dim"}`} />
            {health?.status || "engine status unknown"}
          </span>
        </header>

        <section className="mx-auto max-w-3xl py-20 text-center sm:py-28">
          <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-vx-accent">VX_CORE // RUNTIME_INSPECTOR</p>
          <h1 className="text-4xl font-semibold tracking-tight text-vx-text sm:text-6xl">Find media hiding in plain sight.</h1>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-vx-dim">Paste a public page URL. VX scans headers, metadata, and embedded objects, then gives you clean download candidates.</p>

          <form onSubmit={submit} className="mt-9 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="source-url">Source URL</label>
            <input
              id="source-url"
              type="url"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/video"
              disabled={busy}
              className="min-w-0 flex-1 rounded border border-vx-border bg-vx-surface px-4 py-3 font-mono text-sm text-vx-text outline-none placeholder:text-vx-dim/60 focus:border-vx-accent"
            />
            <button disabled={busy} className="rounded bg-vx-accent px-5 py-3 font-mono text-sm font-bold text-vx-bg transition-colors hover:bg-vx-accent-hover disabled:cursor-wait disabled:opacity-60">
              {busy ? "Inspecting..." : "Inspect URL"}
            </button>
          </form>
          {error && <p role="alert" className="mt-3 text-left font-mono text-xs text-vx-red">&gt; {error}</p>}
          {busy && <ScanLine />}
        </section>

        {result && <ResultShelf result={result} onReset={() => setResult(null)} />}

        <section className="mx-auto mt-12 max-w-5xl border-t border-vx-border pt-4">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-xs uppercase tracking-widest text-vx-dim">Recent inspections</h2>
            <button onClick={showHistory} className="font-mono text-xs text-vx-accent hover:text-vx-text">[ Load history ]</button>
          </div>
          {history.length > 0 && (
            <div className="mt-3 divide-y divide-vx-border rounded border border-vx-border bg-vx-surface">
              {history.map((item) => (
                <button key={item.scan_id} onClick={() => setResult(item)} className="flex w-full items-center justify-between gap-4 px-3 py-3 text-left hover:bg-vx-subtle">
                  <span className="truncate font-mono text-xs text-vx-text">{item.source_url}</span>
                  <span className="shrink-0 font-mono text-[11px] text-vx-dim">{item.media_count} media</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
