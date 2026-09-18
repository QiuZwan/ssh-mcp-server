import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveRunMode, parseAdminPort } from "../build/cli/run-mode.js";

describe("run-mode", () => {
  it("defaults to stdio mode when no args are given", () => {
    assert.equal(resolveRunMode([]).mode, "stdio");
  });

  it("routes --admin to admin mode", () => {
    assert.equal(resolveRunMode(["--admin"]).mode, "admin");
    assert.equal(resolveRunMode(["--admin", "--admin-port", "7000"]).adminPort, 7000);
  });

  it("keeps stdio mode when SSH config args are given", () => {
    for (const argv of [
      ["--config-file", "cfg.json"],
      ["-h", "1.2.3.4", "-p", "22", "-u", "root", "-w", "pwd"],
      ["--host", "srv", "--username", "root"],
      ["--ssh", '{"host":"srv"}'],
      ["--transport-mode", "shell"],
      ["--pre-connect"],
      ["-W", "ls,cat"],
      ["--proxy", "socks5://127.0.0.1:1080"],
    ]) {
      assert.equal(resolveRunMode(argv).mode, "stdio", `argv=${JSON.stringify(argv)}`);
    }
  });

  it("treats --stdio as an accepted no-op (stdio is already the default)", () => {
    assert.equal(resolveRunMode(["--stdio"]).mode, "stdio");
    assert.equal(resolveRunMode(["--stdio", "--admin"]).mode, "admin");
  });

  it("ignores a bare --admin-port without --admin", () => {
    const mode = resolveRunMode(["--admin-port", "7000"]);
    assert.equal(mode.mode, "stdio");
  });

  it("rejects invalid --admin-port values", () => {
    assert.equal(parseAdminPort(["--admin-port", "abc"]), undefined);
    assert.equal(parseAdminPort(["--admin-port", "0"]), undefined);
    assert.equal(parseAdminPort(["--admin-port", "70000"]), undefined);
    assert.equal(parseAdminPort(["--admin-port"]), undefined);
  });
});
