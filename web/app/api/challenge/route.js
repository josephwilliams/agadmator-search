// Issues a proof-of-work challenge for the browser to solve before calling
// /api/search. Returns { enabled: false } when PoW isn't configured, so the
// client transparently skips it.

import { challengeEnabled, issueChallenge } from "../../../lib/challenge.js";
import { rateLimit } from "../../../lib/ratelimit.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const limited = rateLimit(req);
  if (limited) return limited;

  if (!challengeEnabled()) {
    return Response.json({ enabled: false });
  }
  const { nonce, exp, nibbles, sig } = await issueChallenge(Date.now());
  return Response.json(
    { enabled: true, nonce, exp, nibbles, sig },
    { headers: { "cache-control": "no-store" } },
  );
}
