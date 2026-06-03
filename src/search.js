// Shared search core. No LLM, no network — pure in-memory ranking over data/index.json.
// Both the MCP server and the web UI call these functions, so results are identical.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, "..", "data", "index.json");
const PORTRAITS_PATH = join(__dirname, "..", "data", "player-portraits.json");

/** @type {Array<object>} */
let RECORDS = null;
let PORTRAITS = null;
const DERIVED = new WeakMap();

// In-process LRU memo of identical searches. Cuts repeated CPU work under load
// (e.g. a traffic spike where many clients run the same query) without any
// external cache. Keyed by the canonical request; results are read-only.
const SEARCH_CACHE = new Map();
const SEARCH_CACHE_MAX = 500;

function cacheKey(opts) {
  const keys = Object.keys(opts).filter((k) => opts[k] !== undefined).sort();
  return keys.map((k) => `${k}=${JSON.stringify(opts[k])}`).join("&");
}

export function load() {
  if (!RECORDS) RECORDS = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  return RECORDS;
}

export function loadPortraits() {
  if (!PORTRAITS) {
    try {
      PORTRAITS = JSON.parse(readFileSync(PORTRAITS_PATH, "utf8")).portraits || {};
    } catch {
      PORTRAITS = {};
    }
  }
  return PORTRAITS;
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "and", "or", "with", "by",
  "for", "where", "who", "what", "which", "someone", "somebody", "game",
  "games", "video", "videos", "match", "find", "show", "me", "that", "this",
  "his", "her", "played", "play", "plays", "is", "was", "agadmator", "vs",
  "against", "win", "wins", "won",
]);

// Light synonym expansion so a search box behaves like a smart fan would expect.
const SYNONYMS = {
  sac: ["sacrifice", "sacrifices", "sacrificed", "sacrificing"],
  sacrifice: ["sac"],
  mate: ["checkmate", "mates"],
  mating: ["mate", "checkmate"],
  queens: ["queen", "queen's"],
  queen: ["queens", "queen's"],
  qga: ["queen's gambit accepted", "queens gambit accepted"],
  qgd: ["queen's gambit declined", "queens gambit declined"],
  immortal: ["brilliancy", "masterpiece", "classic"],
  brilliancy: ["brilliant", "immortal", "masterpiece"],
  brilliant: ["brilliancy", "masterpiece"],
  masterpiece: ["brilliancy", "immortal"],
  crazy: ["insane", "wild", "chaos"],
  insane: ["crazy", "wild"],
  disaster: ["blunder", "collapse"],
  comeback: ["swindle", "turnaround", "escape"],
  swindle: ["comeback", "trick", "escape"],
  miracle: ["escape", "save"],
  save: ["escape"],
  escape: ["save", "miracle", "comeback"],
  upset: ["underdog"],
  rare: ["offbeat", "sideline"],
  offbeat: ["rare", "sideline"],
  technical: ["clinical", "grind"],
  defensive: ["defense", "masterpiece"],
  quiet: ["quiet move"],
  stafford: ["petrov", "petroff", "russian"],
  petrov: ["petroff", "russian"],
  petroff: ["petrov", "russian"],
  caro: ["caro-kann"],
  kann: ["caro-kann"],
  ruy: ["spanish", "lopez"],
  lopez: ["ruy", "spanish"],
  wc: ["world championship"],
  worldchampionship: ["world championship"],
};

function norm(s) {
  return (s == null ? "" : String(s)).toLowerCase();
}

