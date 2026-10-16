import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe for CI/Playwright. Never cached (see SW + next.config headers). */
export function GET() {
  return NextResponse.json(
    { status: "ok", buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
