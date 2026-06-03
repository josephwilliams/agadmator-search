// Lightweight in-memory sliding-window rate limiter. Zero dependencies, runs on
// the Node.js runtime alongside the API routes. Sheds bursts cheaply (returns
// 429 before doing expensive search work), protecting CPU and cost during a
// traffic spike.
//
// Scope note: state is per warm serverless instance, so under Fluid Compute the
// effective global limit is (per-instance limit × live instances). That's
// intentional — it caps any single client from pegging an instance without
// needing a database. For a strict global cap, enable Vercel WAF rate rules
// (dashboard) or swap in Upstash Ratelimit (needs Redis); see docs/REMOTE-MCP.md.

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 10_000);
const MAX = Number(process.env.RATE_LIMIT_MAX || 120);

/** @type {Map<string, number[]>} ip → recent request timestamps */
const hits = new Map();

function clientIp(req) {
  const h = req.headers;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") || "unknown";
}

/**
 * Returns a 429 Response if the caller is over the limit, otherwise null.
 * @param {Request} req
 * @returns {Response | null}
 */
export function rateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  // Opportunistic cleanup so the map can't grow unbounded across many IPs.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
    }
  }

  if (recent.length > MAX) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(Math.max(1, retryAfter)),
      },
    });
  }
  return null;
}
