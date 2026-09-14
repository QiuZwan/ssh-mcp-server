/**
 * npx 默认模式的 stdio→HTTP 转发代理：
 * - stdin 每行一条 JSON-RPC 消息，POST 到 admin 常驻服务的无状态 /mcp 端点；
 * - 响应兼容 application/json 与 text/event-stream（SDK StreamableHTTP 默认 SSE），
 *   提取 JSON 后回写 stdout；通知类消息（202）无回写；
 * - admin 服务未运行时自动分离拉起，日志落 config 同目录 daemon.log；
 * - 本进程所有日志走 stderr，stdout 仅承载 MCP 协议消息。
 */
import { spawn, exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { ConfigStore, getGlobalConfigPath } from "../services/config-store.js";
import { DEFAULT_ADMIN_PORT } from "../models/admin-types.js";
import { SERVER_CONFIG } from "../config/server.js";
import { Logger } from "../utils/logger.js";

/** 探测端口上是否为本项目的 admin 常驻服务（校验 system/info 返回结构） */
export async function probeAdminServer(port: number, timeoutMs = 800): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/system/info`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { version?: unknown; port?: unknown };
    return typeof body?.version === "string" || typeof body?.port === "number";
  } catch {
    return false;
  }
}

/** 从 StreamableHTTP 响应体提取待回写 stdout 的 JSON 串（兼容 application/json 与 text/event-stream） */
export async function extractResponseJsonLines(res: Response): Promise<string[]> {
  const contentType = String(res.headers.get("content-type") || "");
  const text = await res.text();
  if (contentType.includes("text/event-stream")) {
    const payloads: string[] = [];
    for (const block of text.split(/\r?\n\r?\n/)) {
      for (const line of block.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload && payload !== "[DONE]") payloads.push(payload);
      }
    }
    return payloads;
  }
  // application/json 或其他：仅当 body 可解析为 JSON 时透传
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    JSON.parse(trimmed);
    return [trimmed];
  } catch {
    return [];
  }
}

/** 启动失败后继续应答客户端请求的宽限窗口，保证客户端拿到「失败原因」而不是连接被直接关闭 */
const FAILURE_GRACE_MS = 5000;

/** 启动失败时附带的 daemon.log 末尾行数（真实死因通常只在这里可见，如 EADDRINUSE） */
const DAEMON_LOG_TAIL_LINES = 5;

/** 向 stdout 回写一条 JSON-RPC 错误响应（stdout 只承载协议消息，日志一律走 stderr） */
export function writeJsonRpcError(id: unknown, message: string, code = -32000): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

/** 解析一行 stdio 消息并取出 id；ok=false 表示不是合法 JSON，hasId=false 表示是通知 */
export function parseStdioLine(line: string): { ok: boolean; hasId: boolean; id: unknown } {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "id" in parsed) {
      return { ok: true, hasId: true, id: (parsed as { id: unknown }).id };
    }
    return { ok: true, hasId: false, id: undefined };
  } catch {
    return { ok: false, hasId: false, id: undefined };
  }
}

/**
 * 读取 daemon.log 末尾若干行。
 * 常驻服务起不来时，真正的死因（端口被占、原生模块加载失败等）只写在这个日志里，
 * 不回带给客户端的话用户就只能看到一个没有上下文的「连接关闭」。
 */
export function readDaemonLogTail(maxLines = DAEMON_LOG_TAIL_LINES): string {
  try {
    const logFile = path.join(path.dirname(getGlobalConfigPath()), "daemon.log");
    if (!fs.existsSync(logFile)) return "";
    const lines = fs.readFileSync(logFile, "utf8").trimEnd().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return "";
    return lines.slice(-maxLines).join(" ｜ ");
  } catch {
    return "";
  }
}

export class StdioProxy {
  private targetUrl: string | null;
  private buffered: string[] = [];
  private readline: ReturnType<typeof createInterface> | null = null;
  private failureReason: string | null = null;
  private closed = false;

  constructor(targetUrl: string | null = null) {
    this.targetUrl = targetUrl;
  }

  /**
   * 立即开始读取 stdin，stdin 关闭（MCP 客户端退出）后返回。
   * 必须在 ensureAdminServer 之前调用：常驻服务拉起最长要等 15 秒，期间客户端发来的
   * initialize 会滞留在管道缓冲里；晚建 readline 就等于在启动失败时把它直接丢掉，
   * 客户端只能看到「连接关闭」而拿不到任何原因。
   */
  start(): Promise<void> {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    this.readline = rl;
    rl.on("line", (line) => {
      if (this.targetUrl) {
        void this.forwardLine(line);
      } else if (this.failureReason !== null) {
        this.replyFailure(line);
      } else {
        this.buffered.push(line);
      }
    });
    return new Promise<void>((resolve) =>
      rl.on("close", () => {
        this.closed = true;
        resolve();
      }),
    );
  }

  /** 常驻服务就绪：切换到转发模式，并补发缓冲期间收到的请求 */
  setTarget(targetUrl: string): void {
    this.targetUrl = targetUrl;
    const pending = this.buffered;
    this.buffered = [];
    for (const line of pending) {
      void this.forwardLine(line);
    }
  }

  /**
   * 启动失败：把原因回给客户端。
   * 先应答已缓冲的请求，再在宽限窗口内继续应答后续请求；客户端一旦关闭 stdin（放弃等待）
   * 就立即收尾，不必空等满窗口。最后关闭 stdin 让进程退出。
   */
  async fail(reason: string): Promise<void> {
    this.failureReason = reason;
    const pending = this.buffered;
    this.buffered = [];
    for (const line of pending) {
      this.replyFailure(line);
    }
    if (!this.closed) {
      await Promise.race([
        sleep(FAILURE_GRACE_MS),
        new Promise<void>((resolve) => {
          if (this.closed) return resolve();
          this.readline?.once("close", () => resolve());
        }),
      ]);
    }
    this.readline?.close();
  }

  /** 对一条客户端消息回写失败原因（通知类无 id，无需应答） */
  private replyFailure(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    const { hasId, id } = parseStdioLine(trimmed);
    if (!hasId) return;
    writeJsonRpcError(id, this.failureReason ?? "ssh-mcp-server 启动失败");
  }

  private async forwardLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    const { ok, hasId, id: requestId } = parseStdioLine(trimmed);
    if (!ok) {
      Logger.log("proxy: 收到无法解析的 stdio 行，已忽略", "error");
      return;
    }
    try {
      const res = await fetch(this.targetUrl!, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: trimmed,
      });
      if (res.status === 202) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const json of await extractResponseJsonLines(res)) {
        process.stdout.write(json + "\n");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.log(`proxy: 转发失败: ${message}`, "error");
      if (hasId) {
        writeJsonRpcError(requestId, `ssh-mcp-server 常驻服务不可达: ${message}`);
      }
    }
  }
}

/** 解析 admin 端口：CLI 显式指定 > 配置文件 port > 默认 61823 */
async function resolveAdminPort(cliPort?: number): Promise<number> {
  if (cliPort) return cliPort;
  const configPath = process.env.SSH_MCP_CONFIG ? path.resolve(process.env.SSH_MCP_CONFIG) : undefined;
  try {
    const store = new ConfigStore({ configPath });
    const cfg = await store.load();
    if (typeof cfg?.port === "number" && cfg.port > 0) return cfg.port;
  } catch {
    // 配置读取失败时回退默认端口
  }
  return DEFAULT_ADMIN_PORT;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 读取目标端口 admin 常驻服务的版本号，探测失败或结构异常返回 null */
export async function getAdminServerVersion(port: number, timeoutMs = 800): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/system/info`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body?.version === "string" && body.version ? body.version : null;
  } catch {
    return null;
  }
}

