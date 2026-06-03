// Remote MCP endpoint (Streamable HTTP) for the agadmator catalogue.
//
// Endpoint after deploy:  https://<your-app>.vercel.app/api/mcp
//
// The [transport] dynamic segment + basePath "/api" makes mcp-handler serve:
//   - /api/mcp                  Streamable HTTP (modern MCP transport)
//   - /api/sse + /api/message   legacy SSE (only when a Redis URL is present)
//
// Tools come from the SAME src/tools.js the stdio server uses, so the remote
// server exposes search_games and get_game identically to local.
//
// Stateless by default (no Redis needed). If REDIS_URL or KV_URL is set
// (e.g. after adding the Upstash integration on Vercel), mcp-handler picks it
// up automatically and the SSE transport + resumable sessions light up — no
// code change required.

import { createMcpHandler } from "mcp-handler";
import { registerTools } from "../../../../src/tools.js";
import { load } from "../../../../src/search.js";
import { rateLimit } from "../../../lib/ratelimit.js";

// The search core reads data/index.json from disk → Node runtime, not Edge.
export const runtime = "nodejs";
// Vercel function ceiling. Searches are in-memory and fast; this is headroom.
export const maxDuration = 60;

// Warm the index at module load so the first tool call isn't slowed by the
// initial JSON.parse on a cold instance.
load();

const hasRedis = Boolean(process.env.REDIS_URL || process.env.KV_URL);

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  { serverInfo: { name: "agadmator-mcp", version: "0.1.0" } },
  {
    basePath: "/api",
    maxDuration: 60,
    // SSE requires Redis to coordinate sessions across serverless invocations.
    // Disable it when no Redis is configured so the route stays purely
    // stateless Streamable HTTP.
    disableSse: !hasRedis,
  },
);

// Optional bearer-token gate. Opt-in: with MCP_API_TOKEN unset the endpoint
// stays public; set it (a random secret you generate and hand to authorized
// agents out-of-band) to require `Authorization: Bearer <token>`. This token
// lives only in env + agent configs — never in the browser/frontend.
const MCP_TOKEN = process.env.MCP_API_TOKEN || "";

function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
  });
}

// Shed bursts and check auth before touching the MCP handler.
async function limited(req) {
  const rl = rateLimit(req);
  if (rl) return rl;
  if (MCP_TOKEN) {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== MCP_TOKEN) return unauthorized();
  }
  return handler(req);
}

export { limited as GET, limited as POST, limited as DELETE };
