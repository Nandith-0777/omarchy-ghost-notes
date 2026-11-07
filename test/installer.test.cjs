const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const source = path.resolve(__dirname, "..");
const hash = require("../compatibility.json").hyprlandCommit;
function fixture(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghost-auto-install-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home with spaces");
  const root = path.join(
    home,
    ".config/omarchy/plugins/io.github.nandith-0777.ghost-notes",
  );
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  for (const name of [
    "scripts",
    "runtime",
    "compatibility.json",
    "manifest.json",
    "app/platform.js",
    "app/manager/key-combo.js",
    "app/scripts",
    "app/integrations/hyprland.lua",
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.cpSync(path.join(source, name), path.join(root, name), {
      recursive: true,
    });
  }
  fs.mkdirSync(path.join(home, ".config/hypr"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".config/hypr/hyprland.lua"),
    "-- existing desktop\n",
  );
  fs.writeFileSync(
    path.join(home, ".config/hypr/autostart.lua"),
    "-- keep my apps\n",
  );
  const header = path.join(dir, "include/hyprland/src/version.h");
  fs.mkdirSync(path.dirname(header), { recursive: true });
  fs.writeFileSync(
    header,
    `#define GIT_COMMIT_HASH "${hash}"\n#define GIT_TAG "v0.56.2"\n`,
  );
  const state = path.join(dir, "fake-state.json");
  fs.writeFileSync(state, JSON.stringify({ active: false, reloads: 0 }));
  const driver = path.join(bin, "mock.cjs");
  fs.writeFileSync(
    driver,
    `
const fs=require('node:fs'),path=require('node:path');
const [cmd,...args]=process.argv.slice(2); const E=process.env;
const state=JSON.parse(fs.readFileSync(E.FAKE_STATE));
const save=()=>fs.writeFileSync(E.FAKE_STATE,JSON.stringify(state));
fs.appendFileSync(E.FAKE_LOG,JSON.stringify([cmd,...args])+'\\n');
if(cmd==='omarchy'){
 if(args[0]==='version') console.log('4.5.0-3');
 if(args[0]==='plugin'&&args[1]==='enable') {
   fs.mkdirSync(path.join(E.HOME,'.config/omarchy'),{recursive:true});
   fs.writeFileSync(path.join(E.HOME,'.config/omarchy/shell.json'),'enabled');
 }
}else if(cmd==='hyprctl'){
 if(args[0]==='version')console.log(JSON.stringify({version:'0.56.2',commit:E.FAKE_HASH}));
 else if(args[0]==='clients')console.log('[]');
 else if(args[0]==='configerrors')console.log(E.FAKE_RELOAD_FAIL==='1'&&state.reloads===1?'fixture config error':'');
 else if(args[0]==='ghostnotes:status'){if(!state.active)process.exit(1);console.log(JSON.stringify({mode:'compositor-omit'}));}
 else if(args[0]==='plugin'&&args[1]==='unload'){state.active=false;save();}
 else if(args[0]==='reload'){
   state.reloads++;const config=path.join(E.HOME,'.config/hypr/ghost-notes.lua');
   state.active=fs.existsSync(config)&&fs.readFileSync(config,'utf8').includes('hl.plugin.load');save();
 }
}else if(cmd==='pkg-config'){
 if(args[0]==='--variable=prefix')console.log(E.FAKE_PREFIX);
}else if(cmd==='c++'){
 if(E.FAKE_BUILD_FAIL==='1')process.exit(2);
 fs.writeFileSync(args[args.indexOf('-o')+1],'fixture native plugin');
}else if(cmd==='npm'){
 const prefix=args[args.indexOf('--prefix')+1], electron=path.join(prefix,'node_modules/electron');
 fs.mkdirSync(path.join(electron,'dist'),{recursive:true});fs.writeFileSync(path.join(electron,'install.js'),'');
 fs.writeFileSync(path.join(electron,'dist/electron'),'#!/bin/sh\\nexit 0\\n',{mode:0o755});
}
`,
  );
  for (const command of ["omarchy", "hyprctl", "pkg-config", "c++", "npm"])
    fs.writeFileSync(
      path.join(bin, command),
      `#!/bin/sh\nexec '${process.execPath}' '${driver}' '${command}' "$@"\n`,
      { mode: 0o755 },
    );
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local/share"),
    PATH: bin + path.delimiter + process.env.PATH,
    HYPRLAND_INSTANCE_SIGNATURE: "fixture",
    FAKE_STATE: state,
    FAKE_LOG: path.join(dir, "commands.jsonl"),
    FAKE_PREFIX: path.join(dir, "include"),
    FAKE_HASH: hash,
    ...extra,
  };
  const execute = (...args) =>
    spawnSync(
      process.execPath,
      [path.join(root, "scripts/install-omarchy.cjs"), ...args],
      { env, encoding: "utf8", timeout: 30000 },
    );
  return {
    dir,
    home,
    root,
    env,
    execute,
    state,
    log: () =>
      fs.readFileSync(env.FAKE_LOG, "utf8").trim().split("\n").map(JSON.parse),
  };
}

