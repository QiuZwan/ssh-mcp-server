// 全局默认值的唯一来源：后端路由与前端（经 /admin/api/defaults）共用，
// 防止多处写死后漂移（安全黑名单漂移尤其危险）。

// 新建项目时自动创建的默认环境
export const DEFAULT_ENVIRONMENTS: string[] = ["开发环境", "测试环境", "生产环境", "UAT环境"];

// 未配置安全策略时的默认命令黑名单（行首锚定正则）
export const DEFAULT_COMMAND_BLACKLIST: string[] = [
  "^rm\\s+.*",
  "^shutdown.*",
  "^reboot.*",
  "^halt.*",
  "^poweroff.*",
  "^mkfs.*",
  "^dd\\s+.*",
];

// 默认审计策略：开启审计、开启成功执行记录、保留 30 天
export const DEFAULT_AUDIT_SETTINGS = {
  enabled: true,
  retentionDays: 30,
  logResults: true,
};

// 默认备份策略：保留 30 天、最多 20 份、默认不开启定时自动备份、默认间隔 24 小时
export const DEFAULT_BACKUP_SETTINGS = {
  retentionDays: 30,
  maxCount: 20,
  autoEnabled: false,
  intervalHours: 24,
};

// 默认安全策略：默认预设高危命令黑名单，白名单与目录留空
export const DEFAULT_SECURITY = {
  commandWhitelist: [] as string[],
  commandBlacklist: [...DEFAULT_COMMAND_BLACKLIST],
  allowedLocalPaths: [] as string[],
  allowedRemotePaths: [] as string[],
};

