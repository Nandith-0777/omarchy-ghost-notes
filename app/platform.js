const shortcutKeys = require("./manager/key-combo");
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";
const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { createHash } = require("node:crypto");

const DESKTOP_ID = "com.invisiblenotes.app.desktop";
const NOTE_TITLE = "Ghost Notes Note";
let linuxBackend = null;
let compositorMask = false;
let compositorOmit = false;
let captureStatusChecked = false;
let storageStatus = { encrypted: false, backend: "unavailable" };
let shortcutStatus = "not-registered";
let desktopCommand = null;
const compositorBindings = new Map();
let shortcutConflict = false;
let shortcutOwner = null;
const pointerRecovery = new WeakMap();
const inputUpdates = new WeakMap();
const nativeInputOwners = new WeakSet();
const pinnedWindows = new WeakMap();

function syncCompositorPin(win, pinned) {
  if (
    !isLinux ||
    linuxBackend === "wayland" ||
    !process.env.HYPRLAND_INSTANCE_SIGNATURE ||
    !win.getNativeWindowHandle
  )
    return;
  const previous = pinnedWindows.get(win);
  if (previous) clearTimeout(previous.timer);
  const registration = { pinned, timer: null };
  pinnedWindows.set(win, registration);
  const attempt = (remaining) => {
    if (win.isDestroyed() || pinnedWindows.get(win) !== registration) return;
    try {
      const xid = win.getNativeWindowHandle().readUInt32LE(0);
      execFile(
        "hyprctl",
        ["ghostnotes:pin", String(xid), pinned ? "1" : "0"],
        { encoding: "utf8", timeout: 1000 },
        (error, result) => {
          if (
            error ||
            win.isDestroyed() ||
            pinnedWindows.get(win) !== registration
          )
            return;
          if (result.trim() === "not-mapped" && remaining > 0) {
            registration.timer = setTimeout(() => attempt(remaining - 1), 100);
            registration.timer.unref?.();
          }
        },
      );
    } catch {
      /* The companion plugin is optional outside Hyprland. */
    }
  };
  registration.timer = setTimeout(() => attempt(10), 100);
  registration.timer.unref?.();
}

const sharingUpdates = new WeakMap();
function setSharingVisibility(win, shareVisible) {
  if (!isLinux || !win.setTitle) return;
  const previous = sharingUpdates.get(win);
  if (previous?.timer) clearTimeout(previous.timer);
  const update = { timer: null };
  sharingUpdates.set(win, update);
  const title = shareVisible ? NOTE_TITLE + " — Shared" : NOTE_TITLE;
  if (!shareVisible || !process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    win.setTitle(title);
    return;
  }
  // Preserve the initial title used to identify notes for input and pinning.
  // A saved shared note starts private until the compositor has mapped it.
  const attempt = (remaining) => {
    if (win.isDestroyed() || sharingUpdates.get(win) !== update) return;
    try {
      const xid = win.getNativeWindowHandle().readUInt32LE(0);
      execFile(
        "hyprctl",
        ["ghostnotes:geometry", String(xid)],
        { encoding: "utf8", timeout: 1000 },
        (error, result) => {
          if (win.isDestroyed() || sharingUpdates.get(win) !== update) return;
          if (!error && result.trim().startsWith("{")) win.setTitle(title);
          else if (remaining > 0) {
            update.timer = setTimeout(() => attempt(remaining - 1), 100);
            update.timer.unref?.();
          }
        },
      );
    } catch {
      /* Leave the note private if the capture integration is unavailable. */
    }
  };
  attempt(20);
}

function compositorPointer(env = process.env, command = "j/cursorpos") {
  return new Promise((resolve) => {
    if (!env.HYPRLAND_INSTANCE_SIGNATURE || !env.XDG_RUNTIME_DIR)
      return resolve(null);
    const socket = net.createConnection(
      path.join(
        env.XDG_RUNTIME_DIR,
        "hypr",
        env.HYPRLAND_INSTANCE_SIGNATURE,
        ".socket.sock",
      ),
    );
    let response = "";
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(250, () => finish(null));
    socket.on("error", () => finish(null));
    socket.on("connect", () => socket.write(command));
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.length > 4096) return finish(null);
      try {
        const point = JSON.parse(response);
        finish(
          Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null,
        );
      } catch {
        /* Wait for the rest of the JSON response. */
      }
    });
    socket.on("end", () => finish(null));
  });
}

