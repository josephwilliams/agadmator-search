#!/usr/bin/env node
// agadmator-mcp — MCP stdio server exposing agadmator's chess catalogue.
// Tools: search_games (text + structured filters) and get_game (full detail).
// All retrieval is local against data/index.json — no network, no API key.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchGames, getGame, load } from "./search.js";

const server = new McpServer({ name: "agadmator-mcp", version: "0.1.0" });

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

server.tool(
  "search_games",
  "Search agadmator's chess video catalogue (~5,000 analysed games). Combine free-text " +
    "with structured filters. Move-level filters (queenSac, underpromotion, b4, queen/move " +
    "counts) are precomputed from the actual game moves, not titles. Returns lean results; " +
    "call get_game for full detail (PGN, all positions).",
  {
    query: z.string().optional().describe('Free text, e.g. "tal attack" or "world championship"'),
    player: z.string().optional().describe("Player name; matches white or black"),
    players: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .describe('Color-agnostic matchup, e.g. ["Magnus Carlsen","Hikaru Nakamura"] or "Magnus vs Hikaru"'),
    versus: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .describe("Alias for players/head-to-head matchup, regardless of color"),
    event: z.string().optional().describe('Tournament/event text, e.g. "Norway Chess", "Candidates"'),
    opening: z.string().optional().describe('Opening name/family, e.g. "najdorf", "london", "queens gambit"'),
    openingFamily: z.string().optional().describe('Opening family, e.g. "sicilian", "ruy lopez", "caro-kann"'),
    semanticTags: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .describe('Semantic tag filter(s), e.g. "queenless middlegame", "time trouble", "opening trap"'),
    tags: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .describe("Alias for semanticTags; comma-separated strings are accepted"),
    tag: z.string().optional().describe("Single semantic tag alias"),
    motif: z.string().optional().describe('Tactical motif tag, e.g. "fork", "greek gift", "queen trap"'),
    matePattern: z.string().optional().describe('Mate-pattern tag, e.g. "smothered mate", "back rank mate", "mate in two"'),
    material: z.string().optional().describe('Material/endgame tag, e.g. "rook endgame", "bishop pair", "passed pawn"'),
    pawnStructure: z.string().optional().describe('Pawn-structure tag, e.g. "isolated pawn", "passed pawn", "hanging pawns"'),
    phase: z.string().optional().describe('Game phase/castling tag, e.g. "no castling", "opposite-side castling"'),
    format: z.string().optional().describe('Video/game format tag, e.g. "blitz", "rapid", "tiebreak", "must win"'),
    timeControl: z.string().optional().describe('Alias for format/time-control tags, e.g. "blitz", "rapid", "classical"'),
    emotion: z.string().optional().describe('Mood/quality tag, e.g. "brutal", "beautiful", "clinical"'),
    mood: z.string().optional().describe("Alias for emotion/mood tags"),
    story: z.string().optional().describe('Story tag shortcut, e.g. "escape", "time trouble", "underdog"'),
    resultStory: z.string().optional().describe('Result narrative tag, e.g. "missed mate", "fighting draw"'),
    playerStory: z.string().optional().describe('Player narrative tag, e.g. "prodigy", "women", "world champion loses"'),
    openingStyle: z.string().optional().describe('Opening style tag, e.g. "rare opening", "novelty", "refutation"'),
    worldChampion: z.boolean().optional().describe("Only games involving a world champion or world-championship title text"),
    superGm: z.boolean().optional().describe("Only games involving known super-GM/elite player names or super-GM title text"),
    women: z.boolean().optional().describe("Only games involving known women players or women/female title text"),
    eco: z.string().optional().describe('ECO code or prefix, e.g. "B90" or "B"'),
    year: z.union([z.string(), z.number()]).optional().describe("Exact game year"),
    yearFrom: z.number().optional().describe("Earliest game year (inclusive)"),
    yearTo: z.number().optional().describe("Latest game year (inclusive)"),
    publishedFrom: z.string().optional().describe("Earliest YouTube publish date, e.g. 2024-01-01"),
    publishedTo: z.string().optional().describe("Latest YouTube publish date, e.g. 2024-12-31"),
    era: z
      .enum(["classical", "historical", "modern", "contemporary", "recent", "engine", "computer"])
      .optional()
      .describe("Game era bucket"),
    white: z.string().optional().describe("Player who had the white pieces"),
    black: z.string().optional().describe("Player who had the black pieces"),
    winner: z.string().optional().describe("Player who won, regardless of color"),
    result: z
      .enum(["white", "black", "draw", "1-0", "0-1"])
      .optional()
      .describe("Game outcome"),
    decisive: z.boolean().optional().describe("Only decisive games (1-0 or 0-1)"),
    draw: z.boolean().optional().describe("Only drawn games"),
    queenSac: z.boolean().optional().describe("Only games with a move-detected queen sacrifice"),
    rookSac: z.boolean().optional().describe("Only games whose title/description mentions a rook sacrifice"),
    bishopSac: z.boolean().optional().describe("Only games whose title/description mentions a bishop sacrifice"),
    knightSac: z.boolean().optional().describe("Only games whose title/description mentions a knight sacrifice"),
    pieceSac: z.boolean().optional().describe("Queen sacrifice or title/description-mentioned piece sacrifice"),
    exchangeSac: z.boolean().optional().describe("Only games whose title/description mentions an exchange sacrifice"),
    kingHunt: z.boolean().optional().describe("Only likely king hunts (text match or many checks in PGN)"),
    stalemate: z.boolean().optional().describe("Only games/videos mentioning stalemate"),
    smotheredMate: z.boolean().optional().describe("Only games/videos mentioning smothered mate"),
    backRankMate: z.boolean().optional().describe("Only games/videos mentioning back-rank mate"),
    queenTrap: z.boolean().optional().describe("Only games/videos mentioning a queen trap"),
    fork: z.boolean().optional().describe("Only games/videos mentioning forks"),
    pin: z.boolean().optional().describe("Only games/videos mentioning pins"),
    skewer: z.boolean().optional().describe("Only games/videos mentioning skewers"),
    perpetualCheck: z.boolean().optional().describe("Only games/videos mentioning perpetual check"),
    missedMate: z.boolean().optional().describe("Only games/videos mentioning missed mate"),
    blunder: z.boolean().optional().describe("Only games/videos mentioning blunders or thrown wins"),
    flagged: z.boolean().optional().describe("Only games/videos mentioning flagging or flag fall"),
    underpromotion: z.boolean().optional().describe("Only games featuring an underpromotion"),
    promotion: z.boolean().optional().describe("Only games featuring any promotion"),
    b4: z.boolean().optional().describe("Only games where b4 was played (e.g. Polar Bear / Orangutan)"),
    minQueens: z.number().optional().describe("Min queens on board at peak (>2 means a queen was promoted)"),
    checkmate: z.boolean().optional().describe("Only games that ended in checkmate on the board"),
    minMoves: z.number().optional().describe("Minimum move count"),
    maxMoves: z.number().optional().describe("Maximum move count (e.g. 25 for miniatures)"),
    miniature: z.boolean().optional().describe("Only games with 25 moves or fewer"),
    short: z.boolean().optional().describe("Only games with 35 moves or fewer"),
    endgame: z.boolean().optional().describe("Only games with at least 60 moves"),
    minDuration: z.union([z.number(), z.string()]).optional().describe('Minimum video duration in seconds or strings like "10m"'),
    maxDuration: z.union([z.number(), z.string()]).optional().describe('Maximum video duration in seconds or strings like "10m"'),
    duration: z.enum(["short", "medium", "long"]).optional().describe("Video duration bucket: <=10m, 10-20m, >20m"),
    hasFen: z.boolean().optional().describe("Only games with highlighted FEN positions"),
    computer: z.boolean().optional().describe("Only engine/computer games"),
    humanOnly: z.boolean().optional().describe("Exclude engine/computer games"),
    startsWith: z
      .string()
      .optional()
      .describe('Friendly opening movetext prefix, e.g. "1.e4 c5 2.Nf3"'),
    hasMoves: z
      .array(z.string())
      .optional()
      .describe('Moves (SAN) that appear ANYWHERE in the game, e.g. ["O-O-O","Nf5"]. All must appear.'),
    moves: z
      .array(
        z.object({
          n: z.number().describe("Move number, 1-based"),
          side: z.enum(["w", "b"]).describe("w = White, b = Black"),
          san: z.string().describe("Move in SAN, e.g. b3, Qxf7, O-O, exd5"),
        })
      )
      .optional()
      .describe(
        'Match specific moves by position in the game (any move, not just the opening). ' +
          'All entries must hold (AND). Example: White plays b3 on move 2 → [{"n":2,"side":"w","san":"b3"}].'
      ),
    limit: z.number().optional().describe("Max results, default 5"),
  },
  async (args) => json(searchGames(args)),
);

server.tool(
  "get_game",
  "Full detail for one video by its YouTube id (from search_games results): title, players, " +
    "opening/ECO, result, PGN, highlighted positions (FEN), move-level flags, and YouTube URL.",
  { id: z.string().describe("YouTube video id, e.g. SxGPIYFeP0A") },
  async ({ id }) => {
    const game = getGame(id);
    return game ? json(game) : json({ error: `No game with id ${id}` });
  },
);

load(); // warm the index before connecting
await server.connect(new StdioServerTransport());
