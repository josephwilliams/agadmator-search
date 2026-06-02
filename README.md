# agadmator-mcp

An MCP server that makes agadmator's entire chess video catalogue searchable — by player, opening, result, and even the moves themselves.

Ask for games the way chess people actually remember them:

- "that Halloween Gambit king hunt"
- "Magnus queen sacs"
- "miniatures in the Najdorf"
- "games where White played 1.b4"
- "Carlsen games that ended in checkmate"
- "Queen's Gambit games after 2020"

`agadmator-mcp` exposes roughly 5,000 analysed games/videos through the Model Context Protocol, with local search over players, openings, ECO codes, years, results, PGNs, and move-derived features.

No API key. No database. No network at runtime. Just a compact local index and fast MCP tools.

![agadmator-mcp web UI — searching the Najdorf for queen sacrifices](docs/demo.png)

## What You Get

- **MCP tools** for searching agadmator's catalogue from Claude, Codex, or any MCP client.
- **Move-aware filters** for queen sacrifices, underpromotions, checkmates, promoted queens, `b4`, exact moves, and move count.
- **Opening search that forgives real-world messiness**, including `queens gambit` vs `Queen's Gambit`, derived opening families, and useful fallbacks when upstream opening metadata is missing.
- **Full game detail lookup** with PGN, FEN positions, players, result, opening/ECO, and YouTube URL.
- **Optional web UI** with player portraits and the same search behavior as the MCP server.
- **Local-only runtime** against `data/index.json`.

## Demo Queries

Try these in an MCP client or with the local CLI:

```bash
npm run query -- "halloween gambit"
npm run query -- "queens gambit"
npm run query -- "stafford"
npm run query -- "magnus queen sacrifice"
npm run query -- --player Tal --queensac
npm run query -- --opening najdorf --maxmoves 25
npm run query -- --winner "Magnus Carlsen" --mate
npm run query -- --move 1w:e4 --move 1b:c5 --move 2w:Nf3
```

## Install

```bash
git clone <this-repo-url>
cd agadmator-mcp
npm install
```

Requires Node.js 18 or newer.

## Run The MCP Server

```bash
npm start
```

Or run the bin directly:

```bash
npx agadmator-mcp
```

Example MCP client config:

```json
{
  "mcpServers": {
    "agadmator": {
      "command": "node",
      "args": ["/absolute/path/to/agadmator-mcp/src/server.js"]
    }
  }
}
```

Once published to npm, the simplest config needs no clone — `npx` fetches and runs it:

```json
{
  "mcpServers": {
    "agadmator": {
      "command": "npx",
      "args": ["-y", "agadmator-mcp"]
    }
  }
}
```

In Claude Code, add it in one line:

```bash
claude mcp add agadmator -- npx -y agadmator-mcp
```

Once connected, your MCP client gets two tools:

- `search_games`
- `get_game`

## Tools

### `search_games`

Searches the catalogue and returns lean result objects suitable for chat responses or result lists.

Minimal free-text search:

```json
{
  "query": "halloween gambit",
  "limit": 10
}
```

Structured search:

```json
{
  "player": "Magnus Carlsen",
  "opening": "queens gambit",
  "yearFrom": 2020,
  "limit": 20
}
```

Move-derived search:

```json
{
  "queenSac": true,
  "maxMoves": 25,
  "limit": 10
}
```

Exact move sequence search:

```json
{
  "moves": [
    { "n": 1, "side": "w", "san": "e4" },
    { "n": 1, "side": "b", "san": "c5" },
    { "n": 2, "side": "w", "san": "Nf3" }
  ],
  "limit": 10
}
```

Moves appearing anywhere in the game:

```json
{
  "hasMoves": ["O-O-O", "Nf5"],
  "limit": 10
}
```

### Explicit `search_games` Filters

