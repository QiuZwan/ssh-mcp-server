/**
 * 运行模式路由：
 * - --admin → admin 常驻服务（管理台 + HTTP MCP；桌面版由 Tauri 壳以原生实现承担同一角色）
 * - 其余    → 传统 stdio MCP（MCP 客户端拉起子进程直连）
 */
export interface RunMode {
  mode: "admin" | "stdio";
  adminPort?: number;
}

/** 解析 --admin-port 的值，非法或缺参返回 undefined */
export function parseAdminPort(argv: string[]): number | undefined {
  const idx = argv.indexOf("--admin-port");
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  const port = parseInt(argv[idx + 1], 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

export function resolveRunMode(argv: string[]): RunMode {
  if (argv.includes("--admin")) return { mode: "admin", adminPort: parseAdminPort(argv) };
  return { mode: "stdio" };
}
