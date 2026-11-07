const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { NoteStore } = require("../store");

function platformFor(platform, overrides = {}, env = {}) {
  const context = {
    module: { exports: {} },
    require: (name) =>
      overrides[name] ||
      (name === "./manager/key-combo"
        ? require("../manager/key-combo")
        : require(name)),
    process: {
      platform,
      env,
      execPath: "/test/electron",
      argv: overrides.argv,
    },
    __dirname: path.resolve(__dirname, ".."),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console: { warn() {} },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../platform.js"), "utf8"),
    context,
  );
  return context.module.exports;
}

function fakeApp(initial = {}) {
  const switches = new Map(Object.entries(initial));
  return {
    switches,
    setDesktopName(value) {
      this.desktopName = value;
    },
    commandLine: {
      hasSwitch: (key) => switches.has(key),
      getSwitchValue: (key) => switches.get(key) || "",
      appendSwitch: (key, value) => switches.set(key, value),
    },
  };
}

test("Linux defaults to XWayland for positioning and enables portal support", () => {
  const platform = platformFor("linux");
  const app = fakeApp({ "enable-features": "ExistingFeature" });
  platform.configureApp(app, { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-1" });
  assert.equal(app.desktopName, "com.invisiblenotes.app.desktop");
  assert.equal(app.switches.get("ozone-platform"), "x11");
  assert.equal(app.switches.get("password-store"), "gnome-libsecret");
  assert.ok(app.switches.get("enable-features").includes("ExistingFeature"));
  assert.ok(
    app.switches.get("enable-features").includes("GlobalShortcutsPortal"),
  );
});

test("capture status distinguishes the companion plugin from black masking", () => {
  for (const loaded of [true, false]) {
    const p = platformFor(
      "linux",
      {
        "node:child_process": {
          execFileSync(_command, args) {
            if (args[0] === "ghostnotes:status") {
              if (!loaded) throw new Error("plugin is absent");
              return JSON.stringify({ mode: "compositor-omit", frames: 5 });
            }
            return "ok";
          },
        },
      },
      { HYPRLAND_INSTANCE_SIGNATURE: "test" },
    );
    assert.equal(p.installDesktopIntegration(), true);
    assert.equal(
      p.runtimeStatus().capture.mode,
      loaded ? "compositor-omit" : "compositor-mask",
    );
  }
});

test("note status reads do not synchronously query the compositor repeatedly", () => {
  let queries = 0;
  const p = platformFor(
    "linux",
    {
      "node:child_process": {
        execFileSync(_command, args) {
          if (args[0] === "ghostnotes:status") {
            queries++;
            return JSON.stringify({ mode: "compositor-omit" });
          }
          return "ok";
        },
      },
    },
    { HYPRLAND_INSTANCE_SIGNATURE: "test" },
  );
  p.installDesktopIntegration();
  for (let i = 0; i < 30; i++) {
    assert.equal(p.runtimeStatus().capture.mode, "compositor-omit");
    p.captureExclusionCaveat();
  }
  assert.equal(queries, 1);
  p.installDesktopIntegration();
  assert.equal(queries, 2, "Desktop reload must recheck the companion");
});

test("compositor pointer reader handles split replies and malformed coordinates", async () => {
  const { EventEmitter } = require("node:events");
  for (const reply of ['{"x":120,"y":45}', '{"x":"bad","y":45}']) {
    let request;
    let destroyed = false;
    const p = platformFor("linux", {
      "node:net": {
        createConnection() {
          const socket = new EventEmitter();
          socket.setTimeout = () => {};
          socket.destroy = () => {
            destroyed = true;
          };
          socket.write = (command) => {
            request = command;
            socket.emit("data", reply.slice(0, 6));
            socket.emit("data", reply.slice(6));
          };
          setImmediate(() => socket.emit("connect"));
          return socket;
        },
      },
    });
    const point = await p.compositorPointer({
      XDG_RUNTIME_DIR: "/tmp",
      HYPRLAND_INSTANCE_SIGNATURE: "test",
    });
    assert.equal(request, "j/cursorpos");
    assert.equal(destroyed, true);
    assert.equal(point?.x ?? null, reply.includes("bad") ? null : 120);
  }
});

test("Linux ignored-input recovery stops when input is restored", async () => {
  const p = platformFor("linux");
  const positions = [];
  const win = {
    isDestroyed: () => false,
    isVisible: () => true,
    getBounds: () => ({ x: 100, y: 200 }),
    setIgnoreMouseEvents() {},
    webContents: { send: (_channel, point) => positions.push(point) },
  };
  p.setIgnoreMouseEvents(win, true, {
    getCursorScreenPoint: () => ({ x: 110, y: 215 }),
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  p.setIgnoreMouseEvents(win, false);
  assert.ok(positions.length > 0);
  assert.equal(positions[0].x, 10);
  assert.equal(positions[0].y, 15);
  const count = positions.length;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(positions.length, count);
});

test("explicit backend, keychain and feature choices are preserved", () => {
  const platform = platformFor("linux");
  const app = fakeApp({
    "ozone-platform": "wayland",
    "password-store": "kwallet6",
  });
  platform.configureApp(app, { DISPLAY: ":0" });
  assert.equal(platform.runtimeStatus().backend, "wayland");
  assert.equal(app.switches.get("password-store"), "kwallet6");
});

test("packaged launches override inherited Wayland defaults but preserve explicit CLI overrides", () => {
  for (const explicit of [false, true]) {
    const p = platformFor("linux", {
      argv: explicit ? ["electron", "--ozone-platform=wayland"] : ["electron"],
    });
    const app = fakeApp({ "ozone-platform": "wayland" });
    p.configureApp(app, { DISPLAY: ":1", OZONE_PLATFORM: "wayland" });
    assert.equal(p.runtimeStatus().backend, explicit ? "wayland" : "x11");
  }
});

test("an already initialized inherited Wayland backend relaunches with early X11 flags", () => {
  const p = platformFor("linux", { argv: ["ghost-notes", "--new-note"] });
  const app = fakeApp({ "ozone-platform": "wayland" });
  let args, exitCode;
  app.relaunch = (value) => {
    args = value.args;
  };
  app.exit = (value) => {
    exitCode = value;
  };
  p.configureApp(app, { DISPLAY: ":1" });
  assert.ok(args.includes("--new-note"));
  assert.ok(args.includes("--ozone-platform=x11"));
  assert.equal(exitCode, 0);
  assert.equal(app.switches.get("ozone-platform"), "wayland");
});

test("non-Linux initialization does not change desktop switches", () => {
  for (const os of ["darwin", "win32"]) {
    const p = platformFor(os);
    const app = fakeApp();
    p.configureApp(app, {});
    assert.equal(app.switches.size, 0);
    assert.deepEqual(Object.keys(p.noteWindowOptions()), []);
  }
});

test("KDE keeps automatic KWallet selection", () => {
  const app = fakeApp();
  platformFor("linux").configureApp(app, {
    XDG_CURRENT_DESKTOP: "KDE",
    DISPLAY: ":0",
  });
  assert.equal(app.switches.has("password-store"), false);
});

test("basic_text is never presented as OS-backed encryption", () => {
  const p = platformFor("linux");
  const codec = p.createStorageCodec({
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "basic_text",
  });
  assert.equal(codec, null);
  assert.equal(p.runtimeStatus().storage.encrypted, false);
});

test("Linux keychain codec encrypts and decrypts through safeStorage", () => {
  const p = platformFor("linux");
  const codec = p.createStorageCodec({
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (value) => Buffer.from("encrypted:" + value),
    decryptString: (value) => value.toString().slice(10),
  });
  assert.equal(codec.decrypt(codec.encrypt("private")), "private");
  assert.equal(p.runtimeStatus().storage.backend, "gnome_libsecret");
});

test("unsupported Linux capture paths are reported honestly", () => {
  const p = platformFor("linux");
  assert.equal(p.runtimeStatus().capture.mode, "unsupported");
  assert.match(p.captureExclusionCaveat(), /may appear/);
});

test("Linux note identity is stable and uses utility window semantics", () => {
  const p = platformFor("linux");
  assert.equal(p.noteWindowOptions().title, "Ghost Notes Note");
  assert.equal(p.noteWindowOptions().type, "utility");
  const lua = fs.readFileSync(
    path.join(__dirname, "../integrations/hyprland.lua"),
    "utf8",
  );
  assert.match(lua, /initial_title = "\^Ghost Notes Note\$"/);
});

test("encrypted notes are preserved if the keychain is unavailable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghost-locked-"));
  try {
    const file = path.join(dir, "notes.json");
    const raw = Buffer.from("v10encrypted-note-content");
    fs.writeFileSync(file, raw);
    assert.throws(() => new NoteStore(dir), /Unlock the desktop keychain/);
    assert.deepEqual(fs.readFileSync(file), raw);
    assert.equal(fs.existsSync(file + ".corrupt"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("failed decryption does not silently reset an encrypted store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghost-decrypt-"));
  try {
    const file = path.join(dir, "notes.json");
    fs.writeFileSync(file, Buffer.from([0, 1, 2, 3]));
    assert.throws(
      () =>
        new NoteStore(dir, {
          codec: {
            decrypt() {
              throw new Error("keychain locked");
            },
            encrypt() {},
          },
        }),
      /could not be decrypted/,
    );
    assert.deepEqual(fs.readFileSync(file), Buffer.from([0, 1, 2, 3]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("encryption failure is reported through onWriteError instead of crashing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghost-encrypt-"));
  let failed = false;
  const store = new NoteStore(dir, {
    codec: {
      encrypt() {
        throw new Error("keychain unavailable");
      },
      decrypt() {},
    },
    onWriteError: () => {
      failed = true;
    },
  });
  try {
    store.create({ text: "retain in memory" });
    assert.doesNotThrow(() => store.flush());
    assert.equal(failed, true);
    assert.equal(store.all()[0].text, "retain in memory");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("launch arguments choose X11 before Electron starts", () => {
  const p = platformFor("linux");
  const args = p.launchArguments(["--new-note"], { DISPLAY: ":0" });
  assert.ok(args.includes("--ozone-platform=x11"));
  assert.ok(args.includes("--new-note"));
  const explicit = p.launchArguments(["--ozone-platform=wayland"], {
    DISPLAY: ":0",
  });
  assert.equal(
    explicit.filter((arg) => arg.startsWith("--ozone-platform=")).length,
    1,
  );
});

test("desktop setup is idempotent and keeps a backup of the Hyprland config", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ghost-install-"));
  const config = path.join(home, ".config");
  fs.mkdirSync(path.join(config, "hypr"), { recursive: true });
  const main = path.join(config, "hypr", "hyprland.lua");
  fs.writeFileSync(main, "-- existing user settings\n");
  const p = platformFor("linux");
  try {
    p.installLinuxDesktop({
      home,
      electronPath: "/opt/Some App/electron",
      hyprland: true,
    });
    p.installLinuxDesktop({
      home,
      electronPath: "/opt/Some App/electron",
      hyprland: true,
    });
    const text = fs.readFileSync(main, "utf8");
    assert.equal(text.split("dofile(").length - 1, 1);
    assert.ok(text.startsWith("-- existing user settings"));
    assert.ok(
      fs
        .readdirSync(path.dirname(main))
        .some((name) => name.includes(".backup-")),
    );
    assert.match(
      fs.readFileSync(path.join(home, ".local/bin/ghost-notes"), "utf8"),
      /'\/opt\/Some App\/electron'/,
    );
    assert.ok(
      fs.existsSync(
        path.join(
          home,
          ".local/share/applications/com.invisiblenotes.app.desktop",
        ),
      ),
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("compositor shortcut conflicts are reported without taking over bindings", () => {
  const calls = [];
  const p = platformFor(
    "linux",
    {
      "node:child_process": {
        execFileSync(command, args) {
          calls.push(args[0]);
          if (args[0] === "binds")
            return JSON.stringify([
              { modmask: 13, key: "N", description: "Existing user shortcut" },
            ]);
          throw new Error("must not change compositor bindings");
        },
      },
    },
    { HYPRLAND_INSTANCE_SIGNATURE: "test-session" },
  );
  const app = fakeApp();
  app.getAppPath = () => "/test/ghost-notes";
  app.isPackaged = false;
  p.configureApp(app, { DISPLAY: ":0" });
  assert.equal(p.registerCompositorShortcut("Ctrl+Alt+Shift+N"), false);
  assert.equal(p.hasShortcutConflict(), true);
  assert.deepEqual(calls, ["binds"]);
});

test("desktop watcher restores integration after fragmented reload events and stops cleanly", async () => {
  const { EventEmitter } = require("node:events");
  const socket = new EventEmitter();
  socket.setEncoding = () => {};
  socket.unref = () => {};
  socket.destroy = () => {
    socket.emit("close");
  };
  let requestedPath;
  const p = platformFor("linux", {
    "node:net": {
      createConnection(value) {
        requestedPath = value;
        return socket;
      },
    },
  });
  let calls = 0;
  const stop = p.watchDesktopChanges(
    () => {
      calls++;
    },
    {
      XDG_RUNTIME_DIR: "/run/user/1000",
      HYPRLAND_INSTANCE_SIGNATURE: "sample",
    },
  );
  assert.equal(
    requestedPath,
    path.join("/run/user/1000", "hypr", "sample", ".socket2.sock"),
  );
  socket.emit("connect");
  socket.emit("data", "activewindow>>other app\nconfigrelo");
  socket.emit("data", "aded>>\n");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(calls, 1);
  stop();
  socket.emit("data", "configreloaded>>\n");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(calls, 1);
});

test("desktop watcher does nothing outside a Hyprland Linux session", () => {
  const p = platformFor("darwin", {
    "node:net": {
      createConnection() {
        throw new Error("must not connect");
      },
    },
  });
  const stop = p.watchDesktopChanges(() => {}, {
    XDG_RUNTIME_DIR: "/run/user/1000",
    HYPRLAND_INSTANCE_SIGNATURE: "sample",
  });
  assert.doesNotThrow(stop);
});

test("native ghost routing does not fight Electron or poll the pointer", async () => {
  const { EventEmitter } = require("node:events");
  const commands = [],
    nativeCalls = [],
    positions = [];
  const p = platformFor(
    "linux",
    {
      "node:child_process": {
        execFileSync: () => JSON.stringify({ mode: "compositor-omit" }),
      },
      "node:net": {
        createConnection() {
          const socket = new EventEmitter();
          socket.setTimeout = () => {};
          socket.destroy = () => {};
          socket.write = (command) => {
            commands.push(command);
            socket.emit("data", JSON.stringify({ x: 0, y: 0, blocked: false }));
          };
          setImmediate(() => socket.emit("connect"));
          return socket;
        },
      },
    },
    { HYPRLAND_INSTANCE_SIGNATURE: "test", XDG_RUNTIME_DIR: "/tmp" },
  );
  p.runtimeStatus();
  const win = {
    isDestroyed: () => false,
    isVisible: () => true,
    getNativeWindowHandle: () => Buffer.from([42, 0, 0, 0]),
    setIgnoreMouseEvents: (ignore) => nativeCalls.push(ignore),
    webContents: { send: (...args) => positions.push(args) },
  };
  for (const ignore of [true, false, true, false, true])
    p.setIgnoreMouseEvents(win, ignore, {}, true);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(nativeCalls, [false]);
  assert.deepEqual(commands, ["j/ghostnotes:input 42 0 1"]);
  assert.equal(positions.length, 0);
  p.setIgnoreMouseEvents(win, false, {}, false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(commands.at(-1), "j/ghostnotes:input 42 0 0");
  assert.deepEqual(nativeCalls, [false, false]);
});

test("compositor pin updates never synchronously block mouse handling", async () => {
  const requests = [];
  const p = platformFor(
    "linux",
    {
      "node:child_process": {
        execFileSync() {
          throw new Error("Pin updates must be asynchronous");
        },
        execFile(command, args, options, callback) {
          requests.push({ args, callback });
        },
      },
    },
    { HYPRLAND_INSTANCE_SIGNATURE: "test" },
  );
  const win = {
    isDestroyed: () => false,
    getNativeWindowHandle: () => Buffer.from([42, 0, 0, 0]),
    setAlwaysOnTop() {},
  };
  p.setPinned(win, true);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual([...requests[0].args], ["ghostnotes:pin", "42", "1"]);
  p.setPinned(win, false);
  requests[0].callback(null, "not-mapped");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(
    requests.length,
    2,
    "A stale pin reply must not restart its retry loop",
  );
  assert.deepEqual([...requests[1].args], ["ghostnotes:pin", "42", "0"]);
  requests[1].callback(null, "ok");
});

test("ghost recovery keeps tracking after toolbar hover restores input", async (t) => {
  const p = platformFor("linux");
  const positions = [];
  let cursor = { x: 110, y: 215 };
  const win = {
    isDestroyed: () => false,
    isVisible: () => true,
    getBounds: () => ({ x: 100, y: 200 }),
    setIgnoreMouseEvents() {},
    webContents: { send: (_channel, point) => positions.push(point) },
  };
  const screen = { getCursorScreenPoint: () => cursor };
  t.after(() => p.setIgnoreMouseEvents(win, false));
  p.setIgnoreMouseEvents(win, false, screen, true);
  await new Promise((resolve) => setTimeout(resolve, 120));
  cursor = { x: 120, y: 300 };
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(
    positions.some((point) => point.y === 100),
    "Body movement must be detected without renderer mousemove events",
  );
  p.setIgnoreMouseEvents(win, false, screen, false);
  const count = positions.length;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(positions.length, count);
});

test("compositor input registration retries unmapped saved ghost notes and clears on exit", async () => {
  const { EventEmitter } = require("node:events");
  const commands = [];
  let attempts = 0;
  const p = platformFor(
    "linux",
    {
      "node:net": {
        createConnection() {
          const socket = new EventEmitter();
          socket.setTimeout = () => {};
          socket.destroy = () => {};
          socket.write = (command) => {
            commands.push(command);
            const blocked = command.split(" ")[2] === "1";
            socket.emit(
              "data",
              JSON.stringify(
                attempts++ === 0
                  ? { x: 0, y: 0, mapped: false }
                  : { x: 0, y: 0, blocked },
              ),
            );
          };
          setImmediate(() => socket.emit("connect"));
          return socket;
        },
      },
    },
    { HYPRLAND_INSTANCE_SIGNATURE: "test", XDG_RUNTIME_DIR: "/tmp" },
  );
  const native = Buffer.alloc(4);
  native.writeUInt32LE(42);
  const win = {
    isDestroyed: () => false,
    isVisible: () => false,
    getNativeWindowHandle: () => native,
    setIgnoreMouseEvents() {},
  };
  p.setIgnoreMouseEvents(win, true, {}, true);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(
    commands.length,
    2,
    "Retry after the note becomes mapped, without waiting for a runtime status request",
  );
  assert.equal(commands[1], "j/ghostnotes:input 42 1 1");
  p.setIgnoreMouseEvents(win, false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(commands.at(-1), "j/ghostnotes:input 42 0 0");
});

test("compositor actions have independent owners and command-line actions", () => {
  const lua = [];
  const p = platformFor(
    "linux",
    {
      "node:child_process": {
        execFileSync(command, args) {
          if (args[0] === "binds") return "[]";
          lua.push(args[1]);
          return "ok";
        },
      },
    },
    { HYPRLAND_INSTANCE_SIGNATURE: "test-session" },
  );
  const app = fakeApp();
  app.getAppPath = () => "/test/ghost-notes";
  app.isPackaged = false;
  p.configureApp(app, { DISPLAY: ":0" });
  assert.equal(
    p.registerCompositorShortcut("Ctrl+Alt+Shift+M", "openManager"),
    true,
  );
  assert.equal(
    p.registerCompositorShortcut("Ctrl+Alt+Shift+H", "toggleHideAll"),
    true,
  );
  assert.match(lua[0], /--manager/);
  assert.doesNotMatch(lua[0], /--new-note/);
  assert.match(lua[1], /--toggle-notes/);
  p.unregisterCompositorShortcut("openManager");
  assert.match(lua[2], /:openManager/);
  assert.doesNotMatch(lua[2], /:toggleHideAll/);
  p.unregisterCompositorShortcut("toggleHideAll");
  assert.match(lua[3], /:toggleHideAll/);
});
