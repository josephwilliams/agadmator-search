import "./globals.css";

// Production origin: explicit env wins; otherwise Vercel's auto-provided prod
// URL; otherwise localhost for dev. Used as the base for canonical/OG/sitemap.
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3939");

const title = "agadmator search — find any chess game from the channel";
const description =
  "Search ~5,000 games from agadmator's YouTube chess catalogue by player, opening, ECO, year, and move-level filters like queen sacrifices, smothered mates, and underpromotions. Also available as a remote MCP server.";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s · agadmator search",
  },
  description,
  applicationName: "agadmator search",
  keywords: [
    "agadmator",
    "chess",
    "chess search",
    "chess games",
    "queen sacrifice",
    "chess openings",
    "ECO codes",
    "Sicilian Najdorf",
    "chess video",
    "MCP server",
  ],
  authors: [{ name: "agadmator search" }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "agadmator search",
    url: siteUrl,
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  category: "chess",
};

export const viewport = {
  themeColor: "#0f0f10",
  colorScheme: "dark",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