async function dragPointer(win, fallback, scale = null) {
  if (
    !isLinux ||
    linuxBackend === "wayland" ||
    !process.env.HYPRLAND_INSTANCE_SIGNATURE ||
    !win.getNativeWindowHandle
  )
    return { ...fallback, scale: null };
  const xid = win.getNativeWindowHandle().readUInt32LE(0);
  const [cursor, geometry] = await Promise.all([
    compositorPointer(),
    scale
      ? null
      : compositorPointer(process.env, "j/ghostnotes:geometry " + xid),
  ]);
  if (!scale && geometry?.width > 0 && geometry?.height > 0) {
    const bounds = win.getBounds();
    scale = {
      x: bounds.width / geometry.width,
      y: bounds.height / geometry.height,
    };
  }
  if (cursor && scale)
    return { x: cursor.x * scale.x, y: cursor.y * scale.y, scale };
  return scale ? null : { ...fallback, scale: null };
}

function syncCompositorInput(win, ignore, enabled) {
  if (
    !isLinux ||
    linuxBackend === "wayland" ||
    !process.env.HYPRLAND_INSTANCE_SIGNATURE ||
    !win.getNativeWindowHandle
  )
    return;
  let update = inputUpdates.get(win);
  if (update) {
    update.ignore = ignore;
    update.enabled = enabled;
    return;
  }
  update = { ignore, enabled };
  inputUpdates.set(win, update);
  const send = async (remaining = 20) => {
    if (win.isDestroyed()) {
      inputUpdates.delete(win);
      return;
    }
    const requested = update.ignore;
    const requestedEnabled = update.enabled;
    const xid = win.getNativeWindowHandle().readUInt32LE(0);
    const reply = await compositorPointer(
      process.env,
      "j/ghostnotes:input " +
        xid +
        " " +
        (requested ? "1" : "0") +
        " " +
        (requestedEnabled ? "1" : "0"),
    );
    if (requested !== update.ignore || requestedEnabled !== update.enabled)
      return send();
    if (reply?.blocked !== requested && remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, 16));
      return send(remaining - 1);
    }
    inputUpdates.delete(win);
  };
  send().catch(() => inputUpdates.delete(win));
}

