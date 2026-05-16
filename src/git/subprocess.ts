import { spawn } from "node:child_process";

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Maximum bytes to buffer from stdout/stderr combined (10 MB). */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/**
 * Run a command via `spawn`, collecting stdout/stderr.
 *
 * Uses `setTimeout` + `process.kill()` for timeout (macOS has no `timeout`
 * command). Respects the abort signal from the tool context. Caps buffered
 * output at 10 MB total to prevent memory exhaustion.
 */
export function runCommand(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; signal?: AbortSignal | undefined },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalBytes = 0;
    let bufferExceeded = false;

    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      if (bufferExceeded) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BUFFER_BYTES) {
        bufferExceeded = true;
        child.kill("SIGTERM");
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (bufferExceeded) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BUFFER_BYTES) {
        bufferExceeded = true;
        child.kill("SIGTERM");
        return;
      }
      stderrChunks.push(chunk);
    });

    // Timeout
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      // Give it a moment then SIGKILL
      killTimer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2000);
    }, opts.timeoutMs);

    // Abort signal from context
    const onAbort = (): void => {
      child.kill("SIGTERM");
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);

      resolve({
        success: code === 0,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        code,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);

      resolve({
        success: false,
        stdout: "",
        stderr: err.message,
        code: null,
      });
    });
  });
}
