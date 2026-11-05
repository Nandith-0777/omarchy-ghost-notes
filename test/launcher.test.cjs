const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
test("launcher preserves paths with spaces, validates actions, and clears Electron's Node mode", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghost-plugin-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = {
    ...process.env,
    XDG_DATA_HOME: path.join(dir, "runtime with spaces"),
    ELECTRON_RUN_AS_NODE: "1",
  };
  const result = spawnSync(
    "bash",
    [path.join(root, "scripts/runtime-path.sh")],
    { env, encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  const electron = path.join(
    result.stdout.trim(),
    "node_modules/electron/dist/electron",
  );
  fs.mkdirSync(path.dirname(electron), { recursive: true });
  fs.writeFileSync(
    electron,
    '#!/bin/sh\nprintf "%s\\n" "${ELECTRON_RUN_AS_NODE-unset}" "$@"\n',
    { mode: 0o755 },
  );
  for (const [action, flag] of [
    ["manager", "--manager"],
    ["new", "--new-note"],
  ]) {
    const launch = spawnSync(
      "bash",
      [path.join(root, "scripts/launch.sh"), action],
      { env, encoding: "utf8" },
    );
    assert.equal(launch.status, 0, launch.stderr);
    assert.deepEqual(launch.stdout.trim().split("\n"), [
      "unset",
      path.join(root, "app"),
      "--ozone-platform=x11",
      "--class=com.invisiblenotes.app",
      flag,
    ]);
  }
  const invalid = spawnSync(
    "bash",
    [path.join(root, "scripts/launch.sh"), "invalid"],
    { env, encoding: "utf8" },
  );
  assert.equal(invalid.status, 2);
});