| Argument | Description |
| --- | --- |
| `query` | Free-text search over title, players, event, opening, ECO, description, and derived opening tags. |
| `player` | Match either White or Black. |
| `players` / `versus` | Color-agnostic matchup, such as `Magnus vs Hikaru`. |
| `white` / `black` | Side-specific player filters. |
| `winner` | Player who won, regardless of color. |
| `result` | `white`, `black`, `draw`, `1-0`, or `0-1`. |
| `decisive` / `draw` | Decisive-only or draw-only games. |
| `event` | Tournament/event text, such as `Norway Chess`, `Candidates`, or `Tata Steel`. |
| `opening` | Opening substring or derived opening family. |
| `openingFamily` | Friendly opening family, such as `sicilian`, `ruy lopez`, `caro-kann`, `london`. |
| `semanticTags` / `tags` / `tag` | Semantic tag filters, such as `queenless middlegame`, `time trouble`, `opening trap`, or `brutal`. Comma-separated strings are accepted. |
| `motif` / `matePattern` | Tactical or mate motif tag, such as `Greek gift`, `fork`, `queen trap`, `smothered mate`, `mate in two`, or `perpetual check`. |
| `material` / `pawnStructure` | Material/endgame/pawn tag, such as `rook endgame`, `bishop pair`, `passed pawn`, `isolated pawn`, or `queenless middlegame`. |
| `phase` | Phase/castling tag, such as `no castling`, `opposite-side castling`, or `opening trap`. |
| `format` / `timeControl` | Game/video format tag, such as `blitz`, `rapid`, `bullet`, `tiebreak`, `must win`, or `final round`. |
| `emotion` / `mood` | Mood/quality tag, such as `beautiful`, `brutal`, `clinical`, `quiet move`, or `genius move`. |
| `story` | Shortcut semantic story tag, such as `escape`, `time trouble`, `underdog`, or `missed mate`. |
| `resultStory` | Result narrative tag, such as `missed mate`, `missed win`, `fighting draw`, or `winning but blundered`. |
| `playerStory` | Player narrative tag, such as `prodigy`, `women`, `underdog`, or `world champion loses`. |
| `openingStyle` | Opening style tag, such as `rare opening`, `main line`, `novelty`, `refutation`, or `dubious gambit`. |
| `worldChampion` | Games involving known world champions or world-championship title text. |
| `superGm` | Games involving known elite/super-GM players or super-GM title text. |
| `women` | Games involving known women players or women/female title text. |
| `eco` | ECO code or prefix, such as `B90` or `D`. |
| `year` | Exact year. |
| `yearFrom` / `yearTo` | Inclusive year range. |
| `publishedFrom` / `publishedTo` | YouTube publication date range. |
| `era` | `classical`, `historical`, `modern`, `contemporary`, `recent`, `engine`, or `computer`. |
| `queenSac` | Only games with a detected queen sacrifice. |
| `rookSac`, `bishopSac`, `knightSac` | Title/description-mentioned piece sacrifices. |
| `pieceSac` | Queen sacrifice or title/description-mentioned piece sacrifice. |
| `exchangeSac` | Title/description-mentioned exchange sacrifices. |
| `kingHunt` | Likely king hunts, using title/description text and PGN check count. |
| `stalemate`, `smotheredMate`, `backRankMate` | Title/description-mentioned mate/stalemate motifs. |
| `queenTrap`, `fork`, `pin`, `skewer`, `perpetualCheck`, `missedMate` | Common title/description-mentioned tactical motifs. |
| `blunder`, `flagged` | Result-shape filters for blunders/thrown wins and flagging/flag-fall language. |
| `underpromotion` | Only games with an underpromotion. |
| `promotion` | Any promotion. |
| `checkmate` | Only games that ended with mate on the board. |
| `b4` | Games where `b4` was played. |
| `minQueens` | Minimum peak queen count, useful for promoted queens. |
| `minMoves` / `maxMoves` | Move-count filters. |
| `miniature`, `short`, `endgame` | Move-count buckets: `<=25`, `<=35`, and `>=60`. |
| `minDuration` / `maxDuration` | Video duration in seconds or strings like `10m`. |
| `duration` | Video duration bucket: `short`, `medium`, or `long`. |
| `hasFen` | Only games with highlighted FEN positions. |
| `computer` / `humanOnly` | Include only engine/computer games or exclude them. |
| `startsWith` | Friendly opening movetext prefix, such as `1.e4 c5 2.Nf3`. |
| `hasMoves` | SAN moves that appear anywhere in the game. All must appear. |
| `moves` | Exact move-by-index filters. |
| `limit` | Max result count. Defaults to 5. |

### Natural-Language Query Filters

These are inferred from `query`. They are intentionally human-language oriented, so users can ask messy questions without knowing filter names.