function setIgnoreMouseEvents(win, ignore, screen, recover = ignore) {
  const native =
    isLinux &&
    compositorOmit &&
    linuxBackend !== "wayland" &&
    process.env.HYPRLAND_INSTANCE_SIGNATURE &&
    win.getNativeWindowHandle;
  if (native && recover) {
    clearInterval(pointerRecovery.get(win));
    pointerRecovery.delete(win);
    if (!nativeInputOwners.has(win)) {
      // The companion owns both the toolbar hit region and body click-through.
      // Electron must not overwrite its input shape on every hover transition.
      win.setIgnoreMouseEvents(false, { forward: true });
      nativeInputOwners.add(win);
      syncCompositorInput(win, false, true);
    }
    return;
  }
  nativeInputOwners.delete(win);
  syncCompositorInput(win, ignore, recover);
  win.setIgnoreMouseEvents(ignore, { forward: true });
  if (!isLinux) return;
  clearInterval(pointerRecovery.get(win));
  pointerRecovery.delete(win);
  if (!recover) return;
  // Electron only forwards ignored mouse moves on Windows/macOS. Poll the
  // desktop pointer so Linux users can still reach the ghost-mode toolbar.
  let pending = false;
  const timer = setInterval(async () => {
    if (win.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    if (!win.isVisible() || pending) return;
    pending = true;
    const xid = compositorOmit && win.getNativeWindowHandle?.().readUInt32LE(0);
    const [compositorPoint, geometry] = await Promise.all([
      compositorPointer(),
      xid
        ? compositorPointer(process.env, "j/ghostnotes:geometry " + xid)
        : null,
    ]);
    const point = compositorPoint || screen.getCursorScreenPoint();
    pending = false;
    if (win.isDestroyed() || pointerRecovery.get(win) !== timer) return;
    const bounds = win.getBounds();
    win.webContents.send("note:pointerPosition", {
      x:
        geometry?.width > 0
          ? ((point.x - geometry.x) * bounds.width) / geometry.width
          : point.x - bounds.x,
      y:
        geometry?.height > 0
          ? ((point.y - geometry.y) * bounds.height) / geometry.height
          : point.y - bounds.y,
    });
  }, 80);
  timer.unref?.();
  pointerRecovery.set(win, timer);
}

function configureApp(app, env = process.env) {
  if (env.GHOST_NOTES_DATA_DIR) {
    fs.mkdirSync(env.GHOST_NOTES_DATA_DIR, { recursive: true, mode: 0o700 });
    app.setPath("userData", path.resolve(env.GHOST_NOTES_DATA_DIR));
  }
  if (!isLinux) return;
  if (!app.commandLine.hasSwitch("class"))
    app.commandLine.appendSwitch("class", "com.invisiblenotes.app");
  app.setDesktopName(DESKTOP_ID);
  if (typeof app.getAppPath === "function") {
    const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
    const executable = [
      process.execPath,
      ...(app.isPackaged ? [] : [app.getAppPath()]),
      "--ozone-platform=x11",
      "--class=com.invisiblenotes.app",
    ];
    desktopCommand = executable.map(quote).join(" ");
    if (env.GHOST_NOTES_DATA_DIR)
      desktopCommand =
        "env GHOST_NOTES_DATA_DIR=" +
        quote(env.GHOST_NOTES_DATA_DIR) +
        " " +
        desktopCommand;
    shortcutOwner = createHash("sha256")
      .update(desktopCommand)
      .digest("hex")
      .slice(0, 12);
  }
  // Native Wayland forbids the positioning and sizing bubble mode needs.
  const explicitBackend = process.argv
    ? process.argv.some(
        (arg) =>
          arg === "--ozone-platform" || arg.startsWith("--ozone-platform="),
      )
    : app.commandLine.hasSwitch("ozone-platform");
  if (
    !explicitBackend &&
    env.DISPLAY &&
    app.commandLine.getSwitchValue("ozone-platform") === "wayland" &&
    typeof app.relaunch === "function"
  ) {
    // Chromium may initialize Ozone before main.js. Changing that backend in
    // place can crash the GPU process; restart before opening any note store.
    app.relaunch({ args: launchArguments(process.argv.slice(1), env) });
    app.exit(0);
    return;
  }
  if (!explicitBackend && env.DISPLAY) {
    app.commandLine.appendSwitch("ozone-platform", "x11");
  }
  linuxBackend =
    app.commandLine.getSwitchValue("ozone-platform") ||
    (env.WAYLAND_DISPLAY ? "wayland" : "x11");
  if (
    !app.commandLine.hasSwitch("password-store") &&
    !/kde/i.test(env.XDG_CURRENT_DESKTOP || "")
  ) {
    app.commandLine.appendSwitch("password-store", "gnome-libsecret");
  }
  const features = app.commandLine
    .getSwitchValue("enable-features")
    .split(",")
    .filter(Boolean);
  for (const feature of [
    "GlobalShortcutsPortal",
    "GlobalShortcutsPortalPreferredTrigger",
  ]) {
    if (!features.includes(feature)) features.push(feature);
  }
  app.commandLine.appendSwitch("enable-features", features.join(","));
}

function launchArguments(args, env = process.env) {
  if (!isLinux) return args;
  const result = [...args];
  if (
    !result.some(
      (arg) =>
        arg === "--ozone-platform" || arg.startsWith("--ozone-platform="),
    ) &&
    env.DISPLAY
  ) {
    result.push("--ozone-platform=x11");
  }
  if (!result.some((arg) => arg === "--class" || arg.startsWith("--class="))) {
    result.push("--class=com.invisiblenotes.app");
  }
  return result;
}

function noteWindowOptions() {
  return isLinux ? { title: NOTE_TITLE, type: "utility" } : {};
}

function installDesktopIntegration() {
  if (!isLinux || !process.env.HYPRLAND_INSTANCE_SIGNATURE) return false;
  try {
    const code = fs.readFileSync(
      path.join(__dirname, "integrations", "hyprland.lua"),
      "utf8",
    );
    const result = execFileSync("hyprctl", ["eval", "do\n" + code + "\nend"], {
      encoding: "utf8",
      timeout: 2500,
      stdio: ["ignore", "pipe", "pipe"],
    });
    compositorMask = !/error:/i.test(result);
  } catch (error) {
    compositorMask = false;
    console.warn("Hyprland integration unavailable:", error.message);
  }
  refreshCaptureStatus();
  return compositorMask;
}

function watchDesktopChanges(onReload, env = process.env) {
  if (!isLinux || !env.HYPRLAND_INSTANCE_SIGNATURE || !env.XDG_RUNTIME_DIR)
    return () => {};
  const socketPath = path.join(
    env.XDG_RUNTIME_DIR,
    "hypr",
    env.HYPRLAND_INSTANCE_SIGNATURE,
    ".socket2.sock",
  );
  let socket;
  let reconnect;
  let refresh;
  let stopped = false;
  let connectedOnce = false;
  function scheduleRefresh() {
    clearTimeout(refresh);
    refresh = setTimeout(() => {
      if (stopped) return;
      try {
        onReload();
      } catch (error) {
        console.warn("Desktop integration refresh failed:", error.message);
      }
    }, 200);
    refresh.unref?.();
  }
  function connect() {
    if (stopped) return;
    let pending = "";
    socket = net.createConnection(socketPath);
    socket.unref?.();
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      if (connectedOnce) scheduleRefresh();
      connectedOnce = true;
    });
    socket.on("data", (chunk) => {
      if (stopped) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop().slice(-8192);
      if (lines.some((line) => line.startsWith("configreloaded>>")))
        scheduleRefresh();
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (stopped) return;
      reconnect = setTimeout(connect, 1000);
      reconnect.unref?.();
    });
  }
  connect();
  return () => {
    stopped = true;
    clearTimeout(reconnect);
    clearTimeout(refresh);
    socket?.destroy();
  };
}

