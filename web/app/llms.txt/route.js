import { siteUrl } from "../layout";

// Served at /llms.txt. Route handler (not a static file) so the site + MCP
// URLs are filled in from the deployed origin automatically.
export const dynamic = "force-static";

export function GET() {
  const body = `# agadmator search

> Full-text and structured search over ~5,000 chess games analysed on agadmator's YouTube channel. Query by player, opening, ECO code, year, and move-level features (queen sacrifices, smothered mates, underpromotions, and move-by-move filters). Available as a web UI and a remote MCP server. Open source.

## Web UI
- [Search](${siteUrl}/): one search box plus filter chips; results link to the original YouTube videos.

## For AI agents / developers
The catalogue is exposed via the Model Context Protocol (MCP) with two tools —
search_games (free text + structured filters) and get_game (full detail for one
game by YouTube id: PGN, positions, result, move-level flags).

- Run it locally (recommended, free): clone the repository below and run the
  stdio MCP server. Works with Claude Desktop / Claude Code at no cost.
- A hosted Streamable HTTP MCP endpoint exists but is private; open an issue on
  the GitHub repository below if you'd like access.

(The site's own /api/search endpoint is reserved for the web UI and is
origin-gated — not a public API.)

## Source
- Repository: https://github.com/josephwilliams/agadmator-search — open-source code for the web UI, the remote MCP server, and a local stdio MCP server (for Claude Desktop). Self-hostable; see the README and docs/REMOTE-MCP.md for setup and deployment.

## Notes
- Fan-made project; not affiliated with agadmator. Data covers the public video archive only.
- Player portraits are Wikimedia Commons images under their own licenses.
`;

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
