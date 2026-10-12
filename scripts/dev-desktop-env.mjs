import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { withPinnedNodePath } from "./mise-toolchain-env.mjs";
import { quoteArgsForWindowsShell } from "./spawn-command.mjs";

const requestedEnv = process.argv[2]?.trim().toLowerCase();
const agentBytecode = process.argv.slice(3).includes("--agent-bytecode");
if (requestedEnv !== "test" && requestedEnv !== "production") {
  console.error("Usage: node scripts/dev-desktop-env.mjs <test|production> [--agent-bytecode]");
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

// 数据目录策略（2026-10-12 决定，原隔离方案已撤销）：dev 实例与官方 ZCode 共用真实
// ~/.zcode——设置、凭据、会话、记忆全部统一，卸载官方 ZCode 后二开版直接继承，无需迁移。
// 如需临时隔离做实验，调用方显式设置 ZCODE_DATA_BASE_DIR / ZCODE_DESKTOP_HOME_DIR
// （两者必须指向同一目录，否则会出现 "setting.json 读真实 HOME、业务数据写隔离目录"
// 的分裂状态）；本脚本透传而不覆盖调用方提供的值。

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    // Windows 下 shell:true 只按空格拼接参数；仓库路径含空格（如 E:\Z Code\...）时
    // node <script> 的脚本路径会被 cmd 截断成 E:\Z 并报 Cannot find module，因此先补引号。
    const spawnArgs = process.platform === "win32" ? quoteArgsForWindowsShell(args) : args;
    const child = spawn(command, spawnArgs, {
      cwd: repoRoot,
      env: withPinnedNodePath(
        {
          ...process.env,
          ZCODE_ENV: requestedEnv,
          ZCODE_DESKTOP_AGENT_BYTECODE: agentBytecode ? "1" : "0",
        },
        process.execPath,
      ),
      stdio: "inherit",
      // Windows .cmd/.bat executables (pnpm.cmd, npm.cmd, etc.) require shell: true
      shell: process.platform === "win32",
    });

    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          signal
            ? `${command} exited with signal ${signal}`
            : `${command} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

try {
  // The public dev scripts delegate here instead of invoking the package's
  // `dev` lifecycle directly, so pnpm will not run `pre-dev` automatically.
  // Preserve its runtime-asset preparation and stale `out` cleanup explicitly
  // before rebuilding bundles or starting Electron.
  await run(pnpmCommand, ["--filter", "@zcode/desktop", "pre-dev"]);
  // On Windows, use "node" (resolved via PATHEXT) to avoid "C:\Program Files\..." space issues
  await run(process.platform === "win32" ? "node" : process.execPath, [
    resolve(repoRoot, "scripts/build-desktop-agent-cli.mjs"),
  ]);
  if (agentBytecode) {
    await run(process.platform === "win32" ? "node" : process.execPath, [
      resolve(repoRoot, "scripts/build-desktop-agent-bytecode.mjs"),
    ]);
  }
  await run(pnpmCommand, ["--filter", "@zcode/desktop", "dev:runtime"]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