| Query language | Inferred behavior |
| --- | --- |
| `Magnus vs Hikaru`, `Magnus against Hikaru`, `games between Magnus and Hikaru` | Color-agnostic `versus` filter. |
| `Magnus beat Hikaru`, `Pragg beat Magnus`, `Hikaru lost to Magnus` | Matchup plus inferred `winner`. |
| `Magnus beat Hikaru with black`, `Hikaru lost as white` | Matchup plus side/result filters. |
| `wins with black`, `wins with white`, `black wins`, `white wins` | Result/color filters. |
| `draws only`, `only draws`, `drawn games` | `draw: true`. |
| `decisive`, `no draws` | `decisive: true`. |
| `less than 18 moves`, `under 30 moves`, `fewer than 20 moves` | `maxMoves` inferred. |
| `at most 25 moves`, `no more than 40 moves` | `maxMoves` inferred. |
| `more than 80 moves`, `over 60 moves` | `minMoves` inferred. |
| `at least 60 moves`, `minimum 50 moves` | `minMoves` inferred. |
| `miniature` | `miniature: true`. |
| `endgame`, `long game` | `endgame: true`, unless the phrase is about video length. |
| `short video`, `quick video`, `latest short videos` | `duration: "short"`. |
| `long video`, `long analysis` | `duration: "long"`. |
| `under 10 minutes`, `less than 15 min` | `maxDuration` inferred. |
| `over 20 minutes`, `longer than 30 min` | `minDuration` inferred. |
| `latest`, `newest` | Recent published-date filter. |
| `recent` | Broader recent published-date filter. |
| `old agadmator videos`, `early videos` | Old published-date filter. |
| `old masters`, `Soviet classics`, `historical` | Historical/classical era filter. |
| `modern`, `modern super GM` | Modern era filter. |
| `engine games`, `computer games`, `AlphaZero`, `Stockfish`, `Leela` | `computer: true`. |
| `human only`, `no engines` | `humanOnly: true`. |
| `Candidates`, `World Cup`, `Norway Chess`, `Tata Steel`, `Sinquefield`, `Olympiad`, `Grand Swiss` | Event filter. |
| `queen sac`, `rook sac`, `bishop sac`, `knight sac`, `exchange sac`, `piece sacrifice`, `double sacrifice` | Sacrifice filters or semantic boosts. |
| `king hunt`, `king walk`, `king march` | `kingHunt: true`. |
| `stalemate`, `smothered mate`, `back rank mate` | Motif filters. |
| `underpromotion`, `promotion race`, `promotions` | Promotion filters/semantic tags. |
| `checkmate`, `mates` | `checkmate: true`, unless a more specific mate motif is detected. |
| `classical`, `rapid`, `blitz`, `bullet`, `armageddon`, `freestyle`, `Chess960`, `Titled Tuesday` | Format semantic tags. |
| `final game`, `final round`, `tiebreak`, `must win`, `bonus game`, `game of the day`, `puzzle` | Format/video-memory semantic tags. |
| `queenless`, `early queen trade`, `rook endgame`, `queen endgame`, `pawn endgame`, `knight endgame` | Material/endgame semantic tags. |
| `opposite-colored bishops`, `same-colored bishops`, `bishop pair`, `bishop vs knight` | Minor-piece/material semantic tags. |
| `passed pawn`, `outside passer`, `connected passed pawns`, `isolated pawn`, `IQP`, `hanging pawns`, `backward pawn` | Pawn-structure semantic tags. |
| `fortress`, `zugzwang` | Endgame/defensive semantic tags. |
| `opposite-side castling`, `queenside castling`, `no castling`, `never castled` | Phase/castling semantic tags. |
| `opening trap`, `main line`, `novelty`, `new idea`, `refutation`, `rare opening`, `offbeat`, `sideline`, `sharp`, `solid`, `dubious gambit` | Opening-style semantic tags. |
| `beautiful`, `brutal`, `savage`, `clinical`, `technical win`, `grind`, `quiet move`, `genius move`, `ridiculous move` | Mood/quality semantic tags. |
| `winning but blundered`, `threw away a win`, `dead lost`, `missed mate`, `missed win`, `only move`, `best move`, `blunderfest`, `time trouble`, `flagged`, `resignation`, `quick draw`, `fighting draw` | Result-story semantic tags. |
| `world champion loses`, `prodigy`, `teenager`, `youngster beats legend`, `underdog`, `lower rated`, `women`, `female` | Player-story semantic tags. |
| `world champion`, `world champions`, `super GM`, `super GMs`, `elite grandmasters`, `women`, `female players` | Player-bucket filters. |
| `queen trap`, `fork`, `pin`, `skewer`, `perpetual check`, `missed mate` | Common tactical filters. |
| `blunder`, `blundered`, `blunderfest`, `threw away a win`, `flagged`, `flag fall` | Result-shape filters. |
| `Magnus as black in the Sicilian`, `Carlsen with the French`, `Pragg against the Sicilian`, `wins with white in the London` | Color-side opening inference: player side plus derived opening family. |

