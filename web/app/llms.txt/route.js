import { siteUrl } from "../layout";

// Served at /llms.txt. Route handler (not a static file) so the site + MCP
// URLs are filled in from the deployed origin automatically.
export const dynamic = "force-static";

export function GET() {
  const body = `# agadmator search

> Full-text and structured search over ~5,000 chess games analysed on agadmator's YouTube channel. Query by player, opening, ECO code, year, and move-level features (queen sacrifices, smothered mates, underpromotions, and move-by-move filters). Available as a web UI, a JSON HTTP API, and a remote MCP server.

## Web UI
- [Search](${siteUrl}/): one search box plus filter chips; results link to the original YouTube videos.

## HTTP API
- [GET /api/search](${siteUrl}/api/search?q=tal+queen+sacrifice&limit=10): JSON search. Common params: q (free text), player, players (head-to-head), opening, openingFamily, eco, year, yearFrom, yearTo, result, queenSac, smotheredMate, backRankMate, underpromotion, miniature, moves (JSON move list), limit. Returns lean game summaries (id, title, players, opening, ECO, result, YouTube URL).

## MCP server (for AI agents)
- Endpoint: ${siteUrl}/api/mcp — Model Context Protocol over the Streamable HTTP transport.
- Tools:
  - search_games: free text combined with structured filters over the catalogue.
  - get_game: full detail for one game by its YouTube id (PGN, highlighted positions, result, move-level flags).

## Notes
- Fan-made project; not affiliated with agadmator. Data covers the public video archive only.
- Player portraits are Wikimedia Commons images under their own licenses.
`;

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
