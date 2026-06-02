#!/usr/bin/env node
// Builds a compact, search-ready index from the agadmator-library db/ JSON files.
// Source data: https://github.com/agadmator-library/agadmator-library.github.io
//
// Usage:
//   node scripts/build-index.mjs [path-to-agadmator-library-checkout]
// Defaults to $AGAD_SRC or /tmp/agad-src/agadmator-library.github.io-main

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SRC =
  process.argv[2] ||
  process.env.AGAD_SRC ||
  "/tmp/agad-src/agadmator-library.github.io-main";

const DB_DIR = join(SRC, "db");

// Pick the first non-empty value across the source-site records.
const pick = (...vals) => vals.find((v) => v != null && v !== "") ?? null;

// --- Move/PGN-derived flags, ported from the upstream agadmator-library ---
// QueenSacrificeFilter.ts + Pgn.ts. Precomputed here so each becomes a free,
// exact filter at query time (no PGN parsing at runtime).

// Verbatim port of QueenSacrificeFilter.ts: tracks queen squares through the
// game, flags a queen capture that is NOT an immediate queen-for-queen trade.
function isQueenSacrifice(pgn) {
  if (!pgn) return false;
  const moves = pgn.replace(/\d+\.\s+/g, "").trim().split(/\s+/);
  const captureRegex = /([QRNB])?([a-h1-8])?x([a-h][1-8])/;
  let whiteQueenPosition = "d1";
  let blackQueenPosition = "d8";
  const lastMoveIndex = moves.length - 1;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const captureMatch = move.match(captureRegex);
    if (captureMatch) {
      const targetSquare = captureMatch[3];
      const isWhiteQueenCapture = targetSquare === whiteQueenPosition;
      const isBlackQueenCapture = targetSquare === blackQueenPosition;
      if (isWhiteQueenCapture || isBlackQueenCapture) {
        if (captureMatch[1] === "Q") {
          if (isWhiteQueenCapture) blackQueenPosition = targetSquare;
          else whiteQueenPosition = targetSquare;
        }
        const otherQueenPosition = isWhiteQueenCapture
          ? blackQueenPosition
          : whiteQueenPosition;
        const nextMove = moves[i + 1];
        const nextCaptureMatch = nextMove?.match(captureRegex);
        const nextTargetSquare = nextCaptureMatch?.[3];
        const nextMoveIsQueenCapture = nextTargetSquare === otherQueenPosition;
        return !nextMoveIsQueenCapture && i !== lastMoveIndex;
      }
    }
    if (move.startsWith("Q")) {
      const cleanMove = move.replace(/[+#]/g, "");
      const newSquare = cleanMove.includes("x")
        ? cleanMove.slice(cleanMove.indexOf("x") + 1)
        : cleanMove.slice(1);
      if (i % 2 === 0) whiteQueenPosition = newSquare;
      else blackQueenPosition = newSquare;
    }
  }
  return false;
}

// Per-PGN derivations from Pgn.ts.
const b4Played = (pgn) => /\d\.\s+b4/.test(pgn || "");
const queenCount = (pgn) => 2 + ((pgn || "").match(/=Q/g) || []).length;
const hasUnderpromotion = (pgn) => ((pgn || "").match(/=[^Q]/g) || []).length > 0;
const moveCount = (pgn) => {
  const m = (pgn || "").match(/\d+\.\s/g) || [];
  return m.length ? parseInt(m[m.length - 1]) : 0;
};

// Aggregate the per-game flags across every game shown in a video.
function gameFlags(pgns) {
  return {
    queenSac: pgns.some(isQueenSacrifice),
    queenCount: pgns.reduce((mx, p) => Math.max(mx, queenCount(p)), 0),
    underpromotion: pgns.some(hasUnderpromotion),
    b4: pgns.some(b4Played),
    moves: pgns.reduce((mx, p) => Math.max(mx, moveCount(p)), 0),
    checkmate: pgns.some((p) => /#/.test(p)), // a move delivered mate on the board
  };
}

// The full half-move (ply) list in clean SAN — powers "move N = X" queries for
// ANY move in the game, not just the opening.
// plies[0]=white move 1, plies[1]=black move 1, plies[2]=white move 2, ...
function toPlies(pgn) {
  if (!pgn) return [];
  return pgn
    .replace(/\d+\.(\.\.)?/g, " ") // strip move numbers (incl. "2..." black continuations)
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, " ") // strip results
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[+#!?]/g, "")); // strip check/mate/annotation marks
}

// Strip agadmator's repeated sponsor/social boilerplate, keep the game blurb.
function cleanDescription(desc) {
  if (!desc) return "";
  // The game-specific text is almost always before the first link/sponsor block.
  const cut = desc.search(/https?:\/\/|Check out|Support me|Become a|Follow me|►|👉/i);
  const head = cut > 40 ? desc.slice(0, cut) : desc;
  return head.replace(/\s+/g, " ").trim().slice(0, 300);
}

function compact(rec) {
  const vs = rec.videoSnippet || {};
  const game = (rec.videoGame || [])[0] || {};
  const ct = rec.chesstempoCom || {};
  const c365 = rec.chess365 || {};
  const cc = rec.chessCom || {};

  const white = pick(game.playerWhite, cc.playerWhite, ct.playerWhite, c365.playerWhite);
  const black = pick(game.playerBlack, cc.playerBlack, ct.playerBlack, c365.playerBlack);
  const eco = pick(ct.eco, c365.eco);
  const opening = pick(ct.openingName, null);
  const event = pick(ct.event, c365.tournament, ct.site);
  const result = pick(cc.result, c365.result);
  const year = pick(cc.year, c365.year, (ct.date || "").slice(0, 4) || null);

  const id = pick(rec._id, vs.videoId);

  // Final / critical positions agadmator highlights (one per game shown).
  const fens = (rec.videoGame || []).map((g) => g.fen).filter(Boolean);
  const pgns = (rec.videoGame || []).map((g) => g.pgn).filter(Boolean);
  const flags = gameFlags(pgns);
  const plies = toPlies(game.pgn); // primary game's full move list

  return {
    id,
    title: vs.title || "",
    desc: cleanDescription(vs.description),
    published: vs.publishedAt || null,
    duration: (rec.videoContentDetails || {}).duration || null,
    white,
    black,
    eco,
    opening,
    event,
    result,
    year,
    fens,
    pgn: game.pgn || null,
    // Precomputed move/PGN-derived filters (from upstream filters + Pgn.ts).
    queenSac: flags.queenSac,
    queenCount: flags.queenCount,
    underpromotion: flags.underpromotion,
    b4: flags.b4,
    moves: flags.moves,
    checkmate: flags.checkmate,
    plies, // full SAN ply list of the primary game → "move N = X" filtering
    url: id ? `https://youtu.be/${id}` : null,
  };
}

console.error(`Reading db/ from ${DB_DIR} ...`);
const files = readdirSync(DB_DIR).filter((f) => f.endsWith(".json"));

const records = [];
let skipped = 0;
for (const f of files) {
  try {
    const rec = JSON.parse(readFileSync(join(DB_DIR, f), "utf8"));
    const c = compact(rec);
    if (c.id) records.push(c);
    else skipped++;
  } catch {
    skipped++;
  }
}

// Stable sort newest-first so "latest" queries are cheap.
records.sort((a, b) => String(b.published).localeCompare(String(a.published)));

mkdirSync(join(ROOT, "data"), { recursive: true });
const out = join(ROOT, "data", "index.json");
writeFileSync(out, JSON.stringify(records));

const bytes = readFileSync(out).length;
console.error(
  `Wrote ${records.length} records (${skipped} skipped) -> data/index.json (${(bytes / 1e6).toFixed(2)} MB)`
);
