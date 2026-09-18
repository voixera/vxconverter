import { NextResponse } from "next/server";

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

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "ENGINE_UNAVAILABLE",
        message: "Media engine is unavailable. Try again after deployment finishes.",
      },
    },
    { status: 503 },
  );
}
