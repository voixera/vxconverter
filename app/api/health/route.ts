import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    data: { status: "operational", version: "0.1.0", engine: "VX Core", uptime_secs: 0 },
  });
}
