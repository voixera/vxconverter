# syntax=docker/dockerfile:1
#
# VX Converter - full-stack image with the real Engine V4 VX toolchain.
#
# This image installs the native tools the engine shells out to (yt-dlp, ffmpeg)
# so platform extraction (YouTube, TikTok, Vimeo, ...) and conversions actually
# work. Run it on a VPS / Railway / Render / Fly.io / Docker host with a
# non-datacenter IP that upstream sites do not bot-block.
#
#   docker build -t vxconverter .
#   docker run -p 3000:3000 vxconverter
#
FROM node:20-bookworm-slim AS base

# --- System deps: ffmpeg (conversion) + python (for yt-dlp) ---
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python3-pip \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# --- yt-dlp: prefer the self-contained binary (no Python runtime needed) ---
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && yt-dlp --version \
    && ffmpeg -version | head -n 1

WORKDIR /app

# --- Install Node deps (cached layer). devDeps are required to build. ---
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# --- App source ---
COPY . .

# Build the Next.js app (typecheck + compile happen here).
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
# Point the engine at the installed binaries explicitly.
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg
# Refresh yt-dlp on container start (YouTube breaks stale versions quickly).
ENV VX_UPDATE_YTDLP_ON_START=1

EXPOSE 3000

RUN chmod +x /app/docker-entrypoint.sh

# next start binds to 0.0.0.0 so the container port is reachable.
CMD ["/app/docker-entrypoint.sh"]
