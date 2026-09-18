"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import gsap from "gsap";
import { WebglBackdrop } from "../components/webgl-backdrop";
import { ResultShelf } from "../components/result-shelf";
import { ScanLine } from "../components/scan-line";
import { analyzeUrl, fetchHistory } from "../lib/wire";
import { HealthData, ScanResult } from "../lib/types";
import {
  Search,
  ShieldCheck,
  Film,
  Music,
  Radio,
  Cpu,
  History,
  Activity,
  ArrowRight,
  Sparkles,
  Layers,
} from "lucide-react";

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heroHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const heroSubRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((payload: { data?: HealthData }) => setHealth(payload.data || null))
      .catch(() => setHealth(null));

    fetchHistory()
      .then((items) => setHistory(items.slice(0, 6)))
      .catch(() => {});

    // GSAP Hero entrance
    if (heroHeadingRef.current && heroSubRef.current) {
      const ctx = gsap.context(() => {
        gsap.from(heroHeadingRef.current, {
          y: 24,
          opacity: 0,
          duration: 0.8,
          ease: "power3.out",
        });
        gsap.from(heroSubRef.current, {
          y: 16,
          opacity: 0,
          duration: 0.8,
          delay: 0.2,
          ease: "power3.out",
        });
      });
      return () => ctx.revert();
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const targetUrl = url.trim();

    try {
      const parsed = new URL(targetUrl);
      if (!/^https?:$/.test(parsed.protocol)) {
        throw new Error("Only HTTP and HTTPS URLs are supported");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter a valid public URL");
      return;
    }

    setBusy(true);
    setResult(null);

    try {
      const next = await analyzeUrl(targetUrl);
      setResult(next);
      setHistory((items) => [next, ...items.filter((item) => item.scan_id !== next.scan_id)].slice(0, 8));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inspection failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadHistoryList() {
    setError(null);
    try {
      setHistory(await fetchHistory());
    } catch {
      setError("Could not load inspection history");
    }
  }

  return (
    <main className="relative min-h-screen bg-vx-bg text-vx-text selection:bg-vx-accent selection:text-vx-bg overflow-x-hidden font-sans">
      {/* Dynamic WebGL Atmosphere Background */}
      <WebglBackdrop />

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Technical Header */}
        <header className="flex items-center justify-between border-b border-vx-border/80 pb-5 backdrop-blur-sm">
          <div className="flex items-center gap-3.5 font-mono">
            <img src="/logo.png" alt="VX Converter Logo" className="h-9 w-9 rounded-md object-cover ring-1 ring-vx-border" />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold tracking-[0.25em] text-vx-text">VX CONVERTER</p>
                <span className="rounded bg-vx-accent/10 px-1.5 py-0.5 text-[9px] font-bold text-vx-accent border border-vx-accent/30 tracking-widest">
                  ENGINE V4 VX
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-widest text-vx-dim">Universal Public Media Inspector</p>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px] text-vx-dim">
            <span className="hidden items-center gap-2 rounded-full border border-vx-border bg-vx-surface/80 px-3 py-1 sm:flex">
              <span className={`h-2 w-2 rounded-full ${health ? "bg-vx-emerald animate-pulse" : "bg-vx-dim"}`} />
              <span>{health?.engine || "ENGINE V4 VX"}</span>
              <span className="text-vx-dim/50">·</span>
              <span className="text-vx-text/90">{health?.status || "operational"}</span>
            </span>
          </div>
        </header>

        {/* Hero Section */}
        <section className="mx-auto max-w-3xl py-16 text-center sm:py-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-vx-border bg-vx-surface/90 px-3.5 py-1 font-mono text-xs text-vx-accent mb-6 shadow-sm">
            <Cpu className="w-3.5 h-3.5" />
            <span className="tracking-wider uppercase font-semibold">ENGINE_V4_VX // PUBLIC_MEDIA_SCRAPER</span>
          </div>

          <h1
            ref={heroHeadingRef}
            className="text-4xl font-semibold tracking-tight text-vx-text sm:text-6xl leading-[1.1]"
          >
            Find media hiding in <span className="text-vx-accent">plain sight</span>.
          </h1>

          <p
            ref={heroSubRef}
            className="mx-auto mt-5 max-w-xl text-sm sm:text-base leading-relaxed text-vx-dim"
          >
            Paste any public URL. Engine V4 VX inspects network streams, OpenGraph tags, HTML5 tags, and embedded player configs to deliver clean, validated media candidates.
          </p>

          {/* Inspection Form */}
          <motion.form
            onSubmit={submit}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="mt-9 flex flex-col gap-2.5 sm:flex-row shadow-2xl"
          >
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-vx-dim">
                <Search className="w-4 h-4" />
              </div>
              <input
                id="source-url"
                type="url"
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/video or YouTube / Vimeo / Reddit link..."
                disabled={busy}
                className="w-full rounded-lg border border-vx-border bg-vx-surface/90 pl-10 pr-4 py-3.5 font-mono text-sm text-vx-text outline-none placeholder:text-vx-dim/50 focus:border-vx-accent focus:ring-1 focus:ring-vx-accent transition-all shadow-inner"
              />
            </div>
            <button
              disabled={busy}
              type="submit"
              className="rounded-lg bg-vx-accent px-6 py-3.5 font-mono text-sm font-bold text-vx-bg transition-all hover:bg-vx-accent-hover active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 flex items-center justify-center gap-2 shadow-md shadow-vx-accent/20"
            >
              {busy ? (
                <>
                  <span className="w-4 h-4 border-2 border-vx-bg border-t-transparent rounded-full animate-spin" />
                  <span>Inspecting...</span>
                </>
              ) : (
                <>
                  <span>Inspect URL</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </motion.form>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="mt-4 p-3 rounded-lg border border-vx-red/30 bg-vx-red/10 text-left font-mono text-xs text-vx-red flex items-start gap-2"
            >
              <span className="select-none font-bold">&gt;</span>
              <span>{error}</span>
            </motion.div>
          )}

          {busy && <ScanLine />}
        </section>

        {/* Results Shelf */}
        <AnimatePresence mode="wait">
          {result && (
            <ResultShelf
              key={result.scan_id}
              result={result}
              onReset={() => setResult(null)}
            />
          )}
        </AnimatePresence>

        {/* Technical Capabilities Matrix */}
        <section className="mx-auto my-12 max-w-5xl border-t border-vx-border/80 pt-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-left">
            <div className="p-4 rounded-lg bg-vx-surface/60 border border-vx-border font-mono">
              <div className="flex items-center gap-2 text-vx-accent text-xs font-semibold uppercase mb-1">
                <Film className="w-3.5 h-3.5" />
                <span>Video Streams</span>
              </div>
              <p className="text-xs text-vx-dim leading-relaxed">
                Direct MP4, WebM, MOV, HLS (.m3u8), OpenGraph, and HTML5 video sources.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-vx-surface/60 border border-vx-border font-mono">
              <div className="flex items-center gap-2 text-vx-accent text-xs font-semibold uppercase mb-1">
                <Music className="w-3.5 h-3.5" />
                <span>Audio Extraction</span>
              </div>
              <p className="text-xs text-vx-dim leading-relaxed">
                MP3, AAC, M4A, OGG audio tracks with byte validation and range streaming.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-vx-surface/60 border border-vx-border font-mono">
              <div className="flex items-center gap-2 text-vx-accent text-xs font-semibold uppercase mb-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>SSRF Protection</span>
              </div>
              <p className="text-xs text-vx-dim leading-relaxed">
                Safe redirect tracing with private IP, loopback, and metadata endpoint blacklists.
              </p>
            </div>
          </div>
        </section>

        {/* Recent Inspections History */}
        <section className="mx-auto mt-8 max-w-5xl border-t border-vx-border/80 pt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-vx-dim">
              <History className="w-3.5 h-3.5" />
              <h2>Recent Inspections</h2>
            </div>
            <button
              onClick={loadHistoryList}
              className="font-mono text-xs text-vx-accent hover:underline hover:text-vx-text transition-colors"
            >
              [ Refresh History ]
            </button>
          </div>

          {history.length > 0 ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {history.map((item) => (
                <button
                  key={item.scan_id}
                  onClick={() => {
                    setUrl(item.source_url);
                    setResult(item);
                  }}
                  className="flex items-center justify-between gap-3 p-3 text-left rounded-lg border border-vx-border bg-vx-surface/80 hover:bg-vx-subtle hover:border-vx-border-light transition-all group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-vx-text group-hover:text-vx-accent transition-colors">
                      {item.source_url}
                    </p>
                    <p className="font-mono text-[10px] text-vx-dim mt-0.5">
                      {item.provider} · {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-vx-bg px-2 py-1 font-mono text-[11px] text-vx-dim border border-vx-border">
                    {item.media_count} media
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-6 rounded-lg border border-dashed border-vx-border text-center font-mono text-xs text-vx-dim/60">
              No recent inspections in current session. Paste a URL above to start.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
