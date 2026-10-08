import { createLoopback } from "../../loopback/loopback.ts";
import type { SystemAudio } from "../types.ts";

export function createWindowsSystemAudio(): SystemAudio {
  return createLoopback();
}