function createStorageCodec(safeStorage) {
  const backend =
    isLinux && safeStorage?.getSelectedStorageBackend
      ? safeStorage.getSelectedStorageBackend()
      : "os-keychain";
  const available =
    !!safeStorage?.isEncryptionAvailable?.() && backend !== "basic_text";
  storageStatus = {
    encrypted: available,
    backend: available ? backend : "unavailable",
  };
  return available
    ? {
        encrypt: (plain) => safeStorage.encryptString(plain),
        decrypt: (cipher) => safeStorage.decryptString(cipher),
      }
    : null;
}

function registerCompositorShortcut(accelerator, action = "newNote") {
  shortcutConflict = false;
  const flags = {
    newNote: "--new-note",
    openManager: "--manager",
    toggleHideAll: "--toggle-notes",
    toggleGhostAll: "--toggle-ghost",
  };
  if (!Object.hasOwn(flags, action)) return false;
  const owner = shortcutOwner + (action === "newNote" ? "" : ":" + action);
  const command = desktopCommand + " " + flags[action];
  if (!isLinux || !process.env.HYPRLAND_INSTANCE_SIGNATURE || !desktopCommand)
    return false;
  const parsed = shortcutKeys.parse(accelerator, isMac);
  if (!parsed || parsed.altgr) return false;
  const key = shortcutKeys.hyprKey(parsed.key);
  const mask =
    (parsed.ctrl ? 4 : 0) |
    (parsed.alt ? 8 : 0) |
    (parsed.shift ? 1 : 0) |
    (parsed.meta ? 64 : 0);
  const description =
    "Ghost Notes global " +
    (action === "newNote" ? "new note" : action) +
    " " +
    shortcutOwner;
  try {
    const binds = JSON.parse(
      execFileSync("hyprctl", ["binds", "-j"], {
        encoding: "utf8",
        timeout: 2500,
      }),
    );
    const matches = binds.filter(
      (b) =>
        b.modmask === mask && String(b.key).toUpperCase() === key.toUpperCase(),
    );
    if (matches.some((b) => b.description !== description)) {
      shortcutConflict = true;
      return false;
    }
    if (matches.some((b) => b.description === description)) {
      compositorBindings.set(action, owner);
      return true;
    }
    const mods = [
      [4, "CTRL"],
      [8, "ALT"],
      [1, "SHIFT"],
      [64, "SUPER"],
    ]
      .filter(([m]) => mask & m)
      .map(([, n]) => n);
    const keys = [...mods, key].join(" + ");
    const lua = `ghost_notes_shortcuts = ghost_notes_shortcuts or {}; local owner = ${JSON.stringify(owner)}; if ghost_notes_shortcuts[owner] then ghost_notes_shortcuts[owner]:unbind() end; ghost_notes_shortcuts[owner] = hl.bind(${JSON.stringify(keys)}, hl.dsp.exec_cmd(${JSON.stringify(command)}), { description = ${JSON.stringify(description)} })`;
    const result = execFileSync("hyprctl", ["eval", lua], {
      encoding: "utf8",
      timeout: 2500,
    });
    if (/error:/i.test(result)) return false;
    compositorBindings.set(action, owner);
    return true;
  } catch {
    return false;
  }
}

