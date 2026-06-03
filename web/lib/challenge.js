// Server-side proof-of-work config + verification for /api/search.
//
// Opt-in and fail-open: with no CHALLENGE_SECRET set, PoW is disabled and every
// request passes (the app behaves exactly as before). Set CHALLENGE_SECRET (a
// random string, stable across instances) to turn it on. The secret MUST stay
// private — it is what stops a client from minting an easy challenge.

import { issue, verify, decodeToken } from "./pow.js";

const SECRET = process.env.CHALLENGE_SECRET || "";
// Difficulty in leading-zero hex digits. 3 ≈ 12 bits ≈ ~100ms one-time solve in
// a browser. Bump via env if you ever see targeted scraping.
const NIBBLES = Math.max(1, Math.min(6, Number(process.env.CHALLENGE_DIFFICULTY || 3)));
const TTL_MS = Number(process.env.CHALLENGE_TTL_MS || 10 * 60 * 1000);

export function challengeEnabled() {
  return Boolean(SECRET);
}

export async function issueChallenge(now) {
  return issue(SECRET, NIBBLES, TTL_MS, now);
}

// true = allowed. Fails open when PoW isn't configured.
export async function verifyPow(req, now) {
  if (!SECRET) return true;
  return verify(SECRET, decodeToken(req.headers.get("x-pow")), now);
}
