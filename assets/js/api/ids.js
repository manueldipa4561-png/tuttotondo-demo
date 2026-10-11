// Id helpers that behave the same in Node and in the browser. The in-browser demo backend runs the very modules the
// Node server runs, so nothing in assets/js/api may import from "node:*".

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0"));

// RFC 4122 version 4. crypto.randomUUID needs a secure context (https or localhost); getRandomValues does not.
export function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

// Uniform in [0, n) for n up to 2^16 (the 32-bit sample is reduced with a modulo; the bias at these sizes is negligible).
export const randomIndex = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

const FNV_PRIME = 0x01000193;
const FNV_OFFSETS = [0x811c9dc5, 0x9747b28c]; // two different seeds give two independent 32-bit lanes

// Stable, synchronous string hash (two FNV-1a lanes), as 16 hex characters. Not cryptographic: it only has to be
// deterministic and well spread (channel reservation ids, the demo door code).
export function hashHex(text) {
  return FNV_OFFSETS.map((offset) => {
    let h = offset;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), FNV_PRIME);
    return (h >>> 0).toString(16).padStart(8, "0");
  }).join("");
}
