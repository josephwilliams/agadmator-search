/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The search core and index.json live one level up, outside web/.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  // Force the data files into every API function bundle. The search core reads
  // them via readFileSync at runtime; this guarantees they're traced into both
  // /api/search and the /api/[transport] MCP route on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["../data/index.json", "../data/player-portraits.json"],
  },
};

export default nextConfig;
