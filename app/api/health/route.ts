import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const START = Date.now();

export async function GET() {
  return NextResponse.json({
    ok: true,
    data: {
      status: "ok",
      version: "4.0.0-vx",
      engine: "Engine V4 VX (TypeScript)",
      uptime_secs: Math.floor((Date.now() - START) / 1000),
    },
  });
}
