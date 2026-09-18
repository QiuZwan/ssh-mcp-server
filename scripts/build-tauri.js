#!/usr/bin/env node
/**
 * Windows 桌面安装包构建：
 *   1. 构建 Admin 前端（vite）→ admin-web/dist
 *   2. 调用 tauri build 产出 NSIS 安装包（+ updater .sig）
 *
 * 注意 admin-web/dist 被 gitignore，且 Rust 壳在编译期用 include_dir! 内嵌该目录：
 * 必须先构建前端，否则 tauri build 会因目录缺失/陈旧而失败或打出旧界面。
 * sidecar 已移除——桌面壳的 SSH 连接池 / MCP StreamableHTTP / Admin 站点全部为 Rust 原生实现。
 *
 * 需 Rust 工具链（cargo/rustc）与 node_modules 里的 @tauri-apps/cli。
 * 产出：src-tauri/target/release/bundle/nsis/*-setup.exe
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = path.join(__dirname, "..");

console.log("[tauri] Building admin frontend...");
execSync(`"${process.execPath}" node_modules/vite/bin/vite.js build`, {
  stdio: "inherit",
  cwd: path.join(rootDir, "admin-web"),
});

console.log("[tauri] Running tauri build...");
execSync(`"${process.execPath}" node_modules/@tauri-apps/cli/tauri.js build`, {
  stdio: "inherit",
  cwd: rootDir,
});
console.log("[tauri] Done — installer in src-tauri/target/release/bundle/nsis/");
