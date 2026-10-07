import type { PlatformEnv } from "./env.ts";
import { createMacPlatform } from "./mac/index.ts";
import type { Platform } from "./types.ts";
import { createWindowsPlatform } from "./windows/index.ts";

export type { PlatformEnv } from "./env.ts";

/** This OS's implementations: the one place the shell asks which OS it is on for these jobs. */
export function createPlatform(platform: NodeJS.Platform, env: PlatformEnv): Platform {
  if (platform === "win32") return createWindowsPlatform(env);
  if (platform === "darwin") return createMacPlatform(env);
  throw new Error(`Vocify has no platform implementation for "${platform}"`);
}