/** 逐段比较 x.y.z 版本号，返回 a-b（>0 表示 a 更新；缺省段按 0 处理） */
export function compareVersions(a: string, b: string): number {
  const seg = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const sa = seg(a);
  const sb = seg(b);
  for (let i = 0; i < 3; i++) {
    const diff = (sa[i] ?? 0) - (sb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 解析端口监听进程的 PID 集合（导出仅为测试）。
 * Windows 取 netstat -ano 输出（TCP <local> <foreign> LISTENING <pid>），并按本地地址精确匹配端口；
 * 其他平台取 lsof -t 输出（每行一个 PID，已由参数过滤端口）。
 */
export function parseListenerOutput(stdout: string, platform: string, port: number): number[] {
  const pids = new Set<number>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (platform === "win32") {
      if (!line.includes("LISTENING")) continue;
      const parts = line.split(/\s+/);
      // TCP <local> <foreign> LISTENING <pid>
      if (parts.length < 5 || !parts[1].endsWith(`:${port}`)) continue;
      const pid = parseInt(parts[4], 10);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    } else {
      const pid = parseInt(line, 10);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  }
  return [...pids];
}

/** 查询监听指定 TCP 端口的进程 PID（Windows netstat / macOS·Linux lsof），查询失败返回空数组 */
export async function findListenerPids(port: number): Promise<number[]> {
  const cmd =
    process.platform === "win32"
      ? `netstat -ano -p tcp | findstr "LISTENING"`
      : `lsof -nP -iTCP:${port} -sTCP:LISTEN -t`;
  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err && !stdout) return resolve([]);
      resolve(parseListenerOutput(String(stdout), process.platform, port));
    });
  });
}

