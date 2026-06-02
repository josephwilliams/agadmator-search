#!/usr/bin/env node
// Builds data/player-portraits.json for the most common players in the index.
// Source: Wikimedia Commons images found through Wikidata P18 claims.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INDEX_PATH = join(ROOT, "data", "index.json");
const OUT_PATH = join(ROOT, "data", "player-portraits.json");

const LIMIT = Number(process.argv[2] || 100);
const USER_AGENT =
  "agadmator-mcp/0.1 portrait fetcher (https://github.com/agadmator-mcp)";

const SKIP_NAMES = new Set([
  "agadmator",
  "AlphaZero",
  "AndrejD",
  "cabreruno2",
  "Chessmaster GM Edition",
  "chne",
  "Leela Chess Zero",
  "Lc0",
  "Mr Hoodie Guy",
  "Stockfish",
  "Stockfish 14 + NNUE",
  "Stockfish 8",
  "Boxbox",
  "DrNykterstein",
  "FIFOU",
  "TSMFTXH",
  "Voyboy",
]);

const LOOKUP_OVERRIDES = {
  "Gukesh D": "Gukesh Dommaraju",
  "Praggnanandhaa R": "Rameshbabu Praggnanandhaa",
  "Erigaisi Arjun": "Arjun Erigaisi",
  "Hans Moke Niemann": "Hans Niemann",
  "Yi Wei": "Wei Yi",
  "Jeffrey Xiong": "Jeffery Xiong",
  "Jose Raul Capablanca": "Jose Raul Capablanca",
  "Rashid Gibiatovich Nezhmetdinov": "Rashid Nezhmetdinov",
  "Robert James Fischer": "Bobby Fischer",
  "Baadur Aleksandrovich Jobava": "Baadur Jobava",
  "Chithambaram VR. Aravindh": "Aravindh Chithambaram",
  "Johann Jacob Loewenthal": "Johann Jacob Lowenthal",
  "Maxime Vachier-Lagrave": "Maxime Vachier-Lagrave",
  "Jan-Krzysztof Duda": "Jan-Krzysztof Duda",
  "DanielNaroditsky": "Daniel Naroditsky",
  "Miaoyi Lu": "Lu Miaoyi",
  "Jose Eduardo Martinez Alcantara": "José Eduardo Martínez Alcántara",
  "A.R. Saleh Salem": "Salem Saleh",
  "Yangyi Yu": "Yu Yangyi",
  "Zhongyi Tan": "Tan Zhongyi",
  "Tingjie Lei": "Lei Tingjie",
  "Marc`Andria Maurizzi": "Marc'Andria Maurizzi",
  "Andre Lilienthal": "Andor Lilienthal",
  "Christopher Woojin Yoo": "Christopher Yoo",
  "Luke J McShane": "Luke McShane",
  "David W L Howell": "David Howell",
  "Gewain Jones": "Gawain Jones",
  "Laszlo Szabo": "László Szabó",
  "Sergey A. Fedorchuk": "Sergey Fedorchuk",
  "Alexander Koblents": "Alexander Koblenz",
  "Atle Groenn": "Atle Grønn",
  "BogdanDeac": "Bogdan-Daniel Deac",
  "Pranesh M": "M Pranesh",
};

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function topPlayers() {
  const rows = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  const counts = new Map();
  for (const row of rows) {
    for (const player of [row.white, row.black]) {
      if (!player || SKIP_NAMES.has(player)) continue;
      counts.set(player, (counts.get(player) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, LIMIT)
    .map(([name, appearances]) => ({ name, appearances }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(2500 * attempt);
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
    });
    if (res.ok) {
      await sleep(300);
      return res.json();
    }
    lastError = new Error(`${res.status} ${res.statusText}: ${url}`);
    if (res.status !== 429 && res.status < 500) break;
  }
  throw lastError;
}

async function findWikidataEntity(name) {
  const lookup = LOOKUP_OVERRIDES[name] || name;
  for (const search of [lookup, `${lookup} chess player`, `${lookup} chess`]) {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.search = new URLSearchParams({
      action: "wbsearchentities",
      format: "json",
      language: "en",
      uselang: "en",
      search,
      limit: "8",
    });
    const data = await getJson(url);
    const hits = data.search || [];
    const chessHit = hits.find((hit) => /chess/i.test(`${hit.label} ${hit.description}`));
    if (chessHit) return chessHit;
    if (hits[0] && search === lookup) return hits[0];
  }
  return null;
}

async function getEntityImage(entityId) {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({
    action: "wbgetentities",
    format: "json",
    props: "claims|sitelinks|labels",
    languages: "en",
    ids: entityId,
  });
  const data = await getJson(url);
  const entity = data.entities?.[entityId];
  const image = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (!image) return null;
  return {
    fileName: image,
    wikidataId: entityId,
    wikidataLabel: entity.labels?.en?.value || null,
    wikipediaUrl: entity.sitelinks?.enwiki?.title
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(entity.sitelinks.enwiki.title.replace(/ /g, "_"))}`
      : null,
  };
}

async function getCommonsImageInfo(fileName) {
  const title = fileName.startsWith("File:") ? fileName : `File:${fileName}`;
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "imageinfo",
    titles: title,
    iiprop: "url|extmetadata",
    iiurlwidth: "160",
  });
  const data = await getJson(url);
  const page = Object.values(data.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) return null;

  const meta = info.extmetadata || {};
  return {
    portraitUrl: info.thumburl || info.url,
    originalUrl: info.url,
    sourcePage: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    fileName,
    author: stripHtml(meta.Artist?.value || meta.Credit?.value),
    credit: stripHtml(meta.Credit?.value),
    license: stripHtml(meta.LicenseShortName?.value || meta.UsageTerms?.value),
    licenseUrl: stripHtml(meta.LicenseUrl?.value),
    attributionRequired: meta.AttributionRequired?.value === "true",
  };
}

async function portraitFor(player) {
  const entity = await findWikidataEntity(player.name);
  if (!entity) return null;
  const image = await getEntityImage(entity.id);
  if (!image) return null;
  const commons = await getCommonsImageInfo(image.fileName);
  if (!commons) return null;
  return {
    ...commons,
    name: player.name,
    appearances: player.appearances,
    wikidataId: image.wikidataId,
    wikidataLabel: image.wikidataLabel,
    wikidataUrl: `https://www.wikidata.org/wiki/${image.wikidataId}`,
    wikipediaUrl: image.wikipediaUrl,
    source: "Wikimedia Commons via Wikidata P18",
  };
}

const players = topPlayers();
const existing = existsSync(OUT_PATH)
  ? JSON.parse(readFileSync(OUT_PATH, "utf8")).portraits || {}
  : {};
const portraits = {};
const missing = [];

for (const [i, player] of players.entries()) {
  process.stderr.write(`[${i + 1}/${players.length}] ${player.name} ... `);
  if (existing[player.name]?.portraitUrl) {
    portraits[player.name] = existing[player.name];
    process.stderr.write("kept existing\n");
    continue;
  }
  try {
    const portrait = await portraitFor(player);
    if (portrait?.portraitUrl) {
      portraits[player.name] = portrait;
      process.stderr.write("ok\n");
    } else {
      missing.push(player);
      process.stderr.write("missing\n");
    }
  } catch (err) {
    if (existing[player.name]?.portraitUrl) {
      portraits[player.name] = existing[player.name];
      process.stderr.write(`kept existing after error: ${err.message}\n`);
    } else {
      missing.push({ ...player, error: err.message });
      process.stderr.write(`error: ${err.message}\n`);
    }
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  limit: LIMIT,
  source: "Wikimedia Commons images discovered from Wikidata P18 claims",
  portraits,
  missing,
};

writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
process.stderr.write(
  `Wrote ${Object.keys(portraits).length} portraits, ${missing.length} missing -> ${OUT_PATH}\n`
);
