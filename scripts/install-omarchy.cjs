const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const { ownsAppCommandLine } = require("./installer-utils.cjs");

const root = path.resolve(__dirname, "..");
const id = require("../manifest.json").id;
const compatibility = require("../compatibility.json");
const home = os.homedir();
const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
const data = process.env.XDG_DATA_HOME || path.join(home, ".local/share");
const stateFile = path.join(data, "ghost-notes/omarchy-install.json");
const native = path.join(root, "app/dist/hyprland/ghost-notes-capture.so");
const mode = process.argv[2] || "";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const shellQuote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
const run = (command, args = [], options = {}) =>
  (
    execFileSync(command, args, {
      encoding: "utf8",
      timeout: 10000,
      env,
      ...options,
    }) || ""
  ).trim();
const json = (command, args) => JSON.parse(run(command, args));
const saveJSON = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + crypto.randomBytes(8).toString("hex");
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.renameSync(temp, file);
};
const readState = () =>
  fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
    : null;
function nativeStatus() {
  try {
    return json("hyprctl", ["ghostnotes:status", "-j"]);
  } catch {
    return null;
  }
}
function checkConfig() {
  const errors = run("hyprctl", ["configerrors"]);
  if (errors) throw new Error("Hyprland configuration errors: " + errors);
}
function stopOwnApp() {
  const clients = json("hyprctl", ["clients", "-j"]);
  const pids = new Set(
    clients
      .filter((c) =>
        ["com.invisiblenotes.app", "invisible-notes"].includes(c.class),
      )
      .map((c) => c.pid),
  );
  for (const pid of pids) {
    if (!Number.isSafeInteger(pid) || pid <= 1)
      throw new Error("Invalid application PID");
    const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`);
    if (!ownsAppCommandLine(commandLine, path.join(root, "app")))
      throw new Error(
        "Another Ghost Notes installation is running. Quit it before installing this copy.",
      );
    process.kill(pid, "SIGTERM");
  }
  if (pids.size) {
    const deadline = Date.now() + 5000;
    while ([...pids].some((pid) => fs.existsSync(`/proc/${pid}`))) {
      if (Date.now() > deadline)
        throw new Error("Ghost Notes did not stop; installation cancelled.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
const targets = [
  path.join(home, ".local/bin/ghost-notes"),
  path.join(data, "applications/com.invisiblenotes.app.desktop"),
  path.join(config, "hypr/hyprland.lua"),
  path.join(config, "hypr/ghost-notes.lua"),
  path.join(config, "hypr/autostart.lua"),
  path.join(config, "omarchy/shell.json"),
  path.join(config, "voxtype/config.toml"),
  native,
];
function backup() {
  const directory = path.join(
    data,
    "ghost-notes/install-backups",
    new Date().toISOString().replaceAll(":", "-") +
      "-" +
      crypto.randomBytes(4).toString("hex"),
  );
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const files = targets.map((target, i) => {
    if (fs.existsSync(target)) {
      if (!fs.lstatSync(target).isFile())
        throw new Error("Refusing to replace a non-file: " + target);
      const copy = path.join(directory, String(i));
      fs.copyFileSync(target, copy);
      fs.chmodSync(copy, 0o600);
      return { target, copy, mode: fs.statSync(target).mode & 0o777 };
    }
    return { target, copy: null };
  });
  saveJSON(path.join(directory, "manifest.json"), { files });
  return { directory, files };
}
function restore(snapshot) {
  for (const file of snapshot.files) {
    if (file.copy) {
      fs.mkdirSync(path.dirname(file.target), { recursive: true });
      fs.copyFileSync(file.copy, file.target);
      fs.chmodSync(file.target, file.mode);
    } else fs.rmSync(file.target, { force: true });
  }
}
function writeManaged(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode: 0o644 });
}
function installAutostart(launcher) {
  const file = path.join(config, "hypr/autostart.lua");
  const source = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const begin = "-- BEGIN Ghost Notes autostart";
  const end = "-- END Ghost Notes autostart";
  const block = `${begin}\no.launch_on_start(${JSON.stringify(shellQuote(launcher))})\n${end}`;
  const start = source.indexOf(begin),
    finish = source.indexOf(end);
  if (start >= 0 !== finish >= 0 || (start >= 0 && finish < start))
    throw new Error(
      "Incomplete Ghost Notes autostart markers; refusing to overwrite user configuration.",
    );
  writeManaged(
    file,
    start < 0
      ? source.trimEnd() + "\n\n" + block + "\n"
      : source.slice(0, start) + block + source.slice(finish + end.length),
  );
}
function optionalDictation() {
  const file = path.join(config, "voxtype/config.toml");
  if (!fs.existsSync(file)) return;
  try {
    run("python3", [
      path.join(root, "app/scripts/voxtype-ghost-notes.py"),
      "--install",
    ]);
    const status = run("voxtype", ["status"]);
    if (status === "idle") run("systemctl", ["--user", "restart", "voxtype"]);
    else
      console.log(
        "Dictation is in use; its integration takes effect after Voxtype next restarts.",
      );
  } catch {
    console.log(
      "Existing Voxtype configuration was retained; its optional dictation helper was not activated.",
    );
  }
}
function launch() {
  const logDir = path.join(data, "ghost-notes");
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(logDir, "app.log"), "a", 0o600);
  const child = spawn(
    "bash",
    [path.join(root, "scripts/launch.sh"), "manager"],
    { detached: true, env, stdio: ["ignore", log, log] },
  );
  child.on("error", (error) =>
    console.error("Launch failed: " + error.message),
  );
  child.unref();
  fs.closeSync(log);
}
function main() {
  if (!["", "--check", "--no-launch", "--uninstall"].includes(mode))
    throw new Error("Invalid installer option");
  const version = json("hyprctl", ["version", "-j"]);
  const omarchy = run("omarchy", ["version"]);
  if (
    mode !== "--uninstall" &&
    (!compatibility.omarchyVersions.includes(omarchy.split("-")[0]) ||
      version.commit !== compatibility.hyprlandCommit ||
      version.version !== compatibility.hyprlandVersion)
  )
    throw new Error(
      "Unsupported Omarchy/Hyprland build; configuration was not changed.",
    );
  if (mode !== "--uninstall") checkConfig();
  if (mode === "--check") {
    console.log(
      `Compatible: Omarchy ${omarchy}, Hyprland ${version.version}, exact build ${version.commit}.`,
    );
    return;
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    throw new Error("Node.js 22.12+ is required");
  const expectedRoot = path.join(home, ".config/omarchy/plugins", id);
  if (fs.realpathSync(root) !== path.resolve(expectedRoot))
    throw new Error(
      "Install this checkout using omarchy plugin add first; see README.md for the one-command installation.",
    );
  const state = readState();
  if (state && state.root !== root)
    throw new Error(
      "Another Ghost Notes installation owns the desktop integration",
    );
  if (nativeStatus()?.mode === "compositor-omit" && !state)
    throw new Error(
      "An unmanaged Ghost Notes capture companion is already loaded; keep it or disable it before replacing its integration.",
    );
  if (mode === "--uninstall") {
    if (!state)
      throw new Error(
        "No automatic installation is recorded; configuration was not changed",
      );
    for (const [file, expected] of Object.entries(
      state.installedHashes || {},
    )) {
      const actual = fs.existsSync(file)
        ? crypto
            .createHash("sha256")
            .update(fs.readFileSync(file))
            .digest("hex")
        : null;
      if (actual !== expected)
        throw new Error(
          "Configuration changed since installation; refusing to overwrite it: " +
            file +
            ". Backups remain at " +
            state.originalBackup,
        );
    }
    stopOwnApp();
    try {
      run("hyprctl", ["plugin", "unload", native]);
    } catch {}
    const snapshot = jsonFromFile(state.originalBackup);
    restore(snapshot);
    run("hyprctl", ["reload"]);
    checkConfig();
    fs.rmSync(stateFile, { force: true });
    console.log(
      "Original desktop configuration restored. Notes, installed packages, and runtime downloads were kept.",
    );
    return;
  }
  // Headers must describe the running compositor, not a pending upgrade.
  const prefix = run("pkg-config", ["--variable=prefix", "hyprland"]);
  const header = fs.readFileSync(
    path.join(prefix, "hyprland/src/version.h"),
    "utf8",
  );
  if (
    !header.includes(`\"${version.commit}\"`) ||
    !header.includes(`\"v${version.version}\"`)
  )
    throw new Error(
      "Installed Hyprland headers do not match the running compositor. Restart into the installed version first.",
    );
  run("omarchy", ["plugin", "validate", root]);
  const snapshot = backup();
  let touched = false;
  try {
    run("bash", [path.join(root, "scripts/setup.sh")], {
      timeout: 600000,
      stdio: "inherit",
    });
    run("bash", [path.join(root, "app/scripts/build-capture-plugin.sh")], {
      timeout: 300000,
      stdio: "inherit",
    });
    stopOwnApp();
    if (nativeStatus()?.mode === "compositor-omit")
      run("hyprctl", ["plugin", "unload", native]);
    touched = true;
    const runtime = run("bash", [path.join(root, "scripts/runtime-path.sh")]);
    const { installLinuxDesktop } = require("../app/platform");
    const desktop = installLinuxDesktop({
      home,
      electronPath: path.join(runtime, "node_modules/electron/dist/electron"),
      hyprland: true,
      capturePlugin: true,
    });
    installAutostart(desktop.launcher);
    run("hyprctl", ["reload"]);
    checkConfig();
    if (nativeStatus()?.mode !== "compositor-omit")
      throw new Error("Capture companion did not become active");
    run("omarchy", ["plugin", "enable", id, "--section", "right"]);
    optionalDictation();
    saveJSON(stateFile, {
      root,
      originalBackup:
        state?.originalBackup || path.join(snapshot.directory, "manifest.json"),
      lastBackup: path.join(snapshot.directory, "manifest.json"),
      compositor: version.commit,
      installedHashes: Object.fromEntries(
        targets.map((file) => [
          file,
          fs.existsSync(file)
            ? crypto
                .createHash("sha256")
                .update(fs.readFileSync(file))
                .digest("hex")
            : null,
        ]),
      ),
    });
    console.log(
      "Ghost Notes is installed. Capture companion active, bar enabled, launcher and login startup configured.",
    );
    console.log("Backup: " + snapshot.directory);
    console.log(
      "Capture protection covers supported compositor sharing; direct GPU/KMS and X11 capture are not excluded.",
    );
    if (mode !== "--no-launch") launch();
  } catch (error) {
    if (touched) {
      try {
        run("hyprctl", ["plugin", "unload", native]);
      } catch {}
    }
    restore(snapshot);
    if (touched) {
      try {
        run("hyprctl", ["reload"]);
        checkConfig();
      } catch (rollback) {
        console.error(
          "Configuration restored but reload needs attention: " +
            rollback.message,
        );
      }
    }
    throw error;
  }
}
function jsonFromFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
try {
  main();
} catch (error) {
  console.error("Ghost Notes install: " + error.message);
  process.exitCode = 1;
}