function unregisterCompositorShortcut(action = "newNote") {
  const owner = compositorBindings.get(action);
  if (!owner) return;
  try {
    execFileSync(
      "hyprctl",
      [
        "eval",
        `local owner = ${JSON.stringify(owner)}; if ghost_notes_shortcuts and ghost_notes_shortcuts[owner] then ghost_notes_shortcuts[owner]:unbind(); ghost_notes_shortcuts[owner] = nil end`,
      ],
      { timeout: 2500, stdio: "ignore" },
    );
  } catch {
    /* The compositor may already have shut down. */
  }
  compositorBindings.delete(action);
}

function setShortcutStatus(value) {
  shortcutStatus = value;
}

function runtimeStatus() {
  const captureMessage = captureExclusionCaveat();
  return {
    platform: isLinux ? "linux" : isMac ? "macos" : "windows",
    backend: isLinux ? linuxBackend : null,
    capture: {
      mode: isLinux
        ? compositorOmit
          ? "compositor-omit"
          : compositorMask
            ? "compositor-mask"
            : "unsupported"
        : "os-content-protection",
      message: captureMessage,
    },
    storage: { ...storageStatus },
    globalShortcut: shortcutStatus,
  };
}

function installLinuxDesktop({
  home,
  electronPath,
  hyprland = false,
  capturePlugin = false,
}) {
  if (!isLinux) throw new Error("This setup command is for Linux only.");
  const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  const data = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const hyprConfig = path.join(config, "hypr", "hyprland.lua");
  const pluginPath = path.join(
    __dirname,
    "dist",
    "hyprland",
    "ghost-notes-capture.so",
  );
  if (capturePlugin && (!hyprland || !fs.existsSync(pluginPath))) {
    throw new Error(
      "Capture exclusion needs --hyprland and npm run build:capture-plugin first.",
    );
  }
  if (hyprland && !fs.existsSync(hyprConfig)) {
    throw new Error(
      "Hyprland Lua configuration was not found. See LINUX.md for other desktops and older Hyprland versions.",
    );
  }
  const bin = path.join(home, ".local", "bin");
  const applications = path.join(data, "applications");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(applications, { recursive: true });
  const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
  const launcher = path.join(bin, "ghost-notes");
  fs.writeFileSync(
    launcher,
    `#!/bin/sh\nexec ${quote(electronPath)} ${quote(__dirname)} --ozone-platform=x11 --class=com.invisiblenotes.app "$@"\n`,
    { mode: 0o755 },
  );
  fs.chmodSync(launcher, 0o755);
  // Desktop Exec is not a shell command; quote its path separately.
  const exec =
    '"' +
    launcher.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%") +
    '"';
  const desktop = path.join(applications, DESKTOP_ID);
  fs.writeFileSync(
    desktop,
    `[Desktop Entry]\nType=Application\nName=Ghost Notes (Linux)\nComment=Local notes with desktop-dependent capture protection\nExec=${exec}\nIcon=${path.join(__dirname, "build", "icon.png")}\nTerminal=false\nCategories=Office;Utility;\nStartupWMClass=com.invisiblenotes.app\nActions=NewNote;\n\n[Desktop Action NewNote]\nName=New Note\nExec=${exec} --new-note\n`,
  );
  if (hyprland) {
    const rules = path.join(config, "hypr", "ghost-notes.lua");
    let source = fs.readFileSync(
      path.join(__dirname, "integrations", "hyprland.lua"),
    );
    if (capturePlugin) {
      source = Buffer.from(
        source.toString() +
          "\nhl.plugin.load(" +
          JSON.stringify(pluginPath) +
          ")\n",
      );
    }
    if (fs.existsSync(rules) && !fs.readFileSync(rules).equals(source)) {
      fs.copyFileSync(rules, rules + `.backup-${Date.now()}`);
    }
    fs.writeFileSync(rules, source);
    const original = fs.readFileSync(hyprConfig, "utf8");
    const line =
      'dofile((os.getenv("XDG_CONFIG_HOME") or (os.getenv("HOME") .. "/.config")) .. "/hypr/ghost-notes.lua")';
    if (!original.includes(line)) {
      fs.copyFileSync(hyprConfig, hyprConfig + `.backup-${Date.now()}`);
      fs.appendFileSync(
        hyprConfig,
        "\n-- Ghost Notes desktop integration\n" + line + "\n",
      );
    }
  }
  return { launcher, desktop, hyprland };
}