/** 定位入口脚本（argv[1]），供分离拉起 daemon 使用 */
function locateEntryScript(): string {
  const script = process.argv[1] ? path.resolve(process.argv[1]) : "";
  if (!script || !fs.existsSync(script)) {
    throw new Error(`无法定位入口脚本（argv[1]=${process.argv[1] ?? "空"}），请改用 --stdio 或手动运行 --admin`);
  }
  return script;
}

/**
 * 以分离进程拉起 admin 常驻服务并等待就绪。
 * cwd 必须用主目录而非包安装目录：Windows 下进程 CWD 所在目录不可被重命名，
 * npx 升级重装时 npm 需要先 rename 包目录，否则 EBUSY（v1.1.1 及之前因此升级失败）。
 */
async function spawnAdminServerAndWait(port: number): Promise<void> {
  const script = locateEntryScript();
  const logDir = path.dirname(getGlobalConfigPath());
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "daemon.log");
  const child = spawn(process.execPath, [script, "--admin", "--admin-port", String(port)], {
    detached: true,
    stdio: ["ignore", fs.openSync(logFile, "a"), fs.openSync(logFile, "a")],
    cwd: os.homedir(),
  });
  child.unref();

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if (await probeAdminServer(port, 500)) return;
    await sleep(300);
  }
  throw new Error(`admin 常驻服务在端口 ${port} 未能就绪，请查看日志: ${logFile}`);
}

/**
 * 已运行的 daemon 版本落后于当前包时将其停止并等待端口释放（供调用方拉起新版），否则返回 false。
 * 版本未知或高于当前包（回滚场景）一律复用，避免误杀。
 */
async function stopOutdatedAdminServer(port: number): Promise<boolean> {
  const daemonVersion = await getAdminServerVersion(port);
  // 非数字版本（stub/dev 等自定义构建）不参与比较，一律复用
  if (!daemonVersion || !/^\d+\.\d+\.\d+/.test(daemonVersion)) return false;
  if (compareVersions(daemonVersion, SERVER_CONFIG.version) >= 0) return false;
  const pids = await findListenerPids(port);
  if (pids.length === 0) return false;
  Logger.log(`admin 常驻服务版本 ${daemonVersion} 低于当前 ${SERVER_CONFIG.version}，自动重启以应用新版本`, "info");
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // 进程可能恰好自行退出
    }
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if ((await findListenerPids(port)).length === 0) return true;
    await sleep(300);
  }
  // 宽限期内未退出则强杀
  for (const pid of await findListenerPids(port)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 进程已退出
    }
  }
  await sleep(500);
  return true;
}

/** 确保 admin 常驻服务在目标端口可用：未运行则分离拉起；运行中但版本落后则自动换新 */
export async function ensureAdminServer(port: number): Promise<void> {
  if (await probeAdminServer(port)) {
    if (await stopOutdatedAdminServer(port)) {
      await spawnAdminServerAndWait(port);
    }
    return;
  }
  await spawnAdminServerAndWait(port);
}

/**
 * 代理模式主流程：先开始读 stdin → 解析端口 → 确保 admin 服务运行 → stdio 转发。
 * 启动失败时把原因回写给客户端（此前只写 stderr 就退出，客户端只能看到「连接关闭」）。
 * stdin 关闭后返回（admin 服务保持常驻，供下一次 MCP 会话复用）。
 */
export async function runProxyMode(opts: { adminPort?: number } = {}): Promise<void> {
  const proxy = new StdioProxy();
  const intake = proxy.start();

  try {
    const port = await resolveAdminPort(opts.adminPort);
    await ensureAdminServer(port);
    Logger.log(`ssh-mcp-server 管理台: http://127.0.0.1:${port}/admin/`, "info");
    proxy.setTarget(`http://127.0.0.1:${port}/mcp`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tail = readDaemonLogTail();
    const reason = tail ? `${message}｜daemon.log 末尾: ${tail}` : message;
    Logger.log(`proxy: 启动失败: ${reason}`, "error");
    await proxy.fail(reason);
    process.exitCode = 1;
    await intake;
    return;
  }

  await intake;
}
