#!/usr/bin/env node
// Quick CLI to exercise the search core without an MCP client.
//   node bin/query.js "queen sacrifice najdorf"
//   node bin/query.js --player Tal --eco B
//   node bin/query.js --opening "najdorf" "queen sacrifice"

import { searchGames } from "../src/search.js";

const argv = process.argv.slice(2);
const opts = { limit: 8 };
const free = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--player") opts.player = argv[++i];
  else if (a === "--players") opts.players = argv[++i];
  else if (a === "--versus") opts.versus = argv[++i];
  else if (a === "--event") opts.event = argv[++i];
  else if (a === "--eco") opts.eco = argv[++i];
  else if (a === "--opening") opts.opening = argv[++i];
  else if (a === "--openingfamily") opts.openingFamily = argv[++i];
  else if (a === "--tag") (opts.tags ??= []).push(argv[++i]);
  else if (a === "--tags") opts.tags = argv[++i];
  else if (a === "--motif") opts.motif = argv[++i];
  else if (a === "--matepattern") opts.matePattern = argv[++i];
  else if (a === "--material") opts.material = argv[++i];
  else if (a === "--pawnstructure") opts.pawnStructure = argv[++i];
  else if (a === "--phase") opts.phase = argv[++i];
  else if (a === "--format") opts.format = argv[++i];
  else if (a === "--timecontrol") opts.timeControl = argv[++i];
  else if (a === "--emotion") opts.emotion = argv[++i];
  else if (a === "--mood") opts.mood = argv[++i];
  else if (a === "--story") opts.story = argv[++i];
  else if (a === "--resultstory") opts.resultStory = argv[++i];
  else if (a === "--playerstory") opts.playerStory = argv[++i];
  else if (a === "--openingstyle") opts.openingStyle = argv[++i];
  else if (a === "--worldchampion") opts.worldChampion = true;
  else if (a === "--supergm") opts.superGm = true;
  else if (a === "--women") opts.women = true;
  else if (a === "--year") opts.year = argv[++i];
  else if (a === "--limit") opts.limit = Number(argv[++i]);
  else if (a === "--queensac") opts.queenSac = true;
  else if (a === "--rooksac") opts.rookSac = true;
  else if (a === "--bishopsac") opts.bishopSac = true;
  else if (a === "--knightsac") opts.knightSac = true;
  else if (a === "--piecesac") opts.pieceSac = true;
  else if (a === "--exchangesac") opts.exchangeSac = true;
  else if (a === "--kinghunt") opts.kingHunt = true;
  else if (a === "--stalemate") opts.stalemate = true;
  else if (a === "--smotheredmate") opts.smotheredMate = true;
  else if (a === "--backrankmate") opts.backRankMate = true;
  else if (a === "--queentrap") opts.queenTrap = true;
  else if (a === "--fork") opts.fork = true;
  else if (a === "--pin") opts.pin = true;
  else if (a === "--skewer") opts.skewer = true;
  else if (a === "--perpetual") opts.perpetualCheck = true;
  else if (a === "--missedmate") opts.missedMate = true;
  else if (a === "--blunder") opts.blunder = true;
  else if (a === "--flagged") opts.flagged = true;
  else if (a === "--underpromotion") opts.underpromotion = true;
  else if (a === "--promotion") opts.promotion = true;
  else if (a === "--b4") opts.b4 = true;
  else if (a === "--minqueens") opts.minQueens = Number(argv[++i]);
  else if (a === "--minmoves") opts.minMoves = Number(argv[++i]);
  else if (a === "--maxmoves") opts.maxMoves = Number(argv[++i]);
  else if (a === "--miniature") opts.miniature = true;
  else if (a === "--short") opts.short = true;
  else if (a === "--endgame") opts.endgame = true;
  else if (a === "--minduration") opts.minDuration = argv[++i];
  else if (a === "--maxduration") opts.maxDuration = argv[++i];
  else if (a === "--duration") opts.duration = argv[++i];
  else if (a === "--white") opts.white = argv[++i];
  else if (a === "--black") opts.black = argv[++i];
  else if (a === "--winner") opts.winner = argv[++i];
  else if (a === "--result") opts.result = argv[++i];
  else if (a === "--decisive") opts.decisive = true;
  else if (a === "--draw") opts.draw = true;
  else if (a === "--yearfrom") opts.yearFrom = Number(argv[++i]);
  else if (a === "--yearto") opts.yearTo = Number(argv[++i]);
  else if (a === "--publishedfrom") opts.publishedFrom = argv[++i];
  else if (a === "--publishedto") opts.publishedTo = argv[++i];
  else if (a === "--era") opts.era = argv[++i];
  else if (a === "--mate") opts.checkmate = true;
  else if (a === "--hasfen") opts.hasFen = true;
  else if (a === "--computer") opts.computer = true;
  else if (a === "--humanonly") opts.humanOnly = true;
  else if (a === "--startswith") opts.startsWith = argv[++i];
  else if (a === "--hasmove") (opts.hasMoves ??= []).push(argv[++i]);
  else if (a === "--move") {
    // format: "2w:b3" or "12b:Qxf7"  (moveNumber + side + : + SAN)
    const m = argv[++i].match(/^(\d+)([wb]):(.+)$/);
    if (m) (opts.moves ??= []).push({ n: +m[1], side: m[2], san: m[3] });
  } else free.push(a);
}
opts.query = free.join(" ");

const results = searchGames(opts);
console.log(`\nquery: ${JSON.stringify(opts)}\n`);
if (!results.length) console.log("  (no matches)");
for (const r of results) {
  const tag = [r.year, r.eco, r.result].filter(Boolean).join(" · ");
  console.log(`  [${r._score ?? "-"}] ${r.title}`);
  console.log(`        ${r.players || "?"}  ${tag ? "· " + tag : ""}`);
  if (r.opening) console.log(`        ${r.opening}`);
  console.log(`        ▶ ${r.url}\n`);
}
