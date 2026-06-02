import { searchGames } from "../../../../src/search.js";

// Node runtime: the search core reads data/index.json from disk.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req) {
  const sp = new URL(req.url).searchParams;
  const opts = { query: sp.get("q") || "", limit: 150 };
  const str = (k) => sp.get(k) || undefined;
  const num = (k) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  const bool = (k) => sp.get(k) === "1" || undefined;

  opts.player = str("player");
  opts.players = str("players");
  opts.versus = str("versus");
  opts.event = str("event");
  opts.opening = str("opening");
  opts.openingFamily = str("openingFamily");
  opts.semanticTags = str("semanticTags");
  opts.tags = str("tags");
  opts.tag = str("tag");
  opts.motif = str("motif");
  opts.matePattern = str("matePattern");
  opts.material = str("material");
  opts.pawnStructure = str("pawnStructure");
  opts.phase = str("phase");
  opts.format = str("format");
  opts.timeControl = str("timeControl");
  opts.emotion = str("emotion");
  opts.mood = str("mood");
  opts.story = str("story");
  opts.resultStory = str("resultStory");
  opts.playerStory = str("playerStory");
  opts.openingStyle = str("openingStyle");
  opts.worldChampion = bool("worldChampion");
  opts.superGm = bool("superGm");
  opts.women = bool("women");
  opts.eco = str("eco");
  opts.year = str("year");
  opts.white = str("white");
  opts.black = str("black");
  opts.winner = str("winner");
  opts.result = str("result");
  opts.decisive = bool("decisive");
  opts.draw = bool("draw");
  opts.yearFrom = num("yearFrom");
  opts.yearTo = num("yearTo");
  opts.publishedFrom = str("publishedFrom");
  opts.publishedTo = str("publishedTo");
  opts.era = str("era");
  opts.queenSac = bool("queenSac");
  opts.rookSac = bool("rookSac");
  opts.bishopSac = bool("bishopSac");
  opts.knightSac = bool("knightSac");
  opts.pieceSac = bool("pieceSac");
  opts.exchangeSac = bool("exchangeSac");
  opts.kingHunt = bool("kingHunt");
  opts.stalemate = bool("stalemate");
  opts.smotheredMate = bool("smotheredMate");
  opts.backRankMate = bool("backRankMate");
  opts.queenTrap = bool("queenTrap");
  opts.fork = bool("fork");
  opts.pin = bool("pin");
  opts.skewer = bool("skewer");
  opts.perpetualCheck = bool("perpetualCheck");
  opts.missedMate = bool("missedMate");
  opts.blunder = bool("blunder");
  opts.flagged = bool("flagged");
  opts.checkmate = bool("checkmate");
  opts.underpromotion = bool("underpromotion");
  opts.promotion = bool("promotion");
  opts.b4 = bool("b4");
  opts.minQueens = num("minQueens");
  opts.minMoves = num("minMoves");
  opts.maxMoves = num("maxMoves");
  opts.miniature = bool("miniature");
  opts.short = bool("short");
  opts.endgame = bool("endgame");
  opts.minDuration = str("minDuration") || num("minDuration");
  opts.maxDuration = str("maxDuration") || num("maxDuration");
  opts.duration = str("duration");
  opts.hasFen = bool("hasFen");
  opts.computer = bool("computer");
  opts.humanOnly = bool("humanOnly");
  opts.startsWith = str("startsWith");
  const hasMovesRaw = str("hasMoves");
  if (hasMovesRaw) opts.hasMoves = hasMovesRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const movesRaw = sp.get("moves");
  if (movesRaw) {
    try {
      const parsed = JSON.parse(movesRaw);
      if (Array.isArray(parsed) && parsed.length) opts.moves = parsed;
    } catch {}
  }

  return Response.json(searchGames(opts));
}
