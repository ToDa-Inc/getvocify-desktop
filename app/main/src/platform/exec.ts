import { execFile } from "node:child_process";

/** Runs a program for its output. A non-zero exit (`reg query` on a key that does not exist yet) is an empty answer; a
 * program that is missing or that timed out is a failure to report. */
export const runQuiet = (file: string, args: string[], timeout: number) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error && typeof (error as { code?: unknown }).code !== "number") reject(error);
      else resolve(error ? "" : stdout);
    });
  });

/** Runs a program and keeps its error: osascript's refusal (-1743) must reach the Mac reader. */
export const runStrict = (file: string, args: string[], timeout: number) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => (error ? reject(new Error(`${error.message} ${stderr}`)) : resolve(stdout)));
  });

export const every = (ms: number, fn: () => void) => {
  const timer = setInterval(fn, ms);
  return () => clearInterval(timer);
};
