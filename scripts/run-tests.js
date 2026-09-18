#!/usr/bin/env node

/**
 * 测试运行器
 * 使用 Node.js 内置的测试框架运行所有测试
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'node:url';

console.log('🧪 运行测试...\n');

// 必须用 fileURLToPath：URL.pathname 在 Windows 上会保留盘符前的斜杠并把空格转义成 %20，
// 路径含空格（如 ".../Project Files/..."）时 cwd 无效，execSync 直接 ENOENT。
const rootDir = fileURLToPath(new URL('..', import.meta.url));

try {
  execSync('node scripts/build.js', {
    stdio: 'inherit',
    cwd: rootDir
  });
  execSync('node --test test/**/*.test.js', {
    stdio: 'inherit',
    cwd: rootDir
  });
} catch (err) {
  process.exit(1);
}