function plain(s) {
  return norm(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(q) {
  const raw = norm(q)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  // Each base token + its synonyms form one concept "group". A record that hits
  // many distinct groups beats one that hits a single group loudly.
  return [...new Set(raw)].map((t) => [t, ...(SYNONYMS[t] || [])]);
}

// Field weights — a hit in the title or opening matters far more than in the blurb.
const WEIGHTS = {
  title: 6,
  derivedOpening: 7,
  semanticTags: 5,
  opening: 5,
  white: 4,
  black: 4,
  eco: 4,
  event: 2,
  desc: 1.5,
  year: 3,
};

function fieldText(rec, field) {
  if (field === "derivedOpening") return derivedOpeningTags(rec).join(" ");
  if (field === "semanticTags") return derived(rec).semanticTags.join(" ");
  if (field === "event") return [rec.event, rec.title, rec.desc].filter(Boolean).join(" ");
  const v = rec[field];
  return Array.isArray(v) ? v.join(" ") : norm(v);
}

function startsWithMoves(plies, moves) {
  return moves.every((m, i) => plies?.[i] === m);
}

function openingAliases(name) {
  const text = norm(name);
  const p = plain(name);
  const tags = [];
  if (text.includes("queen's gambit") || text.includes("queens gambit")) {
    tags.push("queen's gambit", "queens gambit", "queen gambit");
  }
  if (text.includes("russian game") || text.includes("petrov") || text.includes("petroff")) {
    tags.push("russian game", "petrov defense", "petroff defense", "stafford gambit");
  }
  if (text.includes("halloween")) tags.push("halloween gambit", "halloween attack");
  if (p.includes("sicilian")) tags.push("sicilian defense", "sicilian");
  if (p.includes("najdorf")) tags.push("sicilian defense", "najdorf");
  if (p.includes("french")) tags.push("french defense", "french");
  if (p.includes("caro kann")) tags.push("caro-kann defense", "caro kann");
  if (p.includes("london")) tags.push("london system", "london");
  if (p.includes("kings indian")) tags.push("king's indian defense", "kings indian");
  if (p.includes("ruy lopez") || p.includes("spanish game")) tags.push("ruy lopez", "spanish game");
  if (p.includes("italian")) tags.push("italian game", "italian");
  if (p.includes("evans gambit")) tags.push("evans gambit");
  if (p.includes("kings gambit")) tags.push("king's gambit", "kings gambit");
  if (p.includes("scandinavian")) tags.push("scandinavian defense", "scandinavian");
  if (p.includes("slav")) tags.push("slav defense", "slav");
  if (p.includes("semi slav")) tags.push("semi-slav defense", "semi slav");
  if (p.includes("dragon")) tags.push("sicilian dragon", "dragon");
  if (p.includes("accelerated dragon")) tags.push("accelerated dragon");
  if (p.includes("jobava")) tags.push("jobava london", "jobava");
  if (p.includes("fried liver")) tags.push("fried liver attack", "fried liver");
  if (p.includes("traxler")) tags.push("traxler counterattack", "traxler");
  if (p.includes("wayward queen")) tags.push("wayward queen attack", "wayward queen");
  if (p.includes("bongcloud")) tags.push("bongcloud");
  if (p.includes("hippo") || p.includes("hippopotamus")) tags.push("hippopotamus defense", "hippo");
  if (p.includes("cow opening")) tags.push("cow opening");
  if (p.includes("benko")) tags.push("benko gambit", "benko");
  if (p.includes("benoni")) tags.push("benoni defense", "benoni");
  if (p.includes("catalan")) tags.push("catalan opening", "catalan");
  if (p.includes("berlin")) tags.push("berlin defense", "berlin");
  if (p.includes("marshall")) tags.push("marshall attack", "marshall");
  if (p.includes("anti marshall")) tags.push("anti-marshall", "anti marshall");
  if (p.includes("poisoned pawn") || p.includes("poison pawn")) tags.push("poisoned pawn", "poison pawn");
  if (p.includes("english")) tags.push("english opening", "english");
  if (p.includes("reti")) tags.push("reti opening", "reti");
  if (p.includes("bird")) tags.push("bird opening", "bird");
  if (p.includes("orangutan") || p.includes("polish opening")) tags.push("orangutan", "polish opening");
  if (p.includes("scotch")) tags.push("scotch game", "scotch");
  if (p.includes("vienna")) tags.push("vienna game", "vienna");
  if (p.includes("alapin")) tags.push("alapin", "sicilian alapin");
  if (p.includes("smith morra")) tags.push("smith-morra gambit", "smith morra");
  return tags;
}

function derivedOpeningTags(rec) {
  const plies = rec.plies || [];
  const tags = [...openingAliases(rec.opening)];

  if (startsWithMoves(plies, ["d4", "d5", "c4"])) {
    tags.push("queen's gambit", "queens gambit", "queen gambit");
    if (plies[3] === "dxc4") tags.push("queen's gambit accepted", "queens gambit accepted");
    else tags.push("queen's gambit declined", "queens gambit declined");
  }

  if (startsWithMoves(plies, ["e4", "c5"])) tags.push("sicilian defense", "sicilian");
  if (startsWithMoves(plies, ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"])) {
    tags.push("najdorf", "sicilian najdorf");
  }
  if (startsWithMoves(plies, ["e4", "e6"])) tags.push("french defense", "french");
  if (startsWithMoves(plies, ["e4", "c6"])) tags.push("caro-kann defense", "caro kann");
  if (startsWithMoves(plies, ["d4", "Nf6", "c4", "g6"])) tags.push("king's indian defense", "kings indian");
  if (startsWithMoves(plies, ["d4", "d5", "Nf3", "Nf6", "Bf4"])) tags.push("london system", "london");
  if (startsWithMoves(plies, ["e4", "e5", "Nf3", "Nc6", "Bb5"])) tags.push("ruy lopez", "spanish game");
  if (startsWithMoves(plies, ["e4", "e5", "Nf3", "Nc6", "Bc4"])) tags.push("italian game", "italian");
  if (startsWithMoves(plies, ["e4", "d5"])) tags.push("scandinavian defense", "scandinavian");
  if (startsWithMoves(plies, ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "b4"])) tags.push("evans gambit");
  if (startsWithMoves(plies, ["e4", "e5", "f4"])) tags.push("king's gambit", "kings gambit");
  if (startsWithMoves(plies, ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "g6"])) {
    tags.push("sicilian dragon", "dragon");
  }
  if (startsWithMoves(plies, ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "g6"])) {
    tags.push("accelerated dragon");
  }
  if (startsWithMoves(plies, ["d4", "Nf6", "Nf3", "d5", "Bf4"])) tags.push("london system", "jobava london");
  if (startsWithMoves(plies, ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5"])) {
    tags.push("fried liver attack", "fried liver", "two knights defense");
  }
  if (startsWithMoves(plies, ["d4", "Nf6", "c4", "c5", "d5", "b5"])) tags.push("benko gambit", "benko");
  if (startsWithMoves(plies, ["d4", "Nf6", "c4", "c5", "d5", "e6"])) tags.push("benoni defense", "benoni");
  if (startsWithMoves(plies, ["d4", "Nf6", "c4", "e6", "g3"])) tags.push("catalan opening", "catalan");
  if (startsWithMoves(plies, ["c4"])) tags.push("english opening", "english");
  if (startsWithMoves(plies, ["Nf3"])) tags.push("reti opening", "reti");
  if (startsWithMoves(plies, ["f4"])) tags.push("bird opening", "bird");
  if (startsWithMoves(plies, ["b4"])) tags.push("orangutan", "polish opening");
  if (startsWithMoves(plies, ["e4", "e5", "Nf3", "Nc6", "d4"])) tags.push("scotch game", "scotch");
  if (startsWithMoves(plies, ["e4", "e5", "Nc3"])) tags.push("vienna game", "vienna");
  if (startsWithMoves(plies, ["e4", "c5", "c3"])) tags.push("alapin", "sicilian alapin");
  if (startsWithMoves(plies, ["e4", "c5", "d4", "cxd4", "c3"])) tags.push("smith-morra gambit", "smith morra");

  if (startsWithMoves(plies, ["e4", "e5", "Nf3", "Nf6"])) {
    tags.push("russian game", "petrov defense", "petroff defense");
    // The true Stafford is 1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nc6. The current
    // catalogue has few/no exact labels, so a Stafford query should still land
    // in the Petrov/Russian family instead of returning nothing.
    tags.push("stafford gambit");
  }

  if (
    startsWithMoves(plies, ["e4", "e5", "Nf3", "Nf6", "Nc3", "Nc6", "Nxe5"]) ||
    startsWithMoves(plies, ["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6", "Nxe5"])
  ) {
    tags.push("halloween gambit", "halloween attack");
  }

  return [...new Set(tags)];
}

function openingQueryNeedle(query) {
  const q = norm(query).replace(/['’]/g, "");
  if (q.includes("stafford")) return "stafford gambit";
  if (q.includes("halloween") && q.includes("gambit")) return "halloween gambit";
  if ((q.includes("queen") || q.includes("queens")) && q.includes("gambit")) {
    return "queens gambit";
  }
  return null;
}

const OPENING_QUERY_ALIASES = [
  "sicilian", "najdorf", "dragon", "accelerated dragon", "french", "caro kann",
  "caro-kann", "london", "jobava", "kings indian", "king's indian", "ruy lopez",
  "spanish", "italian", "evans", "kings gambit", "king's gambit", "scandinavian",
  "benko", "benoni", "catalan", "berlin", "marshall", "english", "reti", "bird",
  "orangutan", "polish", "scotch", "vienna", "alapin", "smith morra",
];

const BLACK_OPENING_FAMILIES = new Set([
  "sicilian",
  "najdorf",
  "dragon",
  "accelerated dragon",
  "french",
  "caro kann",
  "caro-kann",
  "kings indian",
  "king's indian",
  "petrov",
  "petroff",
  "russian",
  "stafford",
  "scandinavian",
  "slav",
  "semi slav",
  "benko",
  "benoni",
  "berlin",
  "marshall",
]);

const WHITE_OPENING_FAMILIES = new Set([
  "queen's gambit",
  "queens gambit",
  "london",
  "jobava",
  "ruy lopez",
  "spanish",
  "italian",
  "evans",
  "kings gambit",
  "king's gambit",
  "catalan",
  "english",
  "reti",
  "bird",
  "orangutan",
  "polish",
  "scotch",
  "vienna",
  "alapin",
  "smith morra",
  "halloween",
]);

function openingFamilyFromQuery(query) {
  const p = plain(query);
  return OPENING_QUERY_ALIASES.find((name) => p.includes(plain(name))) || null;
}

function likelyOpeningSide(opening) {
  const p = plain(opening);
  if ([...BLACK_OPENING_FAMILIES].some((name) => p.includes(plain(name)))) return "black";
  if ([...WHITE_OPENING_FAMILIES].some((name) => p.includes(plain(name)))) return "white";
  return null;
}

function parseDurationSeconds(iso) {
  const m = String(iso || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

function dateMs(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : null;
}

function resultIsDraw(result) {
  return result === "½-½" || result === "1/2-1/2";
}

const COMPUTER_NAMES = [
  "alphazero",
  "stockfish",
  "leela",
  "komodo",
  "lc0",
  "houdini",
  "deep blue",
  "fritz",
];

const WORLD_CHAMPION_NAMES = new Set([
  "Magnus Carlsen",
  "Ding Liren",
  "Gukesh D",
  "Gukesh",
  "Viswanathan Anand",
  "Vladimir Kramnik",
  "Garry Kasparov",
  "Anatoly Karpov",
  "Boris Spassky",
  "Tigran Vartanovich Petrosian",
  "Tigran Petrosian",
  "Mikhail Tal",
  "Mikhail Botvinnik",
  "Vasily Smyslov",
  "Max Euwe",
  "Alexander Alekhine",
  "Jose Raul Capablanca",
  "Emanuel Lasker",
  "Wilhelm Steinitz",
  "Robert James Fischer",
  "Bobby Fischer",
]);

const SUPER_GM_NAMES = new Set([
  "Magnus Carlsen",
  "Fabiano Caruana",
  "Hikaru Nakamura",
  "Alireza Firouzja",
  "Ian Nepomniachtchi",
  "Ding Liren",
  "Levon Aronian",
  "Praggnanandhaa R",
  "Anish Giri",
  "Wesley So",
  "Maxime Vachier-Lagrave",
  "Gukesh D",
  "Viswanathan Anand",
  "Nodirbek Abdusattorov",
  "Erigaisi Arjun",
  "Jan-Krzysztof Duda",
  "Daniil Dubov",
  "Shakhriyar Mamedyarov",
  "Vincent Keymer",
  "Richard Rapport",
  "Alexander Grischuk",
  "Vidit Santosh Gujrathi",
  "Sergey Karjakin",
  "Vasyl Ivanchuk",
  "Vassily Ivanchuk",
  "Vladimir Kramnik",
  "Teimour Radjabov",
  "Wei Yi",
  "Yi Wei",
  "Peter Svidler",
  "Javokhir Sindarov",
  "Vladislav Artemiev",
  "Nihal Sarin",
  "Andrey Esipenko",
  "Parham Maghsoodloo",
  "Sam Shankland",
  "Vladimir Fedoseev",
  "Jeffrey Xiong",
  "Alexei Shirov",
  "Boris Gelfand",
  "Veselin Topalov",
  "Pentala Harikrishna",
  "Arjun Erigaisi",
  "Le Quang Liem",
  "Etienne Bacrot",
  "Dmitry Andreikin",
  "Nikita Vitiugov",
]);

const WOMEN_PLAYER_NAMES = new Set([
  "Judit Polgar",
  "Ju Wenjun",
  "Wenjun Ju",
  "Yifan Hou",
  "Hou Yifan",
  "Alexandra Kosteniuk",
  "Rameshbabu Vaishali",
  "Aleksandra Goryachkina",
  "Divya Deshmukh",
  "Zhongyi Tan",
  "Tan Zhongyi",
  "Tingjie Lei",
  "Lei Tingjie",
  "Irina Krush",
  "Alice Lee",
  "Eline Roebers",
  "Nurgyul Salimova",
  "Alina Kashlinskaya",
  "Carissa Yip",
  "Nona Gaprindashvili",
  "Stavroula Tsolakidou",
  "Mariya Muzychuk",
  "Anna Muzychuk",
  "Polina Shuvalova",
  "Dina Belenkaya",
  "Humpy Koneru",
  "Antoaneta Stefanova",
  "Bibisara Assaubayeva",
  "Annie Wang",
  "Beloslava Krasteva",
  "Miaoyi Lu",
  "Lu Miaoyi",
  "Jiner Zhu",
]);

const WORLD_CHAMPION_KEYS = new Set([...WORLD_CHAMPION_NAMES].map(plain));
const SUPER_GM_KEYS = new Set([...SUPER_GM_NAMES].map(plain));
const WOMEN_PLAYER_KEYS = new Set([...WOMEN_PLAYER_NAMES].map(plain));

function isComputerName(name) {
  const p = plain(name);
  return COMPUTER_NAMES.some((n) => p.includes(n));
}

function nameInSet(name, plainSet) {
  return plainSet.has(plain(name));
}

function anyPlayerInSet(rec, plainSet) {
  return nameInSet(rec.white, plainSet) || nameInSet(rec.black, plainSet);
}

function textBlob(rec) {
  return plain([rec.title, rec.desc, rec.opening, rec.event].filter(Boolean).join(" "));
}

const SEMANTIC_CATALOG = {
  motif: [
    ["greek gift", /\bgreek gift\b|\bbeware of greeks\b|\bbxh7\b|\bbxh2\b/],
    ["windmill", /\bwindmill\b/],
    ["zwischenzug", /\bzwischenzug\b|\bintermezzo\b/],
    ["discovered attack", /\bdiscovered attack\b/],
    ["discovered check", /\bdiscovered check\b/],
    ["fork", /\bfork\b|\bforked\b/],
    ["royal fork", /\broyal fork\b/],
    ["family fork", /\bfamily fork\b/],
    ["pin", /\bpin\b|\bpinned\b/],
    ["skewer", /\bskewer\b/],
    ["deflection", /\bdeflection\b|\bdeflect\b/],
    ["decoy", /\bdecoy\b/],
    ["clearance", /\bclearance\b/],
    ["remove defender", /\bremove defender\b|\bremoving the defender\b/],
    ["overloaded piece", /\boverloaded\b/],
    ["double attack", /\bdouble attack\b/],
    ["double check", /\bdouble check\b/],
    ["x-ray", /\bx ray\b|\bxray\b/],
    ["queen trap", /\bqueen trap\b|\btraps? the queen\b/],
    ["rook lift", /\brook lift\b/],
    ["perpetual check", /\bperpetual\b/],
    ["mating net", /\bmating net\b/],
    ["forced mate", /\bforced mate\b/],
    ["mate in one", /\bmate in 1\b|\bmate in one\b/],
    ["mate in two", /\bmate in 2\b|\bmate in two\b/],
    ["sac on h7", /\bsac(?:rifice)? on h7\b|\bbxh7\b/],
    ["sac on f7", /\bsac(?:rifice)? on f7\b|\bxf7\b/],
  ],
  material: [
    ["queenless middlegame", /\bqueenless\b|\bearly queen trade\b|\bqueen trade\b/],
    ["queens stayed on", /\bqueens stayed on\b|\bkeeps queens on\b/],
    ["rook endgame", /\brook endgame\b|\brook ending\b|\brook and pawn\b/],
    ["queen endgame", /\bqueen endgame\b|\bqueen ending\b/],
    ["pawn endgame", /\bpawn endgame\b|\bpawn ending\b|\bking and pawn\b/],
    ["opposite-colored bishops", /\bopposite colored bishops\b|\bopposite coloured bishops\b/],
    ["same-colored bishops", /\bsame colored bishops\b|\bsame coloured bishops\b/],
    ["bishop pair", /\bbishop pair\b|\btwo bishops\b/],
    ["knight endgame", /\bknight endgame\b|\bknight ending\b/],
    ["bishop vs knight", /\bknight vs bishop\b|\bbishop vs knight\b/],
    ["promotion race", /\bpromotion race\b/],
    ["passed pawn", /\bpassed pawn\b|\bpasser\b/],
    ["outside passer", /\boutside passer\b|\boutside passed pawn\b/],
    ["connected passed pawns", /\bconnected passed pawns\b/],
    ["isolated pawn", /\bisolated pawn\b|\bisolated queen pawn\b|\biqp\b/],
    ["hanging pawns", /\bhanging pawns\b/],
    ["backward pawn", /\bbackward pawn\b/],
  ],
  phase: [
    ["opposite-side castling", /\bopposite side castl|\bopposite-side castl/],
    ["castles queenside", /\bcastles queenside\b|\bqueenside castle\b|\bo o o\b/],
    ["no castling", /\bno castling\b|\bwithout castling\b/],
    ["middlegame", /\bmiddlegame\b/],
    ["endgame", /\bendgame\b|\bending\b/],
    ["opening trap", /\bopening trap\b/],
  ],
  format: [
    ["classical", /\bclassical\b/],
    ["rapid", /\brapid\b/],
    ["blitz", /\bblitz\b|\btitled tuesday\b|\bspeed chess\b/],
    ["bullet", /\bbullet\b/],
    ["armageddon", /\barmageddon\b/],
    ["freestyle", /\bfreestyle\b|\bchess960\b|\bfischer random\b/],
    ["final game", /\bfinal game\b/],
    ["final round", /\bfinal round\b/],
    ["tiebreak", /\btiebreak\b|\btie break\b/],
    ["must win", /\bmust win\b|\bmust-win\b/],
  ],
  emotion: [
    ["beautiful", /\bbeautiful\b|\bbeauty\b/],
    ["clean", /\bclean\b|\bsmooth\b/],
    ["brutal", /\bbrutal\b|\bsavage\b|\bno mercy\b/],
    ["clinical", /\bclinical\b|\btechnical win\b|\bgrind\b/],
    ["defensive masterpiece", /\bdefensive masterpiece\b/],
    ["attacking masterpiece", /\battacking masterpiece\b|\bperfect attacking game\b/],
    ["quiet move", /\bquiet move\b/],
    ["cold-blooded", /\bcold blooded\b|\bcold-blooded\b/],
    ["genius move", /\bgenius move\b|\bbrilliant move\b/],
    ["ridiculous move", /\bridiculous move\b/],
    ["chaos", /\bchaos\b|\bcrazy\b|\binsane\b|\bwild\b/],
  ],
  resultStory: [
    ["winning but blundered", /\bwinning but blundered\b|\bthrew away a win\b|\bthrows away a win\b/],
    ["dead lost", /\bdead lost\b|\bcompletely lost\b/],
    ["escape", /\bescaped\b|\bescape\b|\bmiracle save\b|\bgreat escape\b/],
    ["missed mate", /\bmissed mate\b|\bmisses mate\b/],
    ["missed win", /\bmissed win\b|\bmisses win\b|\bone move from victory\b/],
    ["only move", /\bonly move\b/],
    ["best move", /\bbest move\b/],
    ["blunderfest", /\bblunderfest\b/],
    ["time trouble", /\btime trouble\b|\btime scramble\b|\bscramble\b/],
    ["flagged", /\bflagged\b|\bflags\b/],
    ["resignation", /\bresigns?\b|\bresignation\b/],
    ["quick draw", /\bquick draw\b/],
    ["fighting draw", /\bfighting draw\b/],
  ],
  playerStory: [
    ["world champion", /\bworld champion\b/],
    ["world champion loses", /\bworld champion loses\b|\bworld champion lost\b/],
    ["youngster beats legend", /\byoungster beats legend\b|\bprodigy beats\b|\bteen beats\b/],
    ["prodigy", /\bprodigy\b|\bteenager\b|\b14 year old\b|\b13 year old\b|\b12 year old\b/],
    ["old master", /\bold master\b/],
    ["underdog", /\bunderdog\b|\blower rated\b/],
    ["women", /\bwomens?\b|\bwomen s\b|\bfemale\b/],
    ["computer beats human", /\bcomputer beats human\b|\bengine beats human\b/],
  ],
  openingStyle: [
    ["sharp opening", /\bsharp\b/],
    ["solid opening", /\bsolid opening\b|\bsolid\b/],
    ["boring opening", /\bboring berlin\b|\bboring opening\b/],
    ["dubious gambit", /\bdubious gambit\b/],
    ["rare opening", /\brare opening\b|\boffbeat\b|\bsideline\b/],
    ["main line", /\bmain line\b|\bmainline\b/],
    ["novelty", /\bnovelty\b|\bnew idea\b/],
    ["opening trap", /\bopening trap\b|\btrap in the opening\b/],
    ["refutation", /\brefutation\b|\brefuted\b|\bpunish bad opening\b/],
    ["copycat opening", /\bcopycat\b|\bcopy your opponent\b/],
    ["symmetrical opening", /\bsymmetrical opening\b|\bsymmetrical\b/],
  ],
};

function catalogTagsFromText(text) {
  const tags = [];
  for (const [category, entries] of Object.entries(SEMANTIC_CATALOG)) {
    for (const [tag, re] of entries) {
      if (re.test(text)) {
        tags.push(tag, `${category}:${tag}`);
      }
    }
  }
  return tags;
}

function sanTokens(rec) {
  return rec.plies || [];
}

function hasPromotion(rec) {
  return /=[QRNB]/.test(rec.pgn || "");
}

function sacrificeTextFlags(rec) {
  const t = textBlob(rec);
  return {
    rookSac:
      /\brook sac|\brook sacrifice|\bsacrifices rook|\bsacrificed rook|\bsacs rook/.test(t),
    bishopSac:
      /\bbishop sac|\bbishop sacrifice|\bsacrifices bishop|\bsacrificed bishop|\bsacs bishop/.test(t),
    knightSac:
      /\bknight sac|\bknight sacrifice|\bsacrifices knight|\bsacrificed knight|\bsacs knight/.test(t),
    exchangeSac:
      /\bexchange sac|\bexchange sacrifice|\bsacrifices exchange|\bsacrificed exchange/.test(t),
    kingHunt: /\bking hunt|\bking-hunt|\bhunts? the king|\bking is hunted/.test(t),
    stalemate: /\bstalemate\b/.test(t),
    smotheredMate: /\bsmothered mate\b/.test(t),
    backRankMate: /\bback rank mate|\bback-rank mate|\bbackrank mate/.test(t),
    queenTrap: /\bqueen trap|\btraps? the queen\b/.test(t),
    fork: /\bfork\b|\bforked\b|\broyal fork\b|\bfamily fork\b/.test(t),
    pin: /\bpin\b|\bpinned\b/.test(t),
    skewer: /\bskewer\b/.test(t),
    perpetualCheck: /\bperpetual\b|\bperpetual check\b/.test(t),
    missedMate: /\bmissed mate\b|\bmisses mate\b/.test(t),
    blunder: /\bblunder\b|\bblundered\b|\bblunderfest\b|\bthrows? away\b/.test(t),
    flagged: /\bflag\b|\bflagged\b|\bflagging\b|\bflags\b|\bflag fall\b/.test(t),
  };
}

function semanticTagsFor(rec, textFlags) {
  const t = textBlob(rec);
  const pgn = rec.pgn || "";
  const plies = rec.plies || [];
  const tags = [];
  const addIf = (cond, ...vals) => { if (cond) tags.push(...vals); };
  tags.push(...catalogTagsFromText(t));

  addIf(/\bimmortal\b/.test(t), "immortal", "classic", "masterpiece");
  addIf(/\bbrillianc|\bbrilliant\b/.test(t), "brilliancy", "brilliant", "masterpiece");
  addIf(/\bmasterpiece\b|\bperfect game\b|\bmodel game\b/.test(t), "masterpiece", "model game", "perfect game");
  addIf(/\bcrazy\b|\binsane\b|\bwild\b|\bchaos\b|\bunbelievable\b|\bepic\b/.test(t), "crazy", "insane", "wild", "chaos");
  addIf(/\bdisaster\b|\bcollapse\b|\bblunder\b/.test(t), "disaster", "collapse", "blunder");
  addIf(/\bcomeback\b|\bturnaround\b/.test(t), "comeback");
  addIf(/\bswindle\b|\bdirty trick\b|\btrap\b/.test(t), "swindle", "trap", "trick");
  addIf(/\bupset\b|\bunderdog\b/.test(t), "upset", "underdog");

  addIf(/\bgreek gift\b|\bbxh7\b|\bbxh2\b/.test(t), "greek gift", "sac on h7", "sac on h2");
  addIf(/\bwindmill\b/.test(t), "windmill");
  addIf(/\bzwischenzug\b|\bintermezzo\b/.test(t), "zwischenzug", "intermezzo");
  addIf(/\bdiscovered attack\b/.test(t), "discovered attack");
  addIf(/\bdiscovered check\b/.test(t) || /[BRQ][a-h1-8x]*[a-h][1-8]\+/.test(pgn), "discovered check");
  addIf(/\bfork\b/.test(t), "fork");
  addIf(/\bpin\b|\bpinned\b/.test(t), "pin");
  addIf(/\bskewer\b/.test(t), "skewer");
  addIf(/\bdeflection\b|\bdecoy\b|\bclearance\b/.test(t), "deflection", "decoy", "clearance");
  addIf(/\brook lift\b/.test(t), "rook lift");
  addIf(/\bperpetual\b/.test(t), "perpetual check");
  addIf(/\bqueen trap\b|\btraps the queen\b/.test(t), "queen trap");
  addIf(/\bking walk\b|\bking march\b/.test(t), "king walk");
  addIf(textFlags.kingHunt, "king hunt");
  addIf(textFlags.stalemate, "stalemate", "stalemate trick");
  addIf(textFlags.smotheredMate, "smothered mate");
  addIf(textFlags.backRankMate, "back rank mate");

  addIf(/\bopposite side castl|\bopposite-side castl/.test(t), "opposite-side castling");
  addIf(plies.includes("O-O-O") && plies.includes("O-O"), "castling", "opposite-side castling");
  addIf(plies.includes("O-O-O"), "castles queenside");
  addIf(!plies.includes("O-O") && !plies.includes("O-O-O") && plies.length > 20, "no castling");
  addIf(/\brook endgame|\brook ending/.test(t), "rook endgame", "rook ending");
  addIf(/\bqueen endgame|\bqueen ending/.test(t), "queen endgame", "queen ending");
  addIf(/\bopposite colored bishops|\bopposite-colou?red bishops/.test(t), "opposite-colored bishops");
  addIf(/\bbishop pair|\btwo bishops/.test(t), "bishop pair", "two bishops");
  addIf(/\bknight vs bishop|\bbishop vs knight/.test(t), "knight vs bishop");
  addIf(/\bfortress\b/.test(t), "fortress");
  addIf(/\bzugzwang\b/.test(t), "zugzwang");
  addIf(/\bpassed pawn\b|\bpasser\b/.test(t), "passed pawn");
  addIf(/\bisolated queen pawn|\biqp\b/.test(t), "isolated queen pawn", "iqp");
  addIf(hasPromotion(rec), "promotion", "promotion race");
  addIf((rec.queenCount || 0) > 2, "many queens", "promoted queen");

  addIf(/\bblitz\b|\btitled tuesday\b|\bspeed chess\b/.test(t), "blitz", "titled tuesday", "speed chess");
  addIf(/\brapid\b/.test(t), "rapid");
  addIf(/\barmageddon\b/.test(t), "armageddon");
  addIf(/\bfreestyle\b|\bchess960\b|\bfischer random\b/.test(t), "freestyle", "chess960", "fischer random");
  addIf(/\bbonus game\b/.test(t), "bonus game");
  addIf(/\bgame of the day\b/.test(t), "game of the day");
  addIf(/\bpuzzle\b/.test(t), "puzzle");
  addIf(/\bround \d+\b|\bfinal round\b/.test(t), "round", "final round");

  addIf(/\bworld championship\b|\bworld champion\b/.test(t), "world champion");
  addIf(/\bcandidates\b/.test(t), "candidates");
  addIf(/\bworld cup\b/.test(t), "world cup");
  addIf(/\bnorway chess\b/.test(t), "norway chess");
  addIf(/\btata steel\b/.test(t), "tata steel");
  addIf(/\bsinquefield\b/.test(t), "sinquefield");
  addIf(/\bolympiad\b/.test(t), "olympiad");
  addIf(/\bgrand swiss\b/.test(t), "grand swiss");

  return [...new Set(tags)];
}

function normalizeTagFilter(value, category = null) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : String(value).split(/\s*,\s*/);
  return values
    .map((v) => plain(category ? `${category}:${v}` : v))
    .filter(Boolean);
}

function semanticTagHaystack(rec) {
  return derived(rec).semanticTags.map((tag) => plain(tag));
}

function matchesSemanticTag(rec, wanted) {
  const tags = semanticTagHaystack(rec);
  return tags.some((tag) => tag === wanted || tag.includes(wanted) || wanted.includes(tag));
}

function applySemanticFilters(pool, filters) {
  let out = pool;
  for (const wanted of filters.filter(Boolean)) {
    const next = out.filter((r) => matchesSemanticTag(r, wanted));
    // Semantic metadata is uneven. Treat tag filters as strict when the
    // catalogue has evidence for them; otherwise leave the pool intact and let
    // text ranking carry the fuzzy query.
    if (next.length) out = next;
  }
  return out;
}

function derived(rec) {
  if (DERIVED.has(rec)) return DERIVED.get(rec);
  const plies = sanTokens(rec);
  const textFlags = sacrificeTextFlags(rec);
  const checks = ((rec.pgn || "").match(/\+/g) || []).length + ((rec.pgn || "").match(/#/g) || []).length;
  const d = {
    openingTags: derivedOpeningTags(rec),
    durationSeconds: parseDurationSeconds(rec.duration),
    publishedMs: dateMs(rec.published),
    hasFen: Array.isArray(rec.fens) && rec.fens.length > 0,
    computer: isComputerName(rec.white) || isComputerName(rec.black),
    worldChampion: anyPlayerInSet(rec, WORLD_CHAMPION_KEYS) || /\bworld champion\b|\bworld championship\b/.test(textBlob(rec)),
    superGm: anyPlayerInSet(rec, SUPER_GM_KEYS) || /\bsuper ?gm\b|\bsuper grandmaster\b/.test(textBlob(rec)),
    women: anyPlayerInSet(rec, WOMEN_PLAYER_KEYS) || /\bwomens?\b|\bwomen s\b|\bfemale\b/.test(textBlob(rec)),
    promotion: hasPromotion(rec),
    pieceSac: Boolean(rec.queenSac || textFlags.rookSac || textFlags.bishopSac || textFlags.knightSac),
    kingHunt: textFlags.kingHunt || checks >= 7,
    ...textFlags,
  };
  d.semanticTags = semanticTagsFor(rec, d);
  DERIVED.set(rec, d);
  return d;
}

function matchesOpeningFamily(rec, value) {
  const o = plain(value);
  if (!o) return true;
  return derived(rec).openingTags.some((tag) => plain(tag).includes(o)) || plain(rec.opening).includes(o);
}

function parseMoveText(s) {
  if (!String(s || "").trim()) return [];
  const toks = String(s)
    .replace(/(\d+)\.(\.\.)?/g, " $1.$2 ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  let n = 1;
  let side = "w";
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

function matchesMoveEntries(rec, entries) {
  return entries.every((m) => {
    const idx = (Number(m.n) - 1) * 2 + (m.side === "b" ? 1 : 0);
    const san = String(m.san || "").replace(/[+#!?]/g, "");
    return rec.plies && rec.plies[idx] === san;
  });
}

function parseDurationInput(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const s = String(value).trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(\d+(?:\.\d+)?)(s|m|h)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === "h") return n * 3600;
  if (m[2] === "m") return n * 60;
  return n;
}

const PLAYER_ALIASES = {
  magnus: "Magnus Carlsen",
  carlsen: "Magnus Carlsen",
  hikaru: "Hikaru Nakamura",
  naka: "Hikaru Nakamura",
  fabi: "Fabiano Caruana",
  fabiano: "Fabiano Caruana",
  pragg: "Praggnanandhaa R",
  praggnanandhaa: "Praggnanandhaa R",
  gukesh: "Gukesh D",
  alireza: "Alireza Firouzja",
  nepo: "Ian Nepomniachtchi",
  ding: "Ding Liren",
  anand: "Viswanathan Anand",
  kasparov: "Garry Kasparov",
  fischer: "Robert James Fischer",
  tal: "Mikhail Tal",
  capablanca: "Jose Raul Capablanca",
  morphy: "Paul Morphy",
};

let PLAYER_INDEX = null;
function playerIndex(recs) {
  if (PLAYER_INDEX) return PLAYER_INDEX;
  const counts = new Map();
  for (const r of recs) {
    for (const name of [r.white, r.black]) {
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  const names = [...counts.keys()].sort((a, b) => b.length - a.length);
  const lastCounts = new Map();
  for (const name of names) {
    const last = plain(name).split(" ").at(-1);
    if (last && last.length >= 4) lastCounts.set(last, (lastCounts.get(last) || 0) + 1);
  }
  const aliases = new Map(Object.entries(PLAYER_ALIASES));
  for (const name of names) {
    aliases.set(plain(name), name);
    const last = plain(name).split(" ").at(-1);
    if (last && last.length >= 4 && lastCounts.get(last) === 1) aliases.set(last, name);
  }
  PLAYER_INDEX = { names, aliases };
  return PLAYER_INDEX;
}

function playersInQuery(query, recs) {
  const p = ` ${plain(query)} `;
  const out = [];
  const seen = new Set();
  const { aliases } = playerIndex(recs);
  for (const [alias, name] of aliases.entries()) {
    if (!alias || alias.length < 3) continue;
    const idx = p.indexOf(` ${alias} `);
    if (idx >= 0 && !seen.has(name)) {
      out.push({ name, idx });
      seen.add(name);
    }
  }
  return out.sort((a, b) => a.idx - b.idx).map((x) => x.name);
}

function yearsAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function inferQueryOptions(query, recs) {
  const raw = String(query || "");
  const p = plain(raw);
  const inferred = { semanticTags: [] };
  if (!p) return inferred;

  const mentionedPlayers = playersInQuery(raw, recs);
  const hasTwoPlayers = mentionedPlayers.length >= 2;

  if (hasTwoPlayers && /\b(vs|versus|against|between)\b/.test(p)) {
    inferred.versus = mentionedPlayers.slice(0, 2);
  }

  if (hasTwoPlayers && /\b(beat|beats|defeated|defeats|crushed|destroyed|won against|wins against)\b/.test(p)) {
    inferred.versus = mentionedPlayers.slice(0, 2);
    inferred.winner = mentionedPlayers[0];
  }
  if (hasTwoPlayers && /\b(lost to|loses to|loss to)\b/.test(p)) {
    inferred.versus = mentionedPlayers.slice(0, 2);
    inferred.winner = mentionedPlayers[1];
  }
  if (inferred.winner && /\b(with|as) black\b/.test(p)) {
    inferred.black = inferred.winner;
    inferred.result = "black";
  }
  if (inferred.winner && /\b(with|as) white\b/.test(p)) {
    inferred.white = inferred.winner;
    inferred.result = "white";
  }

  if (/\bwins? with black\b|\bwon with black\b|\bblack wins?\b/.test(p)) {
    inferred.result = "black";
    if (mentionedPlayers[0]) {
      inferred.winner = mentionedPlayers[0];
      inferred.black = mentionedPlayers[0];
    }
  }
  if (/\bwins? with white\b|\bwon with white\b|\bwhite wins?\b/.test(p)) {
    inferred.result = "white";
    if (mentionedPlayers[0]) {
      inferred.winner = mentionedPlayers[0];
      inferred.white = mentionedPlayers[0];
    }
  }
  if (/\blost as white\b|\bloses as white\b/.test(p) && mentionedPlayers[0]) {
    inferred.white = mentionedPlayers[0];
    inferred.result = "black";
  }
  if (/\blost as black\b|\bloses as black\b/.test(p) && mentionedPlayers[0]) {
    inferred.black = mentionedPlayers[0];
    inferred.result = "white";
  }
  if (/\bdraws? only\b|\bonly draws?\b|\bdrawn games?\b/.test(p)) inferred.draw = true;
  if (/\bdecisive\b|\bno draws?\b/.test(p)) inferred.decisive = true;

  const lessMoves = p.match(/\b(?:less than|fewer than|under)\s+(\d+)\s+moves?\b/);
  if (lessMoves) inferred.maxMoves = Math.max(0, Number(lessMoves[1]) - 1);
  const atMostMoves = p.match(/\b(?:at most|no more than|maximum|max)\s+(\d+)\s+moves?\b/);
  if (atMostMoves) inferred.maxMoves = Number(atMostMoves[1]);
  const moreMoves = p.match(/\b(?:more than|over)\s+(\d+)\s+moves?\b/);
  if (moreMoves) inferred.minMoves = Number(moreMoves[1]) + 1;
  const atLeastMoves = p.match(/\b(?:at least|minimum|min)\s+(\d+)\s+moves?\b/);
  if (atLeastMoves) inferred.minMoves = Number(atLeastMoves[1]);
  if (/\bminiatures?\b/.test(p)) inferred.miniature = true;
  if (/\bendgames?\b|\blong games?\b/.test(p) && !/\blong videos?\b|\blong analysis\b/.test(p)) inferred.endgame = true;

  const underMinutes = p.match(/\b(?:under|less than|shorter than)\s+(\d+)\s*(?:min|mins|minutes?)\b/);
  if (underMinutes) inferred.maxDuration = `${Number(underMinutes[1])}m`;
  const overMinutes = p.match(/\b(?:over|more than|longer than)\s+(\d+)\s*(?:min|mins|minutes?)\b/);
  if (overMinutes) inferred.minDuration = `${Number(overMinutes[1])}m`;
  if (/\bshort\b.*\bvideos?\b|\bvideos?\b.*\bshort\b|\bquick\b.*\bvideos?\b/.test(p)) inferred.duration = "short";
  if (/\blong\b.*\bvideos?\b|\bvideos?\b.*\blong\b|\blong analysis\b/.test(p)) inferred.duration = "long";

  if (/\blatest\b|\bnewest\b/.test(p)) inferred.publishedFrom = yearsAgo(365);
  if (/\brecent\b/.test(p)) inferred.publishedFrom = yearsAgo(730);
  if (/\bold agadmator\b|\bold videos?\b|\bearly videos?\b/.test(p)) inferred.publishedTo = "2018-01-01";
  if (/\bold masters?\b|\bsoviet classics?\b|\bhistorical\b|\bclassic games?\b/.test(p)) inferred.era = "historical";
  if (/\bmodern super ?gm\b|\bmodern\b/.test(p)) inferred.era = "modern";
  if (/\bengine games?\b|\bcomputer games?\b|\balphazero\b|\bstockfish\b|\bleela\b/.test(p)) inferred.computer = true;
  if (/\bhuman games?\b|\bhuman only\b|\bno engines?\b/.test(p)) inferred.humanOnly = true;
  const inferredOpening = openingFamilyFromQuery(raw);
  if (inferredOpening) inferred.openingFamily = inferredOpening;
  if (mentionedPlayers[0]) {
    if (/\b(as|with)\s+white\b/.test(p)) inferred.white = mentionedPlayers[0];
    if (/\b(as|with)\s+black\b/.test(p)) inferred.black = mentionedPlayers[0];
  }
  if (mentionedPlayers[0] && inferredOpening) {
    const openingSide = likelyOpeningSide(inferredOpening);
    const op = plain(inferredOpening);
    const withOpening = p.includes(`with the ${op}`) || p.includes(`with ${op}`) || p.includes(`plays the ${op}`) || p.includes(`plays ${op}`);
    const againstOpening = p.includes(`against the ${op}`) || p.includes(`against ${op}`) || p.includes(`beat the ${op}`) || p.includes(`beats the ${op}`);
    if (withOpening && openingSide === "white") inferred.white = mentionedPlayers[0];
    if (withOpening && openingSide === "black") inferred.black = mentionedPlayers[0];
    if (againstOpening && openingSide === "white") inferred.black = mentionedPlayers[0];
    if (againstOpening && openingSide === "black") inferred.white = mentionedPlayers[0];
  }
  if (/\bcandidates\b/.test(p)) inferred.event = "Candidates";
  if (/\bworld cup\b/.test(p)) inferred.event = "World Cup";
  if (/\bnorway chess\b/.test(p)) inferred.event = "Norway Chess";
  if (/\btata steel\b/.test(p)) inferred.event = "Tata Steel";
  if (/\bsinquefield\b/.test(p)) inferred.event = "Sinquefield";
  if (/\bolympiad\b/.test(p)) inferred.event = "Olympiad";
  if (/\bgrand swiss\b/.test(p)) inferred.event = "Grand Swiss";

  if (/\bqueen sacs?\b|\bqueen sacrifice\b/.test(p)) inferred.queenSac = true;
  if (/\brook sacs?\b|\brook sacrifice\b/.test(p)) inferred.rookSac = true;
  if (/\bbishop sacs?\b|\bbishop sacrifice\b/.test(p)) inferred.bishopSac = true;
  if (/\bknight sacs?\b|\bknight sacrifice\b/.test(p)) inferred.knightSac = true;
  if (/\bexchange sacs?\b|\bexchange sacrifice\b/.test(p)) inferred.exchangeSac = true;
  if (/\bpiece sacs?\b|\bpiece sacrifice\b|\bdouble sacrifice\b/.test(p)) inferred.pieceSac = true;
  if (/\bking hunt\b|\bking walk\b|\bking march\b/.test(p)) inferred.kingHunt = true;
  if (/\bstalemate\b/.test(p)) inferred.stalemate = true;
  if (/\bsmothered mate\b/.test(p)) inferred.smotheredMate = true;
  if (/\bback rank\b|\bbackrank\b/.test(p)) inferred.backRankMate = true;
  const motifHits = [];
  if (/\bqueen traps?\b|\btraps? the queen\b/.test(p)) motifHits.push("queenTrap");
  if (/\bforks?\b|\bforked\b|\broyal fork\b|\bfamily fork\b/.test(p)) motifHits.push("fork");
  if (/\bpins?\b|\bpinned\b/.test(p)) motifHits.push("pin");
  if (/\bskewers?\b/.test(p)) motifHits.push("skewer");
  if (/\bperpetual\b|\bperpetual check\b/.test(p)) motifHits.push("perpetualCheck");
  if (/\bmissed mate\b|\bmisses mate\b/.test(p)) motifHits.push("missedMate");
  if (motifHits.length === 1) inferred[motifHits[0]] = true;
  else if (motifHits.length > 1) inferred.anyMotifs = motifHits;
  if (/\bunderpromotion\b/.test(p)) inferred.underpromotion = true;
  if (/\bpromotion race\b|\bpromotions?\b/.test(p)) inferred.promotion = true;
  if (/\bblunders?\b|\bblundered\b|\bblunderfest\b|\bthrows? away\b/.test(p)) inferred.blunder = true;
  if (/\bflag\b|\bflagged\b|\bflagging\b|\bflags\b|\bflag fall\b/.test(p)) inferred.flagged = true;
  if (/\bworld champions?\b|\bworld championship games?\b|\bworld champion games?\b/.test(p)) inferred.worldChampion = true;
  if (/\bsuper ?gms?\b|\bsuper grandmasters?\b|\belite gms?\b|\belite grandmasters?\b/.test(p)) inferred.superGm = true;
  if (/\bwomens?\b|\bwomen s\b|\bfemale players?\b|\bgirls?\b/.test(p)) inferred.women = true;
  if (!inferred.smotheredMate && !inferred.backRankMate && /\bcheckmate\b|\bmates?\b/.test(p)) {
    inferred.checkmate = true;
  }

  inferred.semanticTags.push(...catalogTagsFromText(p).filter((tag) => !tag.includes(":")));
  const tagIf = (cond, ...tags) => {
    if (cond) inferred.semanticTags.push(...tags);
  };
  tagIf(/\bclassical\b/.test(p), "classical", "format:classical");
  tagIf(/\brapid\b/.test(p), "rapid", "format:rapid");
  tagIf(/\bblitz\b|\btitled tuesday\b|\bspeed chess\b/.test(p), "blitz", "titled tuesday", "speed chess", "format:blitz");
  tagIf(/\bbullet\b/.test(p), "bullet", "format:bullet");
  tagIf(/\barmageddon\b/.test(p), "armageddon", "format:armageddon");
  tagIf(/\bfreestyle\b|\bchess960\b|\bfischer random\b/.test(p), "freestyle", "chess960", "fischer random", "format:freestyle");
  tagIf(/\bfinal game\b/.test(p), "final game", "format:final game");
  tagIf(/\bfinal round\b/.test(p), "final round", "format:final round");
  tagIf(/\btiebreak\b|\btie break\b/.test(p), "tiebreak", "format:tiebreak");
  tagIf(/\bmust win\b|\bmust-win\b/.test(p), "must win", "format:must win");
  tagIf(/\bbonus games?\b/.test(p), "bonus game");
  tagIf(/\bgame of the day\b/.test(p), "game of the day");
  tagIf(/\bpuzzles?\b/.test(p), "puzzle");

  tagIf(/\bqueenless\b|\bearly queen trade\b|\bqueen trade\b/.test(p), "queenless middlegame", "material:queenless middlegame");
  tagIf(/\brook endgames?\b|\brook endings?\b|\brook and pawn\b/.test(p), "rook endgame", "material:rook endgame");
  tagIf(/\bqueen endgames?\b|\bqueen endings?\b/.test(p), "queen endgame", "material:queen endgame");
  tagIf(/\bpawn endgames?\b|\bpawn endings?\b|\bking and pawn\b/.test(p), "pawn endgame", "material:pawn endgame");
  tagIf(/\bknight endgames?\b|\bknight endings?\b/.test(p), "knight endgame", "material:knight endgame");
  tagIf(/\bopposite colo(?:u)?red bishops?\b/.test(p), "opposite-colored bishops", "material:opposite-colored bishops");
  tagIf(/\bsame colo(?:u)?red bishops?\b/.test(p), "same-colored bishops", "material:same-colored bishops");
  tagIf(/\bbishop pair\b|\btwo bishops\b/.test(p), "bishop pair", "material:bishop pair");
  tagIf(/\bbishop vs knight\b|\bknight vs bishop\b/.test(p), "bishop vs knight", "material:bishop vs knight");
  tagIf(/\bpassed pawns?\b|\bpassers?\b/.test(p), "passed pawn", "material:passed pawn");
  tagIf(/\boutside passers?\b|\boutside passed pawn\b/.test(p), "outside passer", "material:outside passer");
  tagIf(/\bconnected passed pawns?\b/.test(p), "connected passed pawns", "material:connected passed pawns");
  tagIf(/\bisolated pawns?\b|\bisolated queen pawn\b|\biqp\b/.test(p), "isolated pawn", "isolated queen pawn", "iqp", "material:isolated pawn");
  tagIf(/\bhanging pawns?\b/.test(p), "hanging pawns", "material:hanging pawns");
  tagIf(/\bbackward pawns?\b/.test(p), "backward pawn", "material:backward pawn");
  tagIf(/\bfortress\b/.test(p), "fortress");
  tagIf(/\bzugzwang\b/.test(p), "zugzwang");

  tagIf(/\bopposite side castl|\bopposite-side castl/.test(p), "opposite-side castling", "phase:opposite-side castling");
  tagIf(/\bqueenside castl|\bcastle queenside|\bcastles queenside\b/.test(p), "castles queenside", "phase:castles queenside");
  tagIf(/\bno castling\b|\bwithout castling\b|\bnever castled\b/.test(p), "no castling", "phase:no castling");
  tagIf(/\bopening traps?\b|\btrap in the opening\b/.test(p), "opening trap", "phase:opening trap", "openingStyle:opening trap");
  tagIf(/\bmain line\b|\bmainline\b/.test(p), "main line", "openingStyle:main line");
  tagIf(/\bnovelt(?:y|ies)\b|\bnew idea\b|\bnew opening idea\b/.test(p), "novelty", "openingStyle:novelty");
  tagIf(/\brefutation\b|\brefuted\b|\bpunish(?:es)? bad opening\b/.test(p), "refutation", "openingStyle:refutation");
  tagIf(/\brare openings?\b|\boffbeat\b|\bsidelines?\b/.test(p), "rare opening", "offbeat", "sideline", "openingStyle:rare opening");
  tagIf(/\bsharp openings?\b|\bsharp\b/.test(p), "sharp opening", "openingStyle:sharp opening");
  tagIf(/\bsolid openings?\b|\bsolid\b/.test(p), "solid opening", "openingStyle:solid opening");
  tagIf(/\bdubious gambits?\b/.test(p), "dubious gambit", "openingStyle:dubious gambit");

  tagIf(/\bbeautiful\b|\bbeauty\b/.test(p), "beautiful", "emotion:beautiful");
  tagIf(/\bbrutal\b|\bsavage\b|\bno mercy\b/.test(p), "brutal", "emotion:brutal");
  tagIf(/\bclinical\b|\btechnical win\b|\bgrind\b/.test(p), "clinical", "emotion:clinical");
  tagIf(/\bquiet moves?\b/.test(p), "quiet move", "emotion:quiet move");
  tagIf(/\bgenius moves?\b|\bbrilliant moves?\b/.test(p), "genius move", "emotion:genius move");
  tagIf(/\bridiculous moves?\b/.test(p), "ridiculous move", "emotion:ridiculous move");
  tagIf(/\bdefensive masterpiece\b/.test(p), "defensive masterpiece", "emotion:defensive masterpiece");
  tagIf(/\battacking masterpiece\b/.test(p), "attacking masterpiece", "emotion:attacking masterpiece");

  tagIf(/\bwinning but blundered\b|\bthrew away a win\b|\bthrows away a win\b/.test(p), "winning but blundered", "resultStory:winning but blundered");
  tagIf(/\bdead lost\b|\bcompletely lost\b/.test(p), "dead lost", "resultStory:dead lost");
  tagIf(/\bmissed mate\b|\bmisses mate\b/.test(p), "missed mate", "resultStory:missed mate");
  tagIf(/\bmissed win\b|\bmisses win\b|\bone move from victory\b/.test(p), "missed win", "resultStory:missed win");
  tagIf(/\bonly moves?\b/.test(p), "only move", "resultStory:only move");
  tagIf(/\bbest moves?\b/.test(p), "best move", "resultStory:best move");
  tagIf(/\bblunderfest\b/.test(p), "blunderfest", "resultStory:blunderfest");
  tagIf(/\btime trouble\b|\btime scramble\b|\bscramble\b/.test(p), "time trouble", "resultStory:time trouble");
  tagIf(/\bflagged\b|\bflags\b|\bflag fall\b/.test(p), "flagged", "resultStory:flagged");
  tagIf(/\bresigns?\b|\bresignation\b/.test(p), "resignation", "resultStory:resignation");
  tagIf(/\bquick draws?\b/.test(p), "quick draw", "resultStory:quick draw");
  tagIf(/\bfighting draws?\b/.test(p), "fighting draw", "resultStory:fighting draw");

  tagIf(/\bworld champion loses\b|\bworld champion lost\b/.test(p), "world champion loses", "playerStory:world champion loses");
  tagIf(/\bprodig(?:y|ies)\b|\bteenagers?\b|\bteen beats\b|\b\d+\s*year old\b/.test(p), "prodigy", "playerStory:prodigy");
  tagIf(/\byoungster beats legend\b|\bprodigy beats\b|\bteen beats\b/.test(p), "youngster beats legend", "playerStory:youngster beats legend");
  tagIf(/\bunderdogs?\b|\blower rated\b/.test(p), "underdog", "playerStory:underdog");
  tagIf(/\bwomens?\b|\bwomen s\b|\bfemale\b/.test(p), "women", "playerStory:women");

  for (const tag of [
    "immortal", "brilliancy", "masterpiece", "crazy", "disaster", "comeback", "swindle",
    "greek gift", "windmill", "zwischenzug", "fork", "pin", "skewer", "deflection",
    "queen trap", "rook lift", "perpetual check", "fortress", "zugzwang", "rook endgame",
    "queen endgame", "opposite-side castling", "bishop pair", "passed pawn", "world champion",
    "candidates", "world cup", "norway chess", "tata steel", "grand swiss",
  ]) {
    if (p.includes(plain(tag))) inferred.semanticTags.push(tag);
  }
  inferred.semanticTags = [...new Set(inferred.semanticTags)];

  return inferred;
}

function scoreRecord(rec, groups) {
  const haystacks = {};
  for (const f of Object.keys(WEIGHTS)) haystacks[f] = norm(fieldText(rec, f));

  let base = 0;
  let matched = 0;
  for (const group of groups) {
    let groupScore = 0;
    for (const [field, weight] of Object.entries(WEIGHTS)) {
      let best = 0;
      for (const tok of group) {
        if (haystacks[field].includes(tok)) {
          // Whole-word match scores higher than a substring match.
          const whole = new RegExp(`\\b${tok}\\b`).test(haystacks[field]);
          best = Math.max(best, weight * (whole ? 1 : 0.6));
        }
      }
      groupScore += best; // synonyms within a group don't double-count per field
    }
    if (groupScore > 0) {
      matched++;
      base += groupScore;
    }
  }
  // Coverage multiplier: matching MORE distinct query concepts dominates matching
  // a single concept very strongly. This floats "najdorf + queen sac" above the
  // sea of generic queen sacrifices.
  return base * Math.pow(matched, 1.5);
}

/**
 * Search the catalogue.
 * @param {object} opts
 * @param {string} [opts.query]   free text ("queen sacrifice najdorf")
 * @param {string} [opts.player]  filter: appears as white or black
 * @param {string} [opts.eco]     filter: ECO code prefix ("B9", "B90")
 * @param {string} [opts.opening] filter: opening name substring ("najdorf")
 * @param {string|number} [opts.year] filter: exact year
 * @param {number} [opts.limit]   default 5
 */
export function searchGames(opts = {}) {
  const key = cacheKey(opts);
  const cached = SEARCH_CACHE.get(key);
  if (cached) {
    SEARCH_CACHE.delete(key); // LRU touch: move to most-recently-used
    SEARCH_CACHE.set(key, cached);
    return cached;
  }
  const recs = load();
  const inferred = inferQueryOptions(opts.query || "", recs);
  const hasInferredFilters = Object.entries(inferred).some(
    ([k, v]) => k !== "semanticTags" && v != null && v !== false
  );
  opts = {
    ...inferred,
    ...opts,
    semanticTags: [...(inferred.semanticTags || []), ...(opts.semanticTags || [])],
  };
  const {
    query = "",
    semanticTags,
    tags,
    tag,
    motif,
    material,
    pawnStructure,
    phase,
    format,
    timeControl,
    emotion,
    mood,
    story,
    resultStory,
    playerStory,
    openingStyle,
    matePattern,
    anyMotifs,
    worldChampion,
    superGm,
    women,
    player,
    eco,
    opening,
    year,
    queenSac,
    underpromotion,
    b4,
    minQueens,
    minMoves,
    maxMoves,
    moves,
    startsWith,
    white,
    black,
    versus,
    players,
    winner,
    result,
    decisive,
    draw,
    event,
    yearFrom,
    yearTo,
    publishedFrom,
    publishedTo,
    minDuration,
    maxDuration,
    duration,
    era,
    openingFamily,
    hasMoves,
    hasFen,
    computer,
    humanOnly,
    checkmate,
    promotion,
    rookSac,
    bishopSac,
    knightSac,
    pieceSac,
    exchangeSac,
    kingHunt,
    stalemate,
    smotheredMate,
    backRankMate,
    queenTrap,
    fork,
    pin,
    skewer,
    perpetualCheck,
    missedMate,
    blunder,
    flagged,
    miniature,
    short,
    endgame,
    limit = 5,
  } = opts;
  const tokens = tokenize(query);
  const openingNeedle = openingQueryNeedle(query);

  let pool = recs;
  if (openingNeedle) {
    pool = pool.filter((r) => derivedOpeningTags(r).some((tag) => norm(tag).includes(openingNeedle)));
  }
  if (player) {
    const p = norm(player);
    pool = pool.filter((r) => norm(r.white).includes(p) || norm(r.black).includes(p));
  }
  const versusNames = Array.isArray(versus)
    ? versus
    : typeof versus === "string"
      ? versus.split(/\s+v(?:s\.?)?\s+|\s*,\s*/i)
      : Array.isArray(players)
        ? players
        : typeof players === "string"
          ? players.split(/\s+v(?:s\.?)?\s+|\s*,\s*/i)
          : [];
  if (versusNames.filter(Boolean).length >= 2) {
    const wanted = versusNames.filter(Boolean).map((p) => norm(p));
    pool = pool.filter((r) => {
      const sides = [norm(r.white), norm(r.black)];
      return wanted.every((p) => sides.some((side) => side.includes(p)));
    });
  }
  if (event) {
    const e = plain(event);
    pool = pool.filter((r) => plain([r.event, r.title, r.desc].filter(Boolean).join(" ")).includes(e));
  }
  if (eco) {
    const e = norm(eco);
    pool = pool.filter((r) => norm(r.eco).startsWith(e));
  }
  if (opening) {
    pool = pool.filter((r) => matchesOpeningFamily(r, opening));
  }
  if (openingFamily) {
    pool = pool.filter((r) => matchesOpeningFamily(r, openingFamily));
  }
  if (year != null && year !== "") {
    const y = String(year);
    pool = pool.filter((r) => String(r.year) === y);
  }
  // Side-specific players (also gives strict head-to-head when both are set).
  if (white) {
    const w = norm(white);
    pool = pool.filter((r) => norm(r.white).includes(w));
  }
  if (black) {
    const b = norm(black);
    pool = pool.filter((r) => norm(r.black).includes(b));
  }
  // Outcome. Accepts "white"/"1-0", "black"/"0-1", "draw".
  if (result) {
    const want = norm(result);
    pool = pool.filter((r) => {
      if (want === "draw") return r.result === "½-½" || r.result === "1/2-1/2";
      if (want === "white" || want === "1-0") return r.result === "1-0";
      if (want === "black" || want === "0-1") return r.result === "0-1";
      return true;
    });
  }
  if (decisive) pool = pool.filter((r) => r.result === "1-0" || r.result === "0-1");
  if (draw) pool = pool.filter((r) => resultIsDraw(r.result));
  // Winner by name, regardless of color (handles "X won").
  if (winner) {
    const w = norm(winner);
    pool = pool.filter(
      (r) =>
        (r.result === "1-0" && norm(r.white).includes(w)) ||
        (r.result === "0-1" && norm(r.black).includes(w))
    );
  }
  // Year range.
  if (yearFrom != null) pool = pool.filter((r) => r.year && Number(r.year) >= yearFrom);
  if (yearTo != null) pool = pool.filter((r) => r.year && Number(r.year) <= yearTo);
  if (era) {
    const e = plain(era);
    pool = pool.filter((r) => {
      const y = Number(r.year);
      if (!y && e !== "engine") return false;
      if (e === "classical" || e === "historic" || e === "historical") return y > 0 && y < 1950;
      if (e === "modern") return y >= 1950;
      if (e === "contemporary" || e === "recent") return y >= 2000;
      if (e === "engine" || e === "computer") return derived(r).computer;
      return true;
    });
  }
  if (publishedFrom) {
    const from = dateMs(publishedFrom);
    if (from != null) pool = pool.filter((r) => derived(r).publishedMs != null && derived(r).publishedMs >= from);
  }
  if (publishedTo) {
    const to = dateMs(publishedTo);
    if (to != null) pool = pool.filter((r) => derived(r).publishedMs != null && derived(r).publishedMs <= to);
  }
  const minDur = parseDurationInput(minDuration);
  const maxDur = parseDurationInput(maxDuration);
  if (minDur != null) pool = pool.filter((r) => derived(r).durationSeconds >= minDur);
  if (maxDur != null) pool = pool.filter((r) => derived(r).durationSeconds > 0 && derived(r).durationSeconds <= maxDur);
  if (duration) {
    const d = plain(duration);
    if (d === "short") pool = pool.filter((r) => derived(r).durationSeconds > 0 && derived(r).durationSeconds <= 10 * 60);
    else if (d === "medium") pool = pool.filter((r) => derived(r).durationSeconds > 10 * 60 && derived(r).durationSeconds <= 20 * 60);
    else if (d === "long") pool = pool.filter((r) => derived(r).durationSeconds > 20 * 60);
  }
  if (checkmate) pool = pool.filter((r) => r.checkmate);
  if (hasFen) pool = pool.filter((r) => derived(r).hasFen);
  if (computer) pool = pool.filter((r) => derived(r).computer);
  if (humanOnly) pool = pool.filter((r) => !derived(r).computer);
  if (worldChampion) pool = pool.filter((r) => derived(r).worldChampion);
  if (superGm) pool = pool.filter((r) => derived(r).superGm);
  if (women) pool = pool.filter((r) => derived(r).women);
  // Move/PGN-derived filters (precomputed at index build).
  if (queenSac) pool = pool.filter((r) => r.queenSac);
  if (underpromotion) pool = pool.filter((r) => r.underpromotion);
  if (b4) pool = pool.filter((r) => r.b4);
  if (promotion) pool = pool.filter((r) => derived(r).promotion);
  if (rookSac) pool = pool.filter((r) => derived(r).rookSac);
  if (bishopSac) pool = pool.filter((r) => derived(r).bishopSac);
  if (knightSac) pool = pool.filter((r) => derived(r).knightSac);
  if (pieceSac) pool = pool.filter((r) => derived(r).pieceSac);
  if (exchangeSac) pool = pool.filter((r) => derived(r).exchangeSac);
  if (kingHunt) pool = pool.filter((r) => derived(r).kingHunt);
  if (stalemate) pool = pool.filter((r) => derived(r).stalemate);
  if (smotheredMate) pool = pool.filter((r) => derived(r).smotheredMate);
  if (backRankMate) pool = pool.filter((r) => derived(r).backRankMate);
  if (Array.isArray(anyMotifs) && anyMotifs.length) {
    pool = pool.filter((r) => anyMotifs.some((key) => Boolean(derived(r)[key])));
  }
  if (queenTrap) pool = pool.filter((r) => derived(r).queenTrap);
  if (fork) pool = pool.filter((r) => derived(r).fork);
  if (pin) pool = pool.filter((r) => derived(r).pin);
  if (skewer) pool = pool.filter((r) => derived(r).skewer);
  if (perpetualCheck) pool = pool.filter((r) => derived(r).perpetualCheck);
  if (missedMate) pool = pool.filter((r) => derived(r).missedMate);
  if (blunder) pool = pool.filter((r) => derived(r).blunder);
  if (flagged) pool = pool.filter((r) => derived(r).flagged);
  if (minQueens != null) pool = pool.filter((r) => (r.queenCount || 0) >= minQueens);
  if (minMoves != null) pool = pool.filter((r) => (r.moves || 0) >= minMoves);
  if (maxMoves != null) pool = pool.filter((r) => (r.moves || 0) <= maxMoves);
  if (miniature) pool = pool.filter((r) => (r.moves || 0) > 0 && (r.moves || 0) <= 25);
  if (short) pool = pool.filter((r) => (r.moves || 0) > 0 && (r.moves || 0) <= 35);
  if (endgame) pool = pool.filter((r) => (r.moves || 0) >= 60);
  if (startsWith) {
    const parsed = Array.isArray(startsWith) ? startsWith : parseMoveText(startsWith);
    if (parsed.length) pool = pool.filter((r) => matchesMoveEntries(r, parsed));
  }
  // Move-by-index filter: every {n, side, san} must match the game's ply list.
  // ply index = (n-1)*2 + (side==="b" ? 1 : 0). san matched after stripping marks.
  if (Array.isArray(moves) && moves.length) {
    pool = pool.filter((r) => matchesMoveEntries(r, moves));
  }
  // "Move played anywhere in the game" — every SAN in hasMoves must appear at
  // some ply, regardless of move number (e.g. O-O-O, Nf5, exd6).
  if (Array.isArray(hasMoves) && hasMoves.length) {
    const wanted = hasMoves.map((s) => String(s).replace(/[+#!?]/g, ""));
    pool = pool.filter((r) => {
      const set = new Set(r.plies || []);
      return wanted.every((s) => set.has(s));
    });
  }
  const semanticFilters = [
    ...normalizeTagFilter(semanticTags),
    ...normalizeTagFilter(tags),
    ...normalizeTagFilter(tag),
    ...normalizeTagFilter(motif, "motif"),
    ...normalizeTagFilter(matePattern, "motif"),
    ...normalizeTagFilter(material, "material"),
    ...normalizeTagFilter(pawnStructure, "material"),
    ...normalizeTagFilter(phase, "phase"),
    ...normalizeTagFilter(format, "format"),
    ...normalizeTagFilter(timeControl, "format"),
    ...normalizeTagFilter(emotion, "emotion"),
    ...normalizeTagFilter(mood, "emotion"),
    ...normalizeTagFilter(story),
    ...normalizeTagFilter(resultStory, "resultStory"),
    ...normalizeTagFilter(playerStory, "playerStory"),
    ...normalizeTagFilter(openingStyle, "openingStyle"),
  ];
  if (semanticFilters.length) pool = applySemanticFilters(pool, semanticFilters);

  let scored;
  if (tokens.length) {
    scored = pool
      .map((r) => ({ r, s: scoreRecord(r, tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || String(b.r.published).localeCompare(String(a.r.published)));
    if (!scored.length && hasInferredFilters) scored = pool.map((r) => ({ r, s: 0 }));
  } else {
    // No free text → just newest-first within the filtered pool.
    scored = pool.map((r) => ({ r, s: 0 }));
  }

  const out = scored.slice(0, limit).map((x) => summarize(x.r, x.s));
  SEARCH_CACHE.set(key, out);
  if (SEARCH_CACHE.size > SEARCH_CACHE_MAX) {
    SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value); // evict oldest
  }
  return out;
}

export function getGame(id) {
  return load().find((r) => r.id === id) || null;
}

// Lean shape for search results — defers heavy fields (pgn, full desc) to getGame.
export function summarize(rec, score) {
  const portraits = loadPortraits();
  const portraitSummary = (portrait) =>
    portrait
      ? {
          portraitUrl: portrait.portraitUrl,
          license: portrait.license,
          sourcePage: portrait.sourcePage,
        }
      : null;
  const players =
    rec.white || rec.black ? `${rec.white || "?"}–${rec.black || "?"}` : null;
  return {
    id: rec.id,
    title: rec.title,
    players,
    white: rec.white,
    black: rec.black,
    portraits: {
      ...(rec.white && portraits[rec.white] ? { white: portraitSummary(portraits[rec.white]) } : {}),
      ...(rec.black && portraits[rec.black] ? { black: portraitSummary(portraits[rec.black]) } : {}),
    },
    year: rec.year,
    eco: rec.eco,
    opening: rec.opening,
    result: rec.result,
    url: rec.url,
    ...(rec.queenSac ? { queenSac: true } : {}),
    ...(score != null ? { _score: Math.round(score * 10) / 10 } : {}),
  };
}
