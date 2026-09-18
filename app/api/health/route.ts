import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    data: {
      status: "operational",
      version: "4.0.0",
      engine: "Engine V4 VX",
      uptime_secs: Math.floor(process.uptime()),
    },
  });
}