### Semantic Query Tags

The search also derives semantic tags from titles, descriptions, openings, events, and light PGN heuristics. In free text, these tags improve ranking and can narrow the pool when there is catalogue evidence. Explicit tag filters are strict-but-forgiving: if a tag has matches, it filters; if a tag would zero out the catalogue, the search falls back to ranking instead of returning nothing.

**Intent / title memory**

- `immortal`
- `brilliancy`
- `brilliant`
- `masterpiece`
- `perfect game`
- `model game`
- `crazy`
- `insane`
- `wild`
- `chaos`
- `disaster`
- `collapse`
- `blunder`
- `comeback`
- `swindle`
- `trick`
- `trap`
- `upset`
- `underdog`
- `miracle save`
- `escape`

**Opening names and aliases**

- `Sicilian`
- `Najdorf`
- `Dragon`
- `Accelerated Dragon`
- `French`
- `Caro-Kann`
- `London`
- `Jobava London`
- `King's Indian`
- `Queen's Gambit`
- `Queen's Gambit Accepted`
- `Queen's Gambit Declined`
- `Ruy Lopez`
- `Spanish`
- `Italian`
- `Petrov`
- `Petroff`
- `Russian`
- `Stafford`
- `Halloween`
- `Evans`
- `King's Gambit`
- `Scandinavian`
- `Slav`
- `Semi-Slav`
- `Fried Liver`
- `Traxler`
- `Wayward Queen`
- `Bongcloud`
- `Hippo`
- `Cow Opening`
- `Benko`
- `Benoni`
- `Catalan`
- `Berlin`
- `Marshall`
- `Anti-Marshall`
- `Poisoned Pawn`
- `English`
- `Reti`
- `Bird`
- `Orangutan`
- `Polish`
- `Scotch`
- `Vienna`
- `Alapin`
- `Smith-Morra`

**Opening style**

- `sharp opening`
- `solid opening`
- `boring opening`
- `dubious gambit`
- `rare opening`
- `offbeat`
- `sideline`
- `main line`
- `novelty`
- `opening trap`
- `refutation`
- `punish bad opening`
- `copycat opening`
- `symmetrical opening`

**Tactical motifs**

- `Greek gift`
- `sac on h7`
- `sac on f7`
- `windmill`
- `zwischenzug`
- `intermezzo`
- `discovered attack`
- `discovered check`
- `fork`
- `royal fork`
- `family fork`
- `pin`
- `skewer`
- `deflection`
- `decoy`
- `clearance`
- `remove defender`
- `overloaded piece`
- `double attack`
- `double check`
- `x-ray`
- `queen trap`
- `rook lift`
- `perpetual check`
- `mating net`
- `forced mate`
- `mate in one`
- `mate in two`

**Mate / result stories**

- `missed mate`
- `missed win`
- `winning but blundered`
- `threw away a win`
- `dead lost`
- `escape`
- `miracle save`
- `only move`
- `best move`
- `blunderfest`
- `time trouble`
- `time scramble`
- `flagged`
- `resignation`
- `quick draw`
- `fighting draw`
- `world champion loses`
- `youngster beats legend`
- `prodigy beats`
- `teen beats`
- `computer beats human`

**Material / phase**

- `opposite-side castling`
- `castles queenside`
- `no castling`
- `queenless middlegame`
- `early queen trade`
- `queens stayed on`
- `rook endgame`
- `rook and pawn ending`
- `queen endgame`
- `pawn endgame`
- `opposite-colored bishops`
- `same-colored bishops`
- `bishop pair`
- `knight endgame`
- `bishop vs knight`
- `promotion race`
- `passed pawn`
- `outside passer`
- `connected passed pawns`
- `isolated pawn`
- `hanging pawns`
- `backward pawn`
- `fortress`
- `zugzwang`

