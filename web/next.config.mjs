import { fileURLToPath } from "node:url";

// web/node_modules — the only place deps are installed on Vercel (Root
// Directory is web/). Shared code in ../src imports `zod`, but Node resolves
// that from /src upward and never looks inside web/node_modules. Adding this
// path to webpack's module search list lets ../src/* resolve web's deps.
const webNodeModules = fileURLToPath(new URL("./node_modules", import.meta.url));

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
  webpack: (config) => {
    config.resolve.modules = [webNodeModules, ...(config.resolve.modules || ["node_modules"])];
    return config;
  },
};

export default nextConfig;
