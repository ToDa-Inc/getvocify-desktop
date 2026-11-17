// Memory pressure like a rep's PC: holds memory until about TARGET_FREE_MB is free, and keeps touching every page it
// holds so Windows cannot page it out quietly. Prints "ballast ready" once the target is met; runs until killed.
import { freemem } from "node:os";

const target = Number(process.env.TARGET_FREE_MB ?? 1536) * 1024 * 1024;
const CHUNK = 64 * 1024 * 1024;
const held = [];
let heldBytes = 0;
while (freemem() - CHUNK > target) {
  const block = Buffer.alloc(CHUNK, 1); // zero-filled, so every page is committed and touched
  held.push(block);
  heldBytes += CHUNK;
}
console.log(`ballast ready: holds ${Math.round(heldBytes / 1048576)} MB, free ${Math.round(freemem() / 1048576)} MB`);
setInterval(() => {
  for (const block of held) for (let i = 0; i < block.length; i += 4096) block[i] ^= 1;
}, 1000);