**Format / tournament memory**

- `classical`
- `rapid`
- `blitz`
- `bullet`
- `armageddon`
- `freestyle`
- `Chess960`
- `Fischer random`
- `Speed Chess`
- `Titled Tuesday`
- `final game`
- `final round`
- `tiebreak`
- `must win`
- `bonus game`
- `game of the day`
- `puzzle`
- `World Championship`
- `Candidates`
- `World Cup`
- `Norway Chess`
- `Tata Steel`
- `Sinquefield`
- `Olympiad`
- `Grand Swiss`

**Mood / quality**

- `beautiful`
- `clean`
- `smooth`
- `brutal`
- `savage`
- `clinical`
- `technical win`
- `grind`
- `defensive masterpiece`
- `attacking masterpiece`
- `quiet move`
- `cold-blooded`
- `genius move`
- `ridiculous move`

### `get_game`

Fetches full detail for a single result by YouTube video id (the `id` field from `search_games` results). For example, Caruana's queen sacrifice against Nakamura:

```json
{
  "id": "SxGPIYFeP0A"
}
```

Returns:

- title
- players
- year
- opening/ECO
- result
- PGN
- highlighted FEN positions
- move-derived flags
- YouTube URL

## Web UI

The repo includes a small Next.js UI in `web/`.

```bash
cd web
npm install
npm run dev
```

Open:

```text
http://localhost:3939
```

The UI uses the same search core as the MCP server. It includes:

- one-box search for text or PGN-style move queries
- quick filters
- preset opening move buttons
- player portraits for common players
- direct links to the matching agadmator videos

## How Search Works

The search core lives in `src/search.js`.

It loads `data/index.json` once, filters records in memory, scores matches, and returns compact summaries. The MCP server and web UI both call the same functions, so behavior stays consistent.

The index includes normal catalogue fields:

- title
- description
- publication date
- players
- event
- ECO
- opening
- result
- year
- PGN
- FEN positions
- YouTube id/URL

It also includes precomputed move features:

- queen sacrifice
- queen count
- underpromotion
- `b4`
- move count
- checkmate
- full SAN ply list

Because many upstream records have incomplete opening metadata, the search layer also derives a few important opening-family tags from move sequences. That is why searches such as `queens gambit`, `halloween gambit`, and `stafford` can still work even when the raw `opening` field is empty.

The semantic layer has two parts:

- **Inferred filters**: phrases like `Magnus beat Hikaru with black`, `less than 18 moves`, or `latest short videos` become structured filters before scoring.
- **Semantic tags**: phrases like `Greek gift`, `queen trap`, `miracle save`, `technical win`, or `rook endgame` are matched against derived tags from titles/descriptions/openings/events and light PGN heuristics.

Semantic tags are usually ranking signals, not hard filters. This is deliberate: agadmator titles are colorful, upstream metadata is uneven, and a hard filter for something like `rare opening` or `miracle save` would often hide useful results.

## Local CLI

Use `bin/query.js` to test search behavior without an MCP client:

```bash
npm run query -- "tal attack"
npm run query -- "halloween gambit"
npm run query -- --player "Mikhail Tal" --queensac
npm run query -- --opening "queens gambit" --yearfrom 2020
npm run query -- --white "Magnus Carlsen" --black "Alireza Firouzja"
npm run query -- --versus "Magnus Carlsen vs Hikaru Nakamura"
npm run query -- --event "Norway Chess" --publishedfrom 2026-01-01
npm run query -- --openingfamily sicilian --startswith "1.e4 c5 2.Nf3"
npm run query -- --format blitz --tag "time trouble"
npm run query -- --material "rook endgame" --playerstory prodigy
npm run query -- --openingstyle novelty --motif "queen trap"
npm run query -- --women --queentrap
npm run query -- "Magnus wins with black in the Sicilian"
npm run query -- "super GMs flagged"
npm run query -- --humanonly --maxduration 10m
npm run query -- --hasmove O-O-O --hasmove Nf5
```

CLI flags:

```text
--player
--players
--versus
--event
--white
--black
--winner
--result
--decisive
--draw
--opening
--openingfamily
--tag
--tags
--motif
--matepattern
--material
--pawnstructure
--phase
--format
--timecontrol
--emotion
--mood
--story
--resultstory
--playerstory
--openingstyle
--worldchampion
--supergm
--women
--eco
--year
--yearfrom
--yearto
--publishedfrom
--publishedto
--era
--queensac
--rooksac
--bishopsac
--knightsac
--piecesac
--exchangesac
--kinghunt
--stalemate
--smotheredmate
--backrankmate
--queentrap
--fork
--pin
--skewer
--perpetual
--missedmate
--blunder
--flagged
--underpromotion
--promotion
--mate
--b4
--minqueens
--minmoves
--maxmoves
--miniature
--short
--endgame
--minduration
--maxduration
--duration
--hasfen
--computer
--humanonly
--startswith
--hasmove
--move
--limit
```

`--move` format:

```text
2w:b3
12b:Qxf7
```

## Data

The bundled runtime index is:

```text
data/index.json
```

It is built from the community agadmator library data:

```text
https://github.com/agadmator-library/agadmator-library.github.io
```

Rebuild the index from a local checkout:

```bash
npm run build-index -- /path/to/agadmator-library.github.io
```

If no path is provided, the script uses:

```text
$AGAD_SRC
/tmp/agad-src/agadmator-library.github.io-main
```

## Player Portraits

The web UI uses:

```text
data/player-portraits.json
```

Portrait metadata is sourced from Wikimedia Commons via Wikidata `P18` image claims where available. The manifest stores:

- thumbnail URL
- original URL
- Commons source page
- author/credit
- license name
- license URL
- Wikidata/Wikipedia links

Refresh portraits:

```bash
npm run fetch-player-portraits -- 300
```

The fetch script is deliberately conservative:

- skips engines and non-person labels
- preserves existing entries
- uses alias overrides for common catalogue-name quirks
- backs off on Wikimedia rate limits

## Project Layout

```text
.
├── bin/query.js                     # Local CLI
├── data/index.json                  # Search index
├── data/player-portraits.json       # Portrait metadata for the web UI
├── scripts/build-index.mjs          # Build compact index from agadmator-library data
├── scripts/fetch-player-portraits.mjs
├── src/search.js                    # Shared search core
├── src/server.js                    # MCP stdio server
└── web/                             # Optional Next.js UI
```

## Design Notes

This server is intentionally small:

- no database
- no embeddings
- no runtime network calls
- no hidden chess engine dependency

The goal is not to replace a full chess database. The goal is to make agadmator's video archive searchable from an AI assistant in the way fans remember games: players, openings, moments, sacrifices, weird moves, and memorable video titles.

## Limitations

- The index quality depends on the upstream agadmator-library data.
- Some records have missing ECO/opening/result/year fields.
- Some videos contain bonus games; search primarily summarizes the main indexed game.
- `stafford` currently maps to the Petrov/Russian family because exact Stafford-labelled records are not present in the bundled index.
- Tactical/material semantics such as `rook endgame`, `queenless middlegame`, `opposite-colored bishops`, or `passed pawn` are currently text/tag/PGN-heuristic based. They are not full board-state reconstruction yet.
- Sacrifice filters beyond `queenSac` are title/description based. `queenSac` is move-detected; `rookSac`, `bishopSac`, `knightSac`, and `exchangeSac` are semantic/text-detected.
- Portraits are metadata links to Wikimedia-hosted images; each image has its own license.

## TODO / Trial-By-Fire Backlog

The next reliability step is an eval harness: a list of brutal human-language queries with expected top-5 hits. That will make it safer to keep expanding semantics without regressions.

High-value deeper chess features:

- Real material reconstruction from PGN.
- True rook/queen/pawn endgame detection.
- True opposite-colored bishop detection.
- True queenless middlegame / early queen trade detection.
- More accurate sacrifice detection for rooks, bishops, knights, and exchanges.
- Mate-pattern recognition from board state, not just title text.
- Better rating/underdog detection from descriptions where ratings are present.
- Better bonus-game handling for videos with multiple games.

## License

MIT.

This project is not affiliated with agadmator. Video catalogue data comes from the community agadmator-library project. Player portrait metadata points to Wikimedia Commons sources and their individual licenses.
