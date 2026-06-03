import { ImageResponse } from "next/og";

export const alt = "agadmator search — find any chess game from the channel";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Gold queen as a data URI so satori renders it as an <img> (it doesn't render
// raw inline SVG children reliably).
const queen = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="#e9b949">
    <circle cx="14" cy="21" r="3.4"/><circle cx="23" cy="17" r="3.8"/><circle cx="32" cy="14.5" r="4.2"/>
    <circle cx="41" cy="17" r="3.8"/><circle cx="50" cy="21" r="3.4"/>
    <path d="M14 21 L19 30 L23 17 L28 30 L32 14.5 L36 30 L41 17 L45 30 L50 21 L46 35 L18 35 Z"/>
    <rect x="17.5" y="36" width="29" height="4.2" rx="1.6"/>
    <path d="M19.5 41 L16.5 51.5 L47.5 51.5 L44.5 41 Z"/>
    <path d="M14.5 52 L49.5 52 L52.5 58.5 L11.5 58.5 Z"/>
  </g></svg>`,
)}`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#0f0f10",
          color: "#ececec",
          fontFamily: "monospace",
          padding: "80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={queen} width={120} height={120} alt="" />
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, letterSpacing: "-2px" }}>
            agadmator<span style={{ color: "#e9b949" }}>/</span>search
          </div>
        </div>
        <div style={{ marginTop: 36, fontSize: 32, color: "#8a8a8f", maxWidth: 900, lineHeight: 1.4 }}>
          Search ~5,000 games from agadmator's chess catalogue — players, openings,
          queen sacrifices, and more.
        </div>
        <div style={{ marginTop: 40, fontSize: 24, color: "#e9b949" }}>
          web UI · remote MCP server
        </div>
      </div>
    ),
    size,
  );
}
