import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("qodex healthcheck bootstraps a minimal Codex home", async () => {
  const sandbox = await createSandbox();
  await writeExecutable(
    join(sandbox.binDir, "codex"),
    "#!/usr/bin/env zsh\nexit 0\n",
  );
  await mkdir(join(sandbox.homeDir, ".codex"), { recursive: true });
  await writeFile(join(sandbox.homeDir, ".codex", "auth.json"), "{}\n");
  await writeFile(join(sandbox.homeDir, ".codex", "installation_id"), "install-1\n");

  const result = await runZsh([
    join(repoRoot, "bin/qodex"),
    "--healthcheck",
  ], sandbox);

  assert.equal(result.exitCode, 0);
  assert.match(
    await readFile(join(sandbox.homeDir, ".codex-min", "config.toml"), "utf8"),
    /include_apps_instructions = false/,
  );
  assert.equal(
    await readFile(join(sandbox.homeDir, ".codex-min", "auth.json"), "utf8"),
    "{}\n",
  );
});

test("qgemini healthcheck bootstraps a minimal Gemini home", async () => {
  const sandbox = await createSandbox();
  await writeExecutable(
    join(sandbox.binDir, "gemini"),
    "#!/usr/bin/env zsh\nexit 0\n",
  );
  await mkdir(join(sandbox.homeDir, ".gemini"), { recursive: true });
  await writeFile(join(sandbox.homeDir, ".gemini", "oauth_creds.json"), "{\"token\":\"x\"}\n");
  await writeFile(join(sandbox.homeDir, ".gemini", "google_account_id"), "account\n");
  await writeFile(join(sandbox.homeDir, ".gemini", "google_accounts.json"), "[]\n");
  await writeFile(join(sandbox.homeDir, ".gemini", "installation_id"), "install-1\n");
  await writeFile(join(sandbox.homeDir, ".gemini", "projects.json"), "{}\n");
  await writeFile(join(sandbox.homeDir, ".gemini", "state.json"), "{}\n");
  await writeFile(join(sandbox.homeDir, ".gemini", "user_id"), "user\n");

  const result = await runZsh([
    join(repoRoot, "bin/qgemini"),
    "--healthcheck",
  ], sandbox);

  assert.equal(result.exitCode, 0);
  assert.match(
    await readFile(join(sandbox.homeDir, ".gemini-min-home", ".gemini", "settings.json"), "utf8"),
    /"enabled": false/,
  );
  assert.match(
    await readFile(join(sandbox.homeDir, ".gemini-min-home", ".gemini", "system.md"), "utf8"),
    /Answer briefly and directly\./,
  );
  assert.equal(
    await readFile(join(sandbox.homeDir, ".gemini-min-home", ".gemini", "oauth_creds.json"), "utf8"),
    "{\"token\":\"x\"}\n",
  );
});

test("qgemini wraps plain prompts with -p after bootstrap", async () => {
  const sandbox = await createSandbox();
  await writeExecutable(
    join(sandbox.binDir, "gemini"),
    "#!/usr/bin/env zsh\nprint -r -- \"$*\" > \"$GEMINI_CAPTURE_PATH\"\n",
  );
  await mkdir(join(sandbox.homeDir, ".gemini"), { recursive: true });
  await writeFile(join(sandbox.homeDir, ".gemini", "oauth_creds.json"), "{\"token\":\"x\"}\n");
  await writeFile(join(sandbox.homeDir, ".gemini", "state.json"), "{}\n");

  const capturePath = join(sandbox.rootDir, "gemini-args.txt");
  const result = await runZsh([
    join(repoRoot, "bin/qgemini"),
    "hello world",
  ], sandbox, {
    GEMINI_CAPTURE_PATH: capturePath,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(await readFile(capturePath, "utf8"), "-e none -p hello world\n");
});

async function createSandbox() {
  const rootDir = await mkdtemp(join(tmpdir(), "local-llms-wrapper-test-"));
  const homeDir = join(rootDir, "home");
  const binDir = join(rootDir, "bin");
  await mkdir(homeDir, { recursive: true });
  await mkdir(binDir, { recursive: true });

  return {
    rootDir,
    homeDir,
    binDir,
  };
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { mode: 0o755 });
  const stats = await stat(path);
  if ((stats.mode & 0o111) === 0) {
    throw new Error(`Expected ${path} to be executable`);
  }
}

async function runZsh(
  args: string[],
  sandbox: Awaited<ReturnType<typeof createSandbox>>,
  extraEnv: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("zsh", args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: sandbox.homeDir,
        PATH: `${sandbox.binDir}:${process.env.PATH ?? ""}`,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}