test("fresh installation builds capture, configures desktop/bar/startup, and supports rerun and removal", (t) => {
  const f = fixture(t);
  let result = f.execute("--no-launch");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const rules = path.join(f.home, ".config/hypr/ghost-notes.lua");
  assert.match(fs.readFileSync(rules, "utf8"), /hl\.plugin\.load/);
  const startup = path.join(f.home, ".config/hypr/autostart.lua");
  assert.match(fs.readFileSync(startup, "utf8"), /o\.launch_on_start/);
  assert.match(fs.readFileSync(startup, "utf8"), /keep my apps/);
  const launcher = path.join(f.home, ".local/bin/ghost-notes");
  assert.ok(fs.statSync(launcher).mode & 0o100);
  assert.equal(JSON.parse(fs.readFileSync(f.state)).active, true);
  assert.ok(
    f
      .log()
      .some(
        (a) => a[0] === "omarchy" && a[1] === "plugin" && a[2] === "enable",
      ),
  );
  result = f.execute("--no-launch");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(
    fs.readFileSync(startup, "utf8").match(/BEGIN Ghost Notes autostart/g)
      .length,
    1,
  );
  result = f.execute("--uninstall");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(fs.readFileSync(startup, "utf8"), "-- keep my apps\n");
  assert.equal(
    fs.readFileSync(path.join(f.home, ".config/hypr/hyprland.lua"), "utf8"),
    "-- existing desktop\n",
  );
  assert.equal(fs.existsSync(rules), false);
  assert.equal(fs.existsSync(launcher), false);
});
test("unsupported compositor is rejected before any build or configuration change", (t) => {
  const f = fixture(t, { FAKE_HASH: "different-build" });
  const result = f.execute("--no-launch");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported/);
  assert.equal(
    f.log().some((a) => ["npm", "c++"].includes(a[0])),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(f.home, ".config/hypr/ghost-notes.lua")),
    false,
  );
});
test("compiler failure preserves original desktop files", (t) => {
  const f = fixture(t, { FAKE_BUILD_FAIL: "1" });
  const result = f.execute("--no-launch");
  assert.notEqual(result.status, 0);
  assert.equal(
    fs.readFileSync(path.join(f.home, ".config/hypr/hyprland.lua"), "utf8"),
    "-- existing desktop\n",
  );
  assert.equal(
    fs.existsSync(path.join(f.home, ".local/bin/ghost-notes")),
    false,
  );
});
test("failed compositor validation rolls back configuration and unloads the companion", (t) => {
  const f = fixture(t, { FAKE_RELOAD_FAIL: "1" });
  const result = f.execute("--no-launch");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /configuration errors/);
  assert.equal(
    fs.readFileSync(path.join(f.home, ".config/hypr/autostart.lua"), "utf8"),
    "-- keep my apps\n",
  );
  assert.equal(
    fs.existsSync(path.join(f.home, ".config/hypr/ghost-notes.lua")),
    false,
  );
  assert.equal(JSON.parse(fs.readFileSync(f.state)).active, false);
});
test("compatibility check does not install packages, build, or write desktop files", (t) => {
  const f = fixture(t);
  const result = f.execute("--check");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Compatible/);
  assert.equal(
    f.log().some((a) => ["npm", "c++"].includes(a[0])),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(f.home, ".local/bin/ghost-notes")),
    false,
  );
});

test("uninstall refuses to discard desktop edits made after installation", (t) => {
  const f = fixture(t);
  let result = f.execute("--no-launch");
  assert.equal(result.status, 0, result.stderr);
  const startup = path.join(f.home, ".config/hypr/autostart.lua");
  fs.appendFileSync(startup, "\n-- new personal startup app\n");
  result = f.execute("--uninstall");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /changed since installation/);
  assert.match(fs.readFileSync(startup, "utf8"), /new personal startup app/);
});
test("pending header upgrade is rejected before runtime installation or build", (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    path.join(f.env.FAKE_PREFIX, "hyprland/src/version.h"),
    '#define GIT_COMMIT_HASH "other"\n',
  );
  const result = f.execute("--no-launch");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /headers do not match/);
  assert.equal(
    f.log().some((a) => ["npm", "c++"].includes(a[0])),
    false,
  );
});
test("one-command bootstrap installs dependencies and completes the transaction", (t) => {
  const f = fixture(t);
  const result = spawnSync(
    "bash",
    [path.join(f.root, "scripts/install.sh"), "--no-launch"],
    { env: f.env, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(
    f.log().some((a) => a[0] === "omarchy" && a[1] === "pkg" && a[2] === "add"),
  );
  assert.equal(JSON.parse(fs.readFileSync(f.state)).active, true);
});
test("bootstrap refuses unsupported builds before installing packages", (t) => {
  const f = fixture(t, { FAKE_HASH: "different-build" });
  const result = spawnSync(
    "bash",
    [path.join(f.root, "scripts/install.sh"), "--no-launch"],
    { env: f.env, encoding: "utf8", timeout: 30000 },
  );
  assert.notEqual(result.status, 0);
  assert.equal(
    f.log().some((a) => a[0] === "omarchy" && a[1] === "pkg"),
    false,
  );
});

test("app ownership recognizes Electron process titles without matching another installation", () => {
  const { ownsAppCommandLine } = require("../scripts/installer-utils.cjs");
  const app = "/home/user with spaces/.config/omarchy/plugins/ghost/app";
  assert.equal(
    ownsAppCommandLine(Buffer.from("electron\0" + app + "\0--manager\0"), app),
    true,
  );
  assert.equal(
    ownsAppCommandLine(Buffer.from("electron --manager " + app + "\0"), app),
    true,
  );
  assert.equal(
    ownsAppCommandLine(Buffer.from("electron " + app + " --manager\0"), app),
    true,
  );
  assert.equal(
    ownsAppCommandLine(
      Buffer.from("electron " + app + "-other --manager\0"),
      app,
    ),
    false,
  );
  assert.equal(
    ownsAppCommandLine(Buffer.from("electron /other/checkout/app\0"), app),
    false,
  );
});
