import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { AnalysisFailure } from "@/lib/analysis/errors";
import type { AnalysisStage } from "@/lib/analysis/types";

const PYTHON_TIMEOUT_MS = 30_000;

export function resolvePythonPath(): string {
  const configured = process.env.PYTHON_PATH?.trim();
  if (configured) {
    return configured;
  }

  const venvPython = path.join(process.cwd(), ".venv", "bin", "python");
  if (existsSync(venvPython)) {
    return venvPython;
  }

  return "python3";
}

export function runPythonScript(
  scriptName: "profile.py" | "execute.py",
  input: unknown,
  stage: AnalysisStage,
): Promise<unknown> {
  const scriptPath = path.join(process.cwd(), "python", scriptName);

  return new Promise((resolve, reject) => {
    const child = spawn(resolvePythonPath(), [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      handler();
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(() => {
        reject(
          new AnalysisFailure({
            stage,
            message: "Python analysis timed out.",
            details: { code: "timeout" },
          }),
        );
      });
    }, PYTHON_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(() => {
        const message =
          error.code === "ENOENT"
            ? "Python interpreter was not found. Set PYTHON_PATH or create .venv."
            : error.message;
        reject(new AnalysisFailure({ stage, message, details: { code: "python_unavailable" } }));
      });
    });

    child.on("close", (code) => {
      finish(() => {
        const parsed = parseStdout(stdout, stderr, stage);
        if (code !== 0 && !isFailureEnvelope(parsed)) {
          reject(
            new AnalysisFailure({
              stage,
              message: stderr.trim() || "Python process failed.",
              details: { code: "python_failed", exitCode: code },
            }),
          );
          return;
        }
        resolve(parsed);
      });
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

function parseStdout(stdout: string, stderr: string, stage: AnalysisStage): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new AnalysisFailure({
      stage,
      message: "Python returned an unreadable response.",
      details: { code: "invalid_response", stderr: stderr.trim() },
    });
  }
}

function isFailureEnvelope(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "ok" in value && value.ok === false);
}
