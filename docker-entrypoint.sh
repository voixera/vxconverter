#!/bin/sh
# Container entrypoint: keep yt-dlp current (YouTube breaks old versions), then
# start the Next.js production server.
set -e

if [ "${VX_UPDATE_YTDLP_ON_START:-1}" = "1" ]; then
  echo "[vx] updating yt-dlp ..."
  yt-dlp --update-to stable >/dev/null 2>&1 || pip3 install --no-cache-dir --break-system-packages -U yt-dlp >/dev/null 2>&1 || true
  yt-dlp --version 2>/dev/null && echo "[vx] yt-dlp ready"
fi

echo "[vx] ffmpeg: $(ffmpeg -version 2>/dev/null | head -n1 || echo 'not found')"
echo "[vx] starting server on :${PORT:-3000}"

exec npx next start -p "${PORT:-3000}" -H 0.0.0.0
