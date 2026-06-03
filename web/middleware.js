import { NextResponse } from "next/server";

// Cheap origin gate for /api/search: it's an internal endpoint for this site's
// own UI, so reject requests that are positively cross-origin. Lenient on the
// ambiguous case (no Sec-Fetch metadata and no Origin — e.g. older browsers)
// to avoid blocking real users; the PoW check is the stronger gate behind it.
// /api/mcp is intentionally NOT matched — agents are cross-origin by nature.
export const config = { matcher: "/api/search" };

function forbidden() {
  return new NextResponse(JSON.stringify({ error: "forbidden" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

export function middleware(req) {
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "cross-origin") return forbidden();

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get("host")) return forbidden();
    } catch {
      return forbidden();
    }
  }
  return NextResponse.next();
}