function hideDockIconIfMac(app) {
  if (isMac && app.dock) app.dock.hide();
}

function isCommandOrControlPressed(input) {
  return isMac
    ? !!input.meta && !input.control
    : !!input.control && !input.meta;
}

const MAC_SYMBOLS = {
  Super: "⌘",
  Meta: "⌘",
  CommandOrControl: "⌘",
  CmdOrCtrl: "⌘",
  Command: "⌘",
  Cmd: "⌘",
  Control: "⌃",
  Ctrl: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
};
const MAC_MODIFIER_ORDER = ["⌃", "⌥", "⇧", "⌘"];
const WINDOWS_NAMES = {
  Super: isWindows ? "Win" : "Super",
  Meta: isWindows ? "Win" : "Super",
  CommandOrControl: "Ctrl",
  CmdOrCtrl: "Ctrl",
  Command: "Ctrl",
  Cmd: "Ctrl",
  Control: "Ctrl",
  Ctrl: "Ctrl",
  Alt: "Alt",
  Option: "Alt",
  Shift: "Shift",
};

function displayKey(part) {
  return part.length === 1 ? part.toUpperCase() : part;
}

function formatAccelerator(accelerator) {
  const parts = String(accelerator || "")
    .split("+")
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (isMac) {
    const symbols = parts.map((part) => MAC_SYMBOLS[part] || displayKey(part));
    const modifiers = symbols
      .filter((symbol) => MAC_MODIFIER_ORDER.includes(symbol))
      .sort(
        (a, b) => MAC_MODIFIER_ORDER.indexOf(a) - MAC_MODIFIER_ORDER.indexOf(b),
      );
    const keys = symbols.filter(
      (symbol) => !MAC_MODIFIER_ORDER.includes(symbol),
    );
    return modifiers.join("") + keys.join("");
  }
  return parts.map((part) => WINDOWS_NAMES[part] || displayKey(part)).join("+");
}

function setPinned(win, pinned) {
  syncCompositorPin(win, pinned);
  if (pinned) {
    win.setAlwaysOnTop(true, "screen-saver");
    if (isMac)
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreenSpaces: true });
  } else {
    win.setAlwaysOnTop(false);
    if (isMac) win.setVisibleOnAllWorkspaces(false);
  }
}

function refreshCaptureStatus() {
  captureStatusChecked = true;
  compositorOmit = false;
  if (!isLinux || !process.env.HYPRLAND_INSTANCE_SIGNATURE) return;
  try {
    const status = JSON.parse(
      execFileSync("hyprctl", ["ghostnotes:status", "-j"], {
        encoding: "utf8",
        timeout: 1500,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    compositorOmit = status.mode === "compositor-omit";
  } catch {
    /* Recheck at desktop initialization/reload, never during pointer handling. */
  }
}

function captureExclusionCaveat() {
  if (isLinux) {
    if (!captureStatusChecked) refreshCaptureStatus();
    if (compositorOmit)
      return "Protected notes are omitted from compositor-managed screen captures by the Ghost Notes Hyprland plugin. Direct GPU/KMS and X11 capture bypass this protection. Other desktops require their own integration.";
    return compositorMask
      ? "Hyprland capture masking is requested. Supported compositor capture paths may show a black rectangle. GPU/KMS recorders can still capture notes. Verify your sharing application before use."
      : "Screen-capture exclusion is unavailable on this Linux desktop. Notes may appear in recordings and screen shares.";
  }
  if (isWindows) {
    return "Screen-capture exclusion requires Windows 10 (build 19041) or later. On older Windows versions, notes may be visible to screen recordings.";
  }
  return null;
}

module.exports = {
  isMac,
  isWindows,
  isLinux,
  configureApp,
  launchArguments,
  installLinuxDesktop,
  noteWindowOptions,
  setSharingVisibility,
  installDesktopIntegration,
  watchDesktopChanges,
  createStorageCodec,
  runtimeStatus,
  setShortcutStatus,
  registerCompositorShortcut,
  unregisterCompositorShortcut,
  hasShortcutConflict: () => shortcutConflict,
  hideDockIconIfMac,
  isCommandOrControlPressed,
  formatAccelerator,
  setPinned,
  captureExclusionCaveat,
  setIgnoreMouseEvents,
  compositorPointer,
  dragPointer,
};
