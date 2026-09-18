"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from "framer-motion";
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
  Zap,
  Globe,
  Layers,
} from "lucide-react";

// Magnetic button hook
function useMagnet(strength = 0.3) {
  const ref = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 20 });
  const sy = useSpring(y, { stiffness: 200, damping: 20 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function onMove(e: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      x.set((e.clientX - cx) * strength);
      y.set((e.clientY - cy) * strength);
    }
    function onLeave() {
      x.set(0);
      y.set(0);
    }
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [strength, x, y]);

  return { ref, sx, sy };
}

const SAMPLE_URLS = [
  { label: "Direct MP4", url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4" },
  { label: "YouTube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
];

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);

  const heroRef = useRef<HTMLDivElement>(null);
  const heroHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const heroSubRef = useRef<HTMLParagraphElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const { ref: btnRef, sx, sy } = useMagnet(0.25);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((p: { data?: HealthData }) => setHealth(p.data || null))
      .catch(() => setHealth(null));

    fetchHistory()
      .then((items) => setHistory(items.slice(0, 8)))
      .catch(() => {});

    // GSAP entrance animation
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(pillRef.current, { y: -16, opacity: 0, duration: 0.6 })
        .from(heroHeadingRef.current, { y: 24, opacity: 0, duration: 0.8 }, "-=0.3")
        .from(heroSubRef.current, { y: 16, opacity: 0, duration: 0.7 }, "-=0.5")
        .from(formRef.current, { y: 12, opacity: 0, duration: 0.6 }, "-=0.4");
    }, heroRef);

    return () => ctx.revert();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const targetUrl = url.trim();

    try {
      const parsed = new URL(targetUrl);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter a valid public URL");
      return;
    }

    setBusy(true);
    setResult(null);

    // GSAP button pulse on submit
    gsap.to(btnRef.current, { scale: 0.95, duration: 0.1, yoyo: true, repeat: 1 });

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

  return (
    <main className="relative min-h-screen bg-[#06060a] text-neutral-100 selection:bg-white selection:text-black overflow-x-hidden font-sans">
      {/* WebGL atmosphere */}
      <WebglBackdrop />

      {/* Radial glow top */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-white/[0.015] rounded-full blur-[120px]" />
        <div className="absolute inset-0 vx-grid-bg opacity-30" />
        {/* Subtle scanline overlay */}
        <div className="absolute inset-0 vx-scanlines pointer-events-none" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-4 py-6 sm:px-6">

        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center justify-between border-b border-white/[0.06] pb-5"
        >
          <div className="flex items-center gap-3 font-mono">
            <div className="relative">
              <img src="/logo.png" alt="VX" className="h-7 w-7 rounded object-cover filter grayscale" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-white/80 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tracking-[0.3em] text-white">VX CONVERTER</span>
                <span className="rounded-sm bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-bold text-white/50 border border-white/[0.08] tracking-widest">
                  V4 VX
                </span>
              </div>
              <p className="text-[9px] uppercase tracking-[0.2em] text-white/30 mt-0.5">Universal Media Inspector</p>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-[10px]">
            <span className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/[0.08] bg-white/[0.03]">
              <span className={`h-1.5 w-1.5 rounded-full ${health ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-white/20"} transition-all`} />
              <span className="text-white/50">{health ? "ENGINE ONLINE" : "CONNECTING..."}</span>
            </span>
          </div>
        </motion.header>

        {/* Hero */}
        <section ref={heroRef} className="mx-auto max-w-3xl py-20 text-center sm:py-28">

          {/* Index pill */}
          <div
            ref={pillRef}
            className="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] text-white/40 border border-white/[0.07] bg-white/[0.03] rounded-full mb-8 tracking-[0.2em] uppercase"
          >
            <span className="w-1 h-1 rounded-full bg-white/30" />
            <span>PUBLIC MEDIA SCANNER</span>
            <span className="text-white/20">·</span>
            <span className="text-white/60">ENGINE V4 VX</span>
          </div>

          <h1
            ref={heroHeadingRef}
            className="text-[2.75rem] sm:text-[4.5rem] font-semibold tracking-tight text-white leading-[1.05] mb-6"
          >
            Extract media{" "}
            <span className="relative inline-block">
              <span className="text-white/40 italic font-normal">hiding</span>
              <span className="absolute -bottom-1 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            </span>
            {" "}in plain sight.
          </h1>

          <p
            ref={heroSubRef}
            className="mx-auto max-w-lg text-sm leading-relaxed text-white/35 font-light"
          >
            Paste any public URL. Engine V4 VX resolves streams, OpenGraph tags, HTML5 sources,
            and platform configs into clean, validated, downloadable candidates.
          </p>

          {/* Search form */}
          <form ref={formRef} onSubmit={submit} className="mt-10 space-y-3">
            <div
              className={`relative flex flex-col sm:flex-row gap-0 rounded-2xl border transition-all duration-300 shadow-2xl overflow-hidden ${
                inputFocused
                  ? "border-white/20 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_60px_rgba(0,0,0,0.6)]"
                  : "border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
              } bg-white/[0.04] backdrop-blur-xl`}
            >
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-white/25">
                  <Search className="w-4 h-4" />
                </div>
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  placeholder="Paste URL — YouTube, Vimeo, Reddit, direct video..."
                  disabled={busy}
                  className="w-full bg-transparent pl-12 pr-5 py-4 font-mono text-sm text-white placeholder:text-white/20 outline-none"
                />
              </div>
              {/* Divider */}
              <div className="hidden sm:block w-px bg-white/[0.06] my-2" />

              <motion.button
                ref={btnRef}
                style={{ x: sx, y: sy }}
                disabled={busy}
                type="submit"
                className={`relative m-1.5 rounded-xl px-6 py-2.5 font-mono text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 shrink-0 overflow-hidden ${
                  busy
                    ? "bg-white/10 text-white/40 cursor-wait"
                    : "bg-white text-black hover:bg-white/90 active:scale-95"
                }`}
              >
                {/* Button shine */}
                {!busy && (
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full"
                    animate={{ x: ["−100%", "200%"] }}
                    transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                  />
                )}
                {busy ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white/70 rounded-full animate-spin" />
                    <span>Scanning...</span>
                  </>
                ) : (
                  <>
                    <span>Inspect</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </motion.button>
            </div>

            {/* Quick samples */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 font-mono text-[10px] text-white/30">
              <span className="uppercase tracking-wider">Try:</span>
              {SAMPLE_URLS.map(({ label, url: sUrl }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setUrl(sUrl)}
                  className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.07] hover:border-white/[0.15] hover:text-white/60 transition-all"
                >
                  {label}
                </button>
              ))}
            </div>
          </form>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                role="alert"
                className="mt-5 p-4 rounded-xl border border-red-500/20 bg-red-950/20 backdrop-blur text-left font-mono text-xs text-red-400 flex items-start gap-2.5"
              >
                <span className="mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <div>
                  <p className="text-red-300 font-semibold mb-0.5 uppercase tracking-wider text-[10px]">Scan Error</p>
                  <p className="text-red-400/80">{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {busy && <ScanLine />}
        </section>

        {/* Results */}
        <AnimatePresence mode="wait">
          {result && (
            <ResultShelf key={result.scan_id} result={result} onReset={() => setResult(null)} />
          )}
        </AnimatePresence>

        {/* Capabilities */}
        <section className="mx-auto my-16 max-w-5xl border-t border-white/[0.05] pt-12">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
              <Terminal className="w-3 h-3 text-white/50" />
              <span>Capabilities</span>
            </div>
            <span className="font-mono text-[9px] text-white/15">SYS_BUILD: 2026.09</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              {
                icon: Film,
                title: "Video Streams",
                desc: "MP4, WebM, HLS, MOV, QuickTime — all containers with magic-byte validation.",
              },
              {
                icon: Music,
                title: "Audio Extraction",
                desc: "MP3, AAC, M4A, OGG, FLAC — with binary signature verification.",
              },
              {
                icon: ShieldCheck,
                title: "SSRF Guard",
                desc: "Per-hop redirect tracing, private IP blocklists, metadata endpoint protection.",
              },
            ].map(({ icon: Icon, title, desc }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="vx-capability-card group p-5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] transition-all duration-300"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08]">
                    <Icon className="w-3.5 h-3.5 text-white/60 group-hover:text-white transition-colors" />
                  </div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-white/50 group-hover:text-white/70 transition-colors">
                    {title}
                  </span>
                </div>
                <p className="text-[11px] text-white/25 leading-relaxed font-light">{desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* History */}
        <section className="mx-auto mt-4 max-w-5xl border-t border-white/[0.05] pt-8 pb-16">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
              <History className="w-3 h-3" />
              <span>Inspection Archive</span>
            </div>
            <button
              onClick={async () => {
                try { setHistory(await fetchHistory()); } catch {}
              }}
              className="font-mono text-[10px] text-white/20 hover:text-white/50 transition-colors uppercase tracking-wider"
            >
              [ Refresh ]
            </button>
          </div>

          {history.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {history.map((item, i) => (
                <motion.button
                  key={item.scan_id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.04 }}
                  onClick={() => { setUrl(item.source_url); setResult(item); }}
                  className="flex items-center justify-between gap-3 p-3.5 text-left rounded-xl border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.1] transition-all group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] text-white/50 group-hover:text-white/80 transition-colors">
                      {item.source_url}
                    </p>
                    <p className="font-mono text-[9px] text-white/20 mt-0.5 uppercase tracking-wider">
                      {item.provider} · {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] text-white/30 border border-white/[0.06] group-hover:border-white/[0.12] group-hover:text-white/50 transition-all">
                    {item.media_count}×
                  </span>
                </motion.button>
              ))}
            </div>
          ) : (
            <div className="p-10 rounded-xl border border-dashed border-white/[0.06] text-center font-mono text-[11px] text-white/20">
              No recent inspections in session.
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="border-t border-white/[0.04] py-6 font-mono text-[9px] text-white/15 flex flex-wrap items-center justify-between gap-2 uppercase tracking-widest">
          <span>VX CONVERTER // ENGINE V4 VX</span>
          <span>STREAM_RELAY: ACTIVE · SSRF_GUARD: ON</span>
          <span>© 2026 VOIXERA RESEARCH</span>
        </footer>
      </div>
    </main>
  );
}
