"use client";

import { useEffect, useState } from "react";

const PLACEHOLDERS = [
  "Magnus wins with black in the Sicilian",
  "women queen trap",
  "super GMs blunder",
  "Pragg against the Sicilian",
  "forks pins skewers",
  "world champions queen sac",
  "less than 18 moves",
  "latest short videos",
  "or moves: 1.e4 c5 2.Nf3",
];

const TOGGLES = [
  { key: "queenSac", label: "♛ queen sac" },
  { key: "smotheredMate", label: "♚ smothered mate" },
  { key: "queenTrap", label: "queen trap" },
  { key: "women", label: "women" },
  { key: "superGm", label: "super GM" },
  { key: "worldChampion", label: "world champ" },
  { key: "openingTrap", param: "phase", value: "opening trap", label: "opening trap" },
  { key: "blitz", param: "format", value: "blitz", label: "blitz" },
  { key: "prodigy", param: "playerStory", value: "prodigy", label: "prodigy" },
  { key: "underpromotion", label: "underpromotion" },
  { key: "miniature", label: "miniature ≤25" },
];

const PRESETS = [
  { label: "1.b4", text: "1.b4" },
  { label: "Najdorf", text: "1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6" },
];

// Parse PGN-style movetext ("1.b3", "1.e4 c5 2.Nf3") into [{n, side, san}].
function parseMoveText(s) {
  if (!s.trim()) return [];
  const toks = s
    .replace(/(\d+)\.(\.\.)?/g, " $1.$2 ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  let n = 1, side = "w";
  for (const t of toks) {
    const mm = t.match(/^(\d+)\.(\.\.)?$/);
    if (mm) {
      n = +mm[1];
      side = mm[2] ? "b" : "w";
      continue;
    }
    out.push({ n, side, san: t.replace(/[+#!?]/g, "") });
    side = side === "w" ? "b" : "w";
    if (side === "w") n++;
  }
  return out;
}

export default function Home() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState({});
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [placeholderVisible, setPlaceholderVisible] = useState(true);

  function toggle(k) {
    setActive((a) => ({ ...a, [k]: !a[k] }));
  }

  function reset() {
    setQ("");
    setActive({});
  }

  const hasState = q.trim() !== "" || Object.values(active).some(Boolean);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduceMotion) return;
    let timeout = null;
    const interval = setInterval(() => {
      setPlaceholderVisible(false);
      timeout = setTimeout(() => {
        setPlaceholderIndex((i) => (i + 1) % PLACEHOLDERS.length);
        setPlaceholderVisible(true);
      }, 180);
    }, 3200);
    return () => {
      clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    // One box, two modes: movetext like "1.b3" / "1.e4 c5" is detected and sent
    // as a move filter; anything else is free text.
    const trimmed = q.trim();
    const isMoveQuery = /\d+\.\s*[KQRBNOa-h]/.test(trimmed);
    if (isMoveQuery) {
      const moves = parseMoveText(trimmed);
      if (moves.length) params.set("moves", JSON.stringify(moves));
    } else if (trimmed) {
      params.set("q", trimmed);
    }
    if (active.queenSac) params.set("queenSac", "1");
    if (active.smotheredMate) params.set("smotheredMate", "1");
    if (active.queenTrap) params.set("queenTrap", "1");
    if (active.women) params.set("women", "1");
    if (active.superGm) params.set("superGm", "1");
    if (active.worldChampion) params.set("worldChampion", "1");
    if (active.underpromotion) params.set("underpromotion", "1");
    if (active.miniature) params.set("maxMoves", "25");
    const semanticTags = TOGGLES.filter((t) => active[t.key] && t.value).map((t) =>
      t.param ? `${t.param}:${t.value}` : t.value
    );
    if (semanticTags.length) params.set("tags", semanticTags.join(","));

    if (![...params.keys()].length) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      fetch("/api/search?" + params.toString())
        .then((r) => r.json())
        .then((data) => setResults(data))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q, active]);

  return (
    <main className="main" style={S.main}>
      <header style={S.header}>
        <h1 style={S.h1}>
          agadmator<span style={{ color: "var(--accent)" }}>/</span>search
        </h1>
        <p style={S.sub}>
          Search ~5,000 games from{" "}
          <a
            href="https://www.youtube.com/@agadmator"
            target="_blank"
            rel="noreferrer"
            style={S.subLink}
          >
            agadmator's YouTube channel
          </a>
        </p>
      </header>

      <div style={S.inputWrap}>
        <input
          autoFocus
          aria-label="Search agadmator games"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...S.input, paddingRight: 44 }}
        />
        {!q && (
          <span
            aria-hidden="true"
            style={{
              ...S.placeholder,
              opacity: placeholderVisible ? 1 : 0,
              transform: placeholderVisible ? "translateY(-50%)" : "translateY(-46%)",
            }}
          >
            {PLACEHOLDERS[placeholderIndex]}
          </span>
        )}
        {hasState && (
          <button
            onClick={reset}
            aria-label="Clear search and filters"
            title="Clear"
            style={S.clearBtn}
          >
            ×
          </button>
        )}
      </div>

      <div style={S.chips}>
        {TOGGLES.map((t) => (
          <button
            key={t.key}
            onClick={() => toggle(t.key)}
            style={{ ...S.chip, ...(active[t.key] ? S.chipOn : {}) }}
          >
            {t.label}
          </button>
        ))}
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => setQ(p.text)} style={S.chip}>
            {p.label}
          </button>
        ))}
      </div>

      <div style={S.meta}>
        {loading ? "searching…" : results.length ? `${results.length} results` : "type or pick a filter"}
      </div>

      <ul style={S.list}>
        {results.map((g) => (
          <li key={g.id} className="result-card" style={S.card}>
            <a
              className="result-card-link"
              href={g.url}
              target="_blank"
              rel="noreferrer"
              style={S.cardLink}
            >
              <div style={S.row}>
                <div style={S.heads} aria-hidden="true">
                  {["white", "black"].map((side) => {
                    const name = g[side];
                    const portrait = g.portraits?.[side];
                    return portrait?.portraitUrl ? (
                      <img
                        key={side}
                        src={portrait.portraitUrl}
                        alt=""
                        title={`${name} · ${portrait.license || "Wikimedia Commons"}`}
                        style={S.avatar}
                      />
                    ) : (
                      <span key={side} title={name || side} style={S.avatarFallback}>
                        {(name || "?").slice(0, 1)}
                      </span>
                    );
                  })}
                </div>
                <div style={S.copy}>
                  <div style={S.title}>
                    {g.queenSac && <span style={S.badge}>♛ sac</span>}
                    {g.title}
                  </div>
                  <div style={S.players}>
                    {g.white || g.black ? (
                      <>
                        <span style={{ ...S.sideMark, ...S.whiteMark }}>♕</span>
                        {g.white || "?"}
                        <span style={S.vs}>–</span>
                        <span style={{ ...S.sideMark, ...S.blackMark }}>♛</span>
                        {g.black || "?"}
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div style={S.tags}>
                    {[g.year, g.eco, g.opening, g.result].filter(Boolean).join("  ·  ")}
                  </div>
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

const S = {
  main: { margin: "0 auto", padding: "34px 20px 120px" },
  header: { marginBottom: 28 },
  h1: { fontSize: 28, fontWeight: 600, letterSpacing: "-0.5px" },
  sub: { color: "var(--muted)", marginTop: 6, fontSize: 13 },
  subLink: { color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 3 },
  input: {
    width: "100%", padding: "14px 16px", fontSize: 16, fontFamily: "inherit",
    background: "var(--card)", color: "var(--fg)", border: "1px solid var(--line)",
    borderRadius: 10, outline: "none",
  },
  inputWrap: { position: "relative" },
  placeholder: {
    position: "absolute", left: 17, right: 48, top: "50%",
    color: "var(--muted)", fontSize: 16, pointerEvents: "none",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    transition: "opacity .18s ease, transform .18s ease",
  },
  clearBtn: {
    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
    width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", background: "transparent", color: "var(--muted)",
    fontSize: 22, lineHeight: 1, cursor: "pointer", borderRadius: 7,
  },
  chips: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 },
  chip: {
    padding: "7px 12px", fontSize: 13, fontFamily: "inherit", cursor: "pointer",
    background: "transparent", color: "var(--muted)",
    borderWidth: 1, borderStyle: "solid", borderColor: "var(--line)",
    borderRadius: 999,
  },
  chipOn: { color: "#0f0f10", background: "var(--accent)", borderColor: "var(--accent)" },
  meta: { color: "var(--muted)", fontSize: 12, margin: "22px 2px 10px" },
  list: { listStyle: "none", display: "flex", flexDirection: "column", gap: 8 },
  card: {
    background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10,
    transition: "border-color .12s",
    // List virtualization: browser skips rendering/layout of off-screen cards.
    // Handles variable card heights with zero dependencies.
    contentVisibility: "auto",
    containIntrinsicSize: "0 140px",
  },
  cardLink: { display: "block", padding: "14px 16px" },
  row: { display: "flex", gap: 24, alignItems: "center" },
  heads: { display: "flex", flexShrink: 0, width: 147 },
  avatar: {
    width: 87, height: 87, borderRadius: "50%", objectFit: "cover",
    border: "1px solid var(--line)", background: "#0f0f10", marginRight: -24,
  },
  avatarFallback: {
    width: 87, height: 87, borderRadius: "50%", display: "grid", placeItems: "center",
    border: "1px solid var(--line)", background: "#202024", color: "var(--muted)",
    fontSize: 27, marginRight: -24,
  },
  copy: { minWidth: 0 },
  title: { fontSize: 15, fontWeight: 500, lineHeight: 1.35 },
  badge: {
    display: "inline-block", fontSize: 11, color: "var(--accent)",
    border: "1px solid var(--accent)", borderRadius: 5, padding: "1px 6px", marginRight: 8,
  },
  players: { color: "#a7a7ad", fontSize: 13, marginTop: 5 },
  sideMark: { display: "inline-block", width: 16, marginRight: 4, fontSize: 14 },
  whiteMark: { color: "#f2f2f0" },
  blackMark: { color: "#686870" },
  vs: { color: "var(--muted)", margin: "0 7px" },
  tags: { color: "var(--muted)", fontSize: 12, marginTop: 4 },
};
