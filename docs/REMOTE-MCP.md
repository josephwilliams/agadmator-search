# Remote MCP server (Streamable HTTP on Vercel)

The agadmator catalogue is exposed two ways from one shared tool definition
(`src/tools.js`), so local and remote expose **identical** tools:

| Transport | Entry point | Use |
|---|---|---|
| **stdio** | `src/server.js` (`npm start`) | Local dev, Claude Desktop |
| **Streamable HTTP** | `web/app/api/[transport]/route.js` | Remote MCP clients, browser MCP UIs |

Both call the same `searchGames` / `getGame` core over `data/index.json`. No
network, no API key.

## Endpoint

After deploying the `web/` app to Vercel:

```
https://<your-app>.vercel.app/api/mcp
```

`POST` here speaks the modern MCP **Streamable HTTP** transport. The route runs
on the Node.js runtime (the search core reads `data/index.json` from disk) and
is **stateless** by default — no database required.

## Deploy steps

The remote server is just a route inside the existing `web/` Next.js app, so it
ships with your frontend — no separate project, no extra cost.

1. Commit the changes:
   ```bash
   git add src/tools.js src/server.js web/
   git commit -m "Add remote MCP Streamable HTTP endpoint"
   git push
   ```
2. Deploy `web/` to Vercel (first time):
   ```bash
   cd web
   npx vercel        # preview
   npx vercel --prod # production
   ```
   If the project is already linked to Vercel, a `git push` to the production
   branch deploys automatically.
3. That's it. The data file (`data/index.json`, 8.3 MB) is traced into the
   function bundle automatically — see `outputFileTracingIncludes` in
   `web/next.config.mjs`. No storage service needed.

> **Vercel project root.** The Vercel project's Root Directory must be `web/`
> (the `vercel.json` and `next.config.mjs` there drive the build). The data
> files live one level up and are pulled in via `outputFileTracingRoot: ".."`
> plus the explicit `outputFileTracingIncludes` entry.

## Verify the deployment

Point any MCP client at `https://<your-app>.vercel.app/api/mcp`. A quick script
using the official SDK (run from a dir where `@modelcontextprotocol/sdk` is
installed, e.g. `web/`):

```js
// verify.mjs — node verify.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL("https://<your-app>.vercel.app/api/mcp");
const client = new Client({ name: "verify", version: "0" });
await client.connect(new StreamableHTTPClientTransport(url));

console.log((await client.listTools()).tools.map((t) => t.name));
// → [ 'search_games', 'get_game' ]

const s = await client.callTool({
  name: "search_games",
  arguments: { query: "tal queen sacrifice", limit: 2 },
});
const results = JSON.parse(s.content[0].text);
console.log(results[0].title, results[0].id);

const g = await client.callTool({
  name: "get_game",
  arguments: { id: results[0].id },
});
console.log(JSON.parse(g.content[0].text).pgn.slice(0, 60));
await client.close();
```

Or use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP
# URL: https://<your-app>.vercel.app/api/mcp
```

## Wiring it into a browser MCP UI

Browser MCP clients use the same Streamable HTTP URL. If your UI runs on a
different origin than the API, add CORS headers (Vercel: `headers()` in
`next.config.mjs`, or middleware) allowing your frontend origin. Same-origin
(UI and `/api/mcp` on the same Vercel app) needs nothing extra.

## Tradeoffs & limitations

- **Cold-start parse.** A fresh serverless instance parses the 8.3 MB index
  once (~100–300 ms) before the first tool call; warm requests reuse the
  in-memory array and are instant. Fluid Compute (default on Vercel Pro) keeps
  instances warm and shares the parsed index across concurrent requests, so
  this is rarely felt. A periodic keep-warm ping eliminates it if needed.
- **Stateless by default.** No server-initiated streaming / progress
  notifications / resumable sessions. Fine for these two request→response
  tools. To enable them, add Redis (see below) — the SSE transport then turns
  on automatically.
- **Not Edge.** The search core uses `node:fs`/`node:path`, so the route runs
  on the Node.js runtime, not the Edge runtime. (This is also why Cloudflare
  Workers was not chosen — it would require rewriting the data loader off `fs`,
  bundling 8.3 MB against Worker size/CPU limits, and Durable Objects for
  sessions.)

## Optional: stateful sessions + SSE via Redis (free tier)

The route auto-detects `REDIS_URL` / `KV_URL`. With one present it enables the
SSE transport and cross-instance session resumption — **no code change**:

1. Add the **Upstash** integration from the Vercel Marketplace (free tier:
   ~256 MB / 500K commands/mo — far more than MCP session storage needs). It
   sets `REDIS_URL`/`KV_URL` on the project automatically.
2. Redeploy. The route now serves `/api/sse` + `/api/message` in addition to
   `/api/mcp`.

> Redis adds *session state*, not speed. It does **not** reduce the cold-start
> index parse — the search always runs in-process against the in-memory array.

## Local development

- stdio (unchanged): `npm start`
- HTTP locally: `cd web && npm run dev`, then the endpoint is
  `http://localhost:3939/api/mcp`.
