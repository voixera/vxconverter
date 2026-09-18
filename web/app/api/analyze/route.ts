import { NextResponse } from "next/server";
import { pushHistory } from "../../../lib/store";
import { engineV4 } from "../../../lib/engine-v4-vx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { url?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  if (typeof body.url !== "string" || !/^https?:\/\//i.test(body.url.trim())) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_URL", message: "Only HTTP and HTTPS URLs are supported" } },
      { status: 400 },
    );
  }

  try {
    const result = await engineV4.analyze(body.url);
    pushHistory(result);
    return NextResponse.json({ ok: true, data: result });
  } catch (error: any) {
    const code = error?.code || "UPSTREAM_ERROR";
    const message = error?.message || "Could not inspect source URL";
    const status =
      code === "INVALID_URL"
        ? 400
        : code === "SSRF_BLOCKED"
          ? 403
          : code === "MEDIA_NOT_FOUND"
            ? 404
            : 502;

    return NextResponse.json({ ok: false, error: { code, message } }, { status });
  }
}
