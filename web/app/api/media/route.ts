import { NextResponse } from "next/server";
import { getMediaById } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "Missing 'id' query parameter" } },
      { status: 400 },
    );
  }
  const media = getMediaById(id);
  if (!media) {
    return NextResponse.json(
      { ok: false, error: { code: "MEDIA_NOT_FOUND", message: "Media not found" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, data: media });
}
