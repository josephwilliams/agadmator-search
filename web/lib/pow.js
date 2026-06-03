// Isomorphic proof-of-work helpers, shared by the browser (solve) and the
// Node API route (verify). Uses Web Crypto (`crypto.subtle`), which is identical
// in modern browsers and Node 20+, so there is no custom hash to get wrong.
//
// Difficulty is expressed in leading zero HEX digits (nibbles): each nibble is
// 4 bits, so N nibbles ≈ 2^(4N) expected hashes. The client pays that cost
// once; the server verifies with a single hash.

const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256hex(str) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(str)));
}

export function meets(hex, nibbles) {
  for (let i = 0; i < nibbles; i++) if (hex[i] !== "0") return false;
  return true;
}

// Find x such that sha256(`${nonce}:${x}`) starts with `nibbles` zeros.
// `await` yields to the event loop each iteration, so this never freezes the UI.
export async function solve(nonce, nibbles, signal) {
  for (let x = 0; ; x++) {
    if (signal?.aborted) throw new Error("aborted");
    const h = await sha256hex(`${nonce}:${x}`);
    if (meets(h, nibbles)) return String(x);
  }
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function sign(secret, msg) {
  return toHex(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(msg)));
}

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// The server-issued part of a challenge, HMAC-signed so the client cannot lower
// the difficulty or extend the expiry without invalidating the signature.
export async function issue(secret, nibbles, ttlMs, now) {
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const exp = now + ttlMs;
  const sig = await sign(secret, `${nonce}.${exp}.${nibbles}`);
  return { nonce, exp, nibbles, sig };
}

// Verify a solved token: signature authentic, not expired, and the solution
// actually meets the (signed, untampered) difficulty.
export async function verify(secret, token, now) {
  if (!token) return false;
  const { nonce, exp, nibbles, sig, x } = token;
  if (!nonce || !sig || x == null) return false;
  if (!Number.isFinite(Number(exp)) || Number(exp) < now) return false;
  const expectSig = await sign(secret, `${nonce}.${exp}.${nibbles}`);
  if (!safeEqualHex(expectSig, String(sig))) return false;
  return meets(await sha256hex(`${nonce}:${x}`), Number(nibbles));
}

// Wire format for the x-pow header: dot-joined (all fields are hex/numbers).
export function encodeToken(t) {
  return `${t.nonce}.${t.exp}.${t.nibbles}.${t.sig}.${t.x}`;
}
export function decodeToken(s) {
  if (typeof s !== "string") return null;
  const [nonce, exp, nibbles, sig, x] = s.split(".");
  if (!nonce || !exp || !nibbles || !sig || x == null) return null;
  return { nonce, exp: Number(exp), nibbles: Number(nibbles), sig, x };
}
