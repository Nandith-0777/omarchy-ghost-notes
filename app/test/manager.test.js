const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { NoteStore } = require("../store");

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghost-manager-test-"));
  const store = new NoteStore(dir);
  t.after(() => {
    store.flush();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const listeners = new Map();
  const handlers = new Map();
  let window;
  let removed = [];
  class Window extends EventEmitter {
    constructor() {
      super();
      this.webContents = new EventEmitter();
      window = this;
    }
    isDestroyed() {
      return false;
    }
    setMenuBarVisibility() {}
    loadFile() {}
    show() {}
    focus() {}
  }
  const context = {
    module: { exports: {} },
    __dirname: path.resolve(__dirname, "../manager"),
    require(name) {
      if (name === "electron")
        return {
          app: {},
          BrowserWindow: Window,
          ipcMain: {
            on: (k, v) => listeners.set(k, v),
            handle: (k, v) => handlers.set(k, v),
          },
        };
      if (name === "./shortcuts") return require("../manager/shortcuts");
      if (name === "../platform") return {};
      return require(name === "../store" ? "../store" : name);
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../manager/manager.js"), "utf8"),
    context,
  );
  const manager = context.module.exports.createManagerModule({
    store,
    actions: {
      removeWorkspace: (id) => {
        removed.push(id);
        store.removeWorkspace(id);
      },
    },
  });
  manager.openManagerWindow();
  return {
    store,
    event: { sender: window.webContents },
    preview: handlers.get("manager:workspaceDeletion"),
    remove: listeners.get("manager:deleteWorkspace"),
    removed,
    setShortcut: handlers.get("manager:setShortcut"),
    recordShortcut: handlers.get("manager:recordShortcut"),
  };
}

test("workspace confirmation previews the actual destination and note count", (t) => {
  const h = setup(t);
  const home = h.store.activeWorkspaceId();
  const workspace = h.store.createWorkspace("Work");
  h.store.create({ workspaceId: workspace.id, text: "Keep this note" });
  const preview = h.preview(h.event, workspace.id);
  assert.equal(preview.name, "Work");
  assert.equal(preview.noteCount, 1);
  assert.equal(preview.destination, h.store.getWorkspace(home).name);
  assert.equal(h.preview({ sender: {} }, workspace.id), null);
  assert.equal(h.preview(h.event, "missing"), null);
});

test("workspace deletion requires a confirmed request from the manager and keeps notes", (t) => {
  const h = setup(t);
  const home = h.store.activeWorkspaceId();
  const workspace = h.store.createWorkspace("Work");
  const note = h.store.create({
    workspaceId: workspace.id,
    text: "Keep this note",
  });
  for (const payload of [
    workspace.id,
    null,
    {},
    { id: workspace.id },
    { id: workspace.id, confirmed: false },
  ])
    h.remove(h.event, payload);
  h.remove({ sender: {} }, { id: workspace.id, confirmed: true });
  assert.equal(h.removed.length, 0);
  h.remove(h.event, { id: workspace.id, confirmed: true });
  assert.deepEqual(h.removed, [workspace.id]);
  assert.equal(h.store.get(note.id).workspaceId, home);
  assert.equal(h.store.get(note.id).text, "Keep this note");
  assert.equal(h.preview(h.event, home), null);
  h.remove(h.event, { id: home, confirmed: true });
  assert.equal(h.store.workspaces().length, 1);
});

test("shortcut IPC validates combinations and rejects duplicates without changing preferences", (t) => {
  const h = setup(t);
  const result = h.setShortcut(h.event, {
    id: "newNote",
    accelerator: "Alt+F8",
  });
  assert.equal(Array.isArray(result), true);
  assert.equal(h.store.getShortcutOverrides().newNote, "Alt+F8");
  assert.ok(
    h.setShortcut(h.event, {
      id: "newNote",
      accelerator: "CommandOrControl+Shift+M",
    }).error,
  );
  assert.equal(h.store.getShortcutOverrides().newNote, "Alt+F8");
  assert.ok(
    h.setShortcut({ sender: {} }, { id: "newNote", accelerator: "Ctrl+K" })
      .error,
  );
  assert.ok(
    h.setShortcut(h.event, { id: "newNote", accelerator: "Ctrl+Shift" }).error,
  );
  assert.equal(h.recordShortcut({ sender: {} }, true), false);
  assert.equal(h.recordShortcut(h.event, true), true);
  assert.equal(h.recordShortcut(h.event, false), true);
});
