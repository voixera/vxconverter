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
  ArrowRight,
  Terminal,
  History,
  Check,
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
      .then((items) => setHistory(items.slice(0, 8)))
      .catch(() => {});

    if (heroHeadingRef.current && heroSubRef.current) {
      const ctx = gsap.context(() => {
        gsap.from(heroHeadingRef.current, {
          y: 28,
          opacity: 0,
          duration: 0.9,
          ease: "power3.out",
        });
        gsap.from(heroSubRef.current, {
          y: 16,
          opacity: 0,
          duration: 0.8,
          delay: 0.15,
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

  const loadSample = (sampleUrl: string) => {
    setUrl(sampleUrl);
  };

  return (
    <main className="relative min-h-screen bg-black text-neutral-100 selection:bg-white selection:text-black overflow-x-hidden font-sans">
      {/* 1. Full-Screen Atmospheric Background Image from Top to Bottom */}
      <div className="fixed inset-0 w-full h-full pointer-events-none z-0 overflow-hidden">
        <img
          src="/hero-visual.jpg"
          alt=""
          className="w-full h-full object-cover filter grayscale contrast-125 brightness-[0.20] scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/60 to-black/95" />
        <div className="absolute inset-0 vx-grid-bg opacity-40" />
      </div>

      {/* 2. WebGL Dynamic Monochrome Atmosphere */}
      <WebglBackdrop />

      <div className="relative z-10 mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* Minimalist Monochromatic Header */}
        <header className="flex items-center justify-between border-b border-neutral-800/80 pb-5 backdrop-blur-md">
          <div className="flex items-center gap-3 font-mono">
            <img src="/logo.png" alt="VX Converter Logo" className="h-8 w-8 rounded object-cover filter grayscale ring-1 ring-neutral-700" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-[0.25em] text-white">VX CONVERTER</span>
                <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[9px] font-bold text-neutral-300 border border-neutral-700 tracking-widest">
                  ENGINE V4 VX
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-widest text-neutral-500">Universal Public Media Inspector</p>
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono text-[11px] text-neutral-400">
            <span className="hidden items-center gap-2 rounded border border-neutral-800 bg-neutral-950/80 px-3 py-1 sm:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${health ? "bg-white animate-pulse" : "bg-neutral-600"}`} />
              <span>{health?.engine || "ENGINE V4 VX"}</span>
              <span className="text-neutral-600">·</span>
              <span className="text-neutral-300 font-medium">{health?.status || "operational"}</span>
            </span>
          </div>
        </header>

        {/* Clean Centered Hero Section */}
        <section className="mx-auto max-w-3xl py-20 text-center sm:py-28">
          <div className="inline-flex items-center gap-2 px-3 py-1 font-mono text-[11px] text-neutral-400 border border-neutral-800 bg-neutral-950/80 rounded mb-6 tracking-widest uppercase">
            <span>INDEX // 01</span>
            <span className="text-neutral-600">·</span>
            <span className="text-neutral-200">PUBLIC MEDIA SCANNER</span>
          </div>

          <h1
            ref={heroHeadingRef}
            className="text-4xl font-semibold tracking-tight text-white sm:text-6xl sm:leading-[1.1]"
          >
            Find media hiding in <span className="italic font-normal text-neutral-300">plain sight</span>.
          </h1>

          <p
            ref={heroSubRef}
            className="mx-auto mt-6 max-w-xl text-sm sm:text-base leading-relaxed text-neutral-400"
          >
            Paste any public page URL. Engine V4 VX inspects network streams, OpenGraph tags, HTML5 tags, and embedded player configs to deliver clean, validated media candidates.
          </p>

          {/* Centered High-Contrast Search & Inspection Form */}
          <form onSubmit={submit} className="mt-10 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2 p-1.5 rounded-xl bg-neutral-950/90 backdrop-blur-md border border-neutral-800 shadow-2xl">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-neutral-500">
                  <Search className="w-4 h-4" />
                </div>
                <input
                  id="source-url"
                  type="url"
                  required
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="Paste public media or webpage URL (e.g. YouTube, direct video, Vimeo)..."
                  disabled={busy}
                  className="w-full bg-transparent pl-11 pr-4 py-3 font-mono text-sm text-white outline-none placeholder:text-neutral-500 focus:ring-0 transition-all"
                />
              </div>

              <button
                disabled={busy}
                type="submit"
                className="rounded-lg bg-white px-6 py-3 font-mono text-sm font-bold text-black transition-all hover:bg-neutral-200 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 flex items-center justify-center gap-2 shrink-0 shadow"
              >
                {busy ? (
                  <>
                    <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    <span>Inspecting...</span>
                  </>
                ) : (
                  <>
                    <span>Inspect URL</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            {/* Quick Test Samples */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 font-mono text-[11px] text-neutral-400">
              <span className="text-neutral-600 uppercase tracking-wider">Quick test:</span>
              <button
                type="button"
                onClick={() => loadSample("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4")}
                className="px-2.5 py-0.5 rounded bg-neutral-950 border border-neutral-800 hover:border-neutral-600 hover:text-white transition-colors"
              >
                Direct MP4
              </button>
              <button
                type="button"
                onClick={() => loadSample("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}
                className="px-2.5 py-0.5 rounded bg-neutral-950 border border-neutral-800 hover:border-neutral-600 hover:text-white transition-colors"
              >
                YouTube Video
              </button>
            </div>
          </form>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="mt-5 p-3.5 rounded-lg border border-red-500/30 bg-red-950/20 text-left font-mono text-xs text-red-400 flex items-start gap-2"
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
        <section className="mx-auto my-14 max-w-5xl border-t border-neutral-800/80 pt-10">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-neutral-400">
              <Terminal className="w-3.5 h-3.5 text-white" />
              <h2>Engine V4 VX Capabilities</h2>
            </div>
            <span className="font-mono text-[10px] text-neutral-600">SYS_BUILD: 2026.09</span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-left">
            <div className="p-5 rounded-lg bg-neutral-950/80 backdrop-blur border border-neutral-800 font-mono vx-corner-mark">
              <div className="flex items-center gap-2 text-white text-xs font-semibold uppercase mb-1.5">
                <Film className="w-4 h-4" />
                <span>Universal Video Streams</span>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Direct MP4, WebM, QuickTime MOV, HLS (.m3u8), OpenGraph, and HTML5 video sources.
              </p>
            </div>

            <div className="p-5 rounded-lg bg-neutral-950/80 backdrop-blur border border-neutral-800 font-mono vx-corner-mark">
              <div className="flex items-center gap-2 text-white text-xs font-semibold uppercase mb-1.5">
                <Music className="w-4 h-4" />
                <span>Audio Extraction</span>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                MP3, AAC, M4A, OGG tracks with binary signature validation and HTTP range streaming.
              </p>
            </div>

            <div className="p-5 rounded-lg bg-neutral-950/80 backdrop-blur border border-neutral-800 font-mono vx-corner-mark">
              <div className="flex items-center gap-2 text-white text-xs font-semibold uppercase mb-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>SSRF & Redirect Guard</span>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Per-hop redirect tracing with private IP, loopback, and metadata endpoint blacklists.
              </p>
            </div>
          </div>
        </section>

        {/* Recent Inspections Archive */}
        <section className="mx-auto mt-10 max-w-5xl border-t border-neutral-800/80 pt-8 pb-12">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-neutral-400">
              <History className="w-3.5 h-3.5" />
              <h2>Inspection Archive</h2>
            </div>
            <button
              onClick={loadHistoryList}
              className="font-mono text-xs text-neutral-300 hover:underline hover:text-white transition-colors"
            >
              [ Refresh Archive ]
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
                  className="flex items-center justify-between gap-3 p-3.5 text-left rounded-lg border border-neutral-800 bg-neutral-950/80 hover:bg-neutral-900 hover:border-neutral-700 transition-all group shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-neutral-200 group-hover:text-white transition-colors">
                      {item.source_url}
                    </p>
                    <p className="font-mono text-[10px] text-neutral-500 mt-0.5">
                      {item.provider} · {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-black px-2.5 py-1 font-mono text-[11px] text-neutral-400 border border-neutral-800 group-hover:border-neutral-700">
                    {item.media_count} media
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-8 rounded-lg border border-dashed border-neutral-800 text-center font-mono text-xs text-neutral-500">
              No recent inspections in current session. Paste a URL above to start.
            </div>
          )}
        </section>

        {/* Technical Footer */}
        <footer className="border-t border-neutral-800/80 py-6 text-center font-mono text-[10px] text-neutral-500 flex flex-wrap items-center justify-between gap-2">
          <span>VX CONVERTER // ENGINE V4 VX</span>
          <span>PROTOCOL: HTTPS/2 · STREAM_RELAY: ACTIVE</span>
          <span>© 2026 VOIXERA RESEARCH</span>
        </footer>
      </div>
    </main>
  );
}
