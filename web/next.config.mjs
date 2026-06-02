/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The search core and index.json live one level up, outside web/.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
};

export default nextConfig;
