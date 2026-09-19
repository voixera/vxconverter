# VX Converter - Deployment

VX Converter is split into two parts:

| Part | Role | Where it runs |
| --- | --- | --- |
| **Front-end** (Next.js UI) | Search UI, calls the API | Vercel (`vxconverter.vercel.app`) |
| **Backend API** (`/api/*`) | Engine V4 VX: extraction, download, conversion | **Your own Docker/VPS host** |

## Why a separate backend?

The engine needs native tools and a normal (non-datacenter) egress IP:

- **`yt-dlp`** to resolve YouTube / TikTok / Vimeo / Reddit / etc.
- **`ffmpeg`** for real audio/video conversion.

Vercel's serverless functions **cannot** run these reliably:

- No `yt-dlp` / `ffmpeg` binaries (and a 250 MB bundle limit).
- Datacenter IPs are **bot-blocked** by YouTube and most media CDNs — this is
  why links returned `403` / `UNSUPPORTED_SOURCE` on Vercel.

Running the backend on a Docker host (VPS, Railway, Render, Fly.io, …) fixes all
of the above. The provided `Dockerfile` installs the latest `yt-dlp` + `ffmpeg`.

## 1. Run the backend (Docker host)

```bash
# On your VPS / Docker host
git clone <this-repo>
cd vxconverter
docker compose up -d --build
```

The API is now live at `http://<host>:3000/api/*`.

Verify:

```bash
curl http://<host>:3000/api/health
# -> { "ok": true, "data": { "capabilities": { "ffmpeg": true, "ytdlp": true, ... } } }
```

> Put it behind HTTPS (Caddy/Nginx/Traefik) or a platform-provided domain,
> e.g. `https://api.your-domain.com`.

### Keeping yt-dlp current

YouTube breaks old `yt-dlp` versions within weeks. The container runs
`yt-dlp --update-to stable` on every start (`VX_UPDATE_YTDLP_ON_START=1`, default).
Restart the container anytime to refresh, or set the env var to `0` to disable.

## 2. Point the Vercel front-end at the backend

In **Vercel → Project → Settings → Environment Variables**, add:

```
VX_API_BASE = https://api.your-domain.com
```

`next.config.mjs` rewrites every `/api/*` request from the Vercel front-end to
that backend, so no front-end code changes are needed. Redeploy Vercel.

If `VX_API_BASE` is **empty**, the Vercel deployment serves its own `/api/*`
routes — which only work for **direct media URLs and simple HTML pages**
(see "Serverless limits" below).

## 3. (Alternative) Run everything on the Docker host

If you prefer to skip Vercel entirely, the same image serves the UI **and** the
API. Just visit `http://<host>:3000/`. Leave `VX_API_BASE` unset.

## Serverless limits (why some links need the backend)

| Source | Vercel only | With Docker backend |
| --- | --- | --- |
| Direct public `mp4`/`webm`/`mp3` | ✅ | ✅ |
| Public HLS (`m3u8`) | ✅ (if CDN allows server IP) | ✅ |
| HTML pages with `<video>`/og/JSON-LD | ✅ | ✅ |
| YouTube | ❌ (no yt-dlp, IP blocked) | ✅ |
| TikTok / Vimeo / Reddit / etc. | ❌ | ✅ |
| MP3 / MP4 conversion | ❌ (no ffmpeg) | ✅ |

## Useful environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `VX_API_BASE` | Vercel | Backend URL to proxy `/api/*` to. |
| `YTDLP_PATH` | Backend | Explicit `yt-dlp` path (default: on `PATH`). |
| `FFMPEG_PATH` | Backend | Explicit `ffmpeg` path (default: on `PATH`). |
| `VX_UPDATE_YTDLP_ON_START` | Backend | `1` (default) to refresh yt-dlp on boot. |
| `HTTP_PROXY` / `HTTPS_PROXY` | Backend | Optional egress proxy for yt-dlp. |
| `PORT` | Backend | Server port (default `3000`). |
