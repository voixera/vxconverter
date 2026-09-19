import { NextResponse } from "next/server";
import { pushHistory } from "../../../lib/store";
import { engineV4 } from "../../../lib/engine-v4-vx";
import { ENGINE_NAME, ENGINE_VERSION, statusForCode, toStructuredError } from "../../../lib/engine-v4-vx/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/analyze
 *
 * Body: { url: string }
 * Runs the Engine V4 VX pipeline and returns normalized media candidates.
 * All failures are returned as structured JSON — never an uncaught 500/502.
 */
export async function POST(request: Request) {
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, engine: ENGINE_NAME, error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  if (typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json(
      { ok: false, engine: ENGINE_NAME, error: { code: "INVALID_URL", message: "A non-empty 'url' string is required" } },
      { status: 400 },
    );
  }

  try {
    const outcome = await engineV4.analyzeWithTrace(body.url);
    pushHistory(outcome.result);
    return NextResponse.json({ ok: true, engine: ENGINE_NAME, version: ENGINE_VERSION, data: outcome.result });
  } catch (err) {
    const { code, message } = toStructuredError(err);
    return NextResponse.json(
      { ok: false, engine: ENGINE_NAME, error: { code, message } },
      { status: statusForCode(code) },
    );
  }
}
