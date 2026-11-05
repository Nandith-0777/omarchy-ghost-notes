const test = require("node:test");
const assert = require("node:assert/strict");

const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
const display = { id: 1, workArea };
const screen = {
  getAllDisplays: () => [display],
  getPrimaryDisplay: () => display,
  getDisplayNearestPoint: () => display,
  getDisplayMatching: () => display,
};
const electronId = require.resolve("electron");
const original = require.cache[electronId];
require.cache[electronId] = { exports: { screen } };
const { createNoteCollapseController } = require("../note/noteCollapse");
if (original) require.cache[electronId] = original;
else delete require.cache[electronId];

function setup(overrides = {}) {
  const record = {
    id: "note-a",
    x: 100,
    y: 100,
    width: 360,
    height: 220,
    collapsed: false,
    text: "Private content",
    ...overrides,
  };
  let bounds = {
    x: record.x,
    y: record.y,
    width: record.collapsed ? 48 : record.width,
    height: record.collapsed ? 48 : record.height,
  };
  let cursor = { x: 110, y: 110 };
  let changes = 0;
  const win = {
    webContents: {},
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => {
      assert.equal(controller.isChanging(win) || record.collapsed, true);
      bounds = next;
    },
    setSize: (width, height) => {
      assert.equal(controller.isChanging(win), true);
      bounds = { ...bounds, width, height };
    },
    setMinimumSize: (...size) => {
      win.minimum = size;
    },
    setResizable: (value) => {
      win.resizable = value;
    },
    setIgnoreMouseEvents: (value) => {
      win.ignoring = value;
    },
    setContentProtection: (value) => {
      win.protected = value;
    },
  };
  const controller = createNoteCollapseController({
    store: {
      get: (id) => (id === record.id ? record : null),
      update: (id, patch) => Object.assign(record, patch),
    },
    noteWindows: new Map([[record.id, win]]),
    screen: { ...screen, getCursorScreenPoint: () => cursor },
    dragPointer:
      overrides.dragPointer || ((_win, point) => ({ ...point, scale: null })),
    onChanged: () => {
      changes++;
    },
  });
  const event = { sender: win.webContents };
  return {
    record,
    win,
    controller,
    event,
    change: (collapsed) =>
      controller.setCollapsed(event, { id: record.id, collapsed }),
    drag: (phase) => controller.dragBubble(event, { id: record.id, phase }),
    moveCursor: (x, y) => {
      cursor = { x, y };
    },
    changes: () => changes,
  };
}

test("collapse and restore preserve full dimensions, content, and center", () => {
  const h = setup();
  assert.equal(h.change(true), true);
  assert.deepEqual(h.win.getBounds(), {
    x: 256,
    y: 186,
    width: 48,
    height: 48,
  });
  assert.equal(h.record.width, 360);
  assert.equal(h.record.height, 220);
  assert.equal(h.win.resizable, false);
  assert.equal(h.win.ignoring, false);
  assert.equal(h.win.protected, true);
  assert.equal(h.change(false), false);
  assert.deepEqual(h.win.getBounds(), {
    x: 100,
    y: 100,
    width: 360,
    height: 220,
  });
  assert.deepEqual(h.win.minimum, [280, 120]);
  assert.equal(h.win.resizable, true);
  assert.equal(h.record.text, "Private content");
  assert.equal(h.changes(), 2);
});

test("dragging moves the bubble without expanding or losing full size", () => {
  const h = setup();
  h.change(true);
  h.drag("start");
  h.moveCursor(210, 160);
  h.drag("move");
  h.drag("end");
  assert.equal(h.record.collapsed, true);
  assert.equal(h.record.x, 356);
  assert.equal(h.record.y, 236);
  h.change(false);
  assert.deepEqual(h.win.getBounds(), {
    x: 200,
    y: 150,
    width: 360,
    height: 220,
  });
});

test("restoring a persisted bubble at the screen edge keeps the note reachable", () => {
  const h = setup({ collapsed: true, x: 1872, y: 1032 });
  h.change(false);
  assert.deepEqual(h.win.getBounds(), {
    x: 1560,
    y: 860,
    width: 360,
    height: 220,
  });
});

test("tiny pointer movement is treated as a click, not a drag", () => {
  const h = setup({ collapsed: true });
  h.drag("start");
  h.moveCursor(112, 111);
  h.drag("end");
  assert.equal(h.record.x, 100);
  assert.equal(h.record.y, 100);
});

test("collapse IPC rejects malformed payloads and other windows", () => {
  const h = setup();
  for (const payload of [
    null,
    {},
    { id: 7 },
    { id: "note-a", collapsed: "true" },
    { id: "missing", collapsed: true },
  ]) {
    assert.equal(h.controller.setCollapsed(h.event, payload), null);
    assert.doesNotThrow(() => h.controller.dragBubble(h.event, payload));
  }
  assert.equal(
    h.controller.setCollapsed(
      { sender: {} },
      { id: "note-a", collapsed: true },
    ),
    null,
  );
  assert.equal(h.record.collapsed, false);
  assert.equal(h.changes(), 0);
});

test("repeated collapse requests do not shrink the saved full size", () => {
  const h = setup();
  h.change(true);
  h.change(true);
  assert.equal(h.record.width, 360);
  assert.equal(h.record.height, 220);
  assert.equal(h.changes(), 1);
});

test("toolbar dragging uses event coordinates even when the desktop cursor is stale", async () => {
  const h = setup();
  const drag = (phase, x, y, event = h.event) =>
    h.controller.dragNote(event, { id: h.record.id, phase, x, y });
  await drag("start", 130, 115);
  await drag("move", 250, 215);
  assert.deepEqual(h.win.getBounds(), {
    x: 220,
    y: 200,
    width: 360,
    height: 220,
  });
  assert.equal(h.record.x, 220);
  assert.equal(h.record.text, "Private content");
  await drag("end", 250, 215);
  await drag("move", 300, 300);
  assert.equal(h.record.x, 220);
});

test("toolbar drag rejects invalid coordinates and another window's sender", async () => {
  const h = setup();
  const payload = { id: h.record.id, phase: "start", x: 120, y: 120 };
  await h.controller.dragNote({ sender: {} }, payload);
  await h.controller.dragNote(h.event, { ...payload, phase: "move", x: 300 });
  assert.equal(h.record.x, 100);
  for (const x of [NaN, Infinity, "120", 100001]) {
    await h.controller.dragNote(h.event, { ...payload, x });
    await h.controller.dragNote(h.event, { ...payload, phase: "move", x: 300 });
    assert.equal(h.record.x, 100);
  }
});

test("toolbar dragging ignores small hand movements and stays engaged after starting", async () => {
  const h = setup();
  const drag = (phase, x, y) =>
    h.controller.dragNote(h.event, { id: h.record.id, phase, x, y });
  await drag("start", 130, 115);
  await drag("move", 135, 119);
  assert.equal(h.record.x, 100);
  assert.equal(h.record.y, 100);
  await drag("move", 140, 115);
  assert.equal(h.record.x, 110);
  await drag("move", 132, 115);
  assert.equal(h.record.x, 102);
  await drag("end", 130, 115);
  assert.equal(h.record.x, 100);
});

test("compositor coordinates prevent window movement from feeding back into the drag", async () => {
  let cursor = { x: 500, y: 300 };
  const h = setup({
    dragPointer: async () => ({ ...cursor, scale: { x: 1.25, y: 1.25 } }),
  });
  const drag = (phase, x, y) =>
    h.controller.dragNote(h.event, { id: h.record.id, phase, x, y });
  await drag("start", 500, 300);
  cursor = { x: 600, y: 350 };
  await drag("move", 3000, -2000);
  assert.deepEqual(h.win.getBounds(), {
    x: 200,
    y: 150,
    width: 360,
    height: 220,
  });
  await drag("move", -9000, 9000);
  assert.equal(h.record.x, 200);
  assert.equal(h.record.y, 150);
  await drag("end", 9000, -9000);
  assert.equal(h.record.x, 200);
  assert.equal(h.record.y, 150);
});

test("asynchronous drag start, movement, and release are processed in order", async () => {
  let reads = 0;
  const h = setup({
    dragPointer: async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return { x: 200 + reads++ * 20, y: 200, scale: { x: 1, y: 1 } };
    },
  });
  const drag = (phase) =>
    h.controller.dragNote(h.event, { id: h.record.id, phase, x: 200, y: 200 });
  await Promise.all([drag("start"), drag("move"), drag("end"), drag("move")]);
  assert.equal(h.record.x, 140);
  assert.equal(reads, 3);
});

test("resize handle grows and shrinks the note while preserving its position and content", async () => {
  const h = setup();
  const resize = (phase, x, y) =>
    h.controller.resizeNote(h.event, { id: h.record.id, phase, x, y });
  await resize("start", 400, 300);
  await resize("move", 520, 360);
  await resize("end", 520, 360);
  assert.deepEqual(h.win.getBounds(), {
    x: 100,
    y: 100,
    width: 480,
    height: 280,
  });
  assert.equal(h.record.width, 480);
  assert.equal(h.record.height, 280);
  assert.equal(h.record.text, "Private content");
  await resize("start", 520, 360);
  await resize("end", 0, 0);
  assert.deepEqual(h.win.getBounds(), {
    x: 100,
    y: 100,
    width: 280,
    height: 120,
  });
  assert.equal(h.record.width, 280);
});

test("resize rejects other senders, malformed points, and collapsed notes", async () => {
  const h = setup();
  const payload = { id: h.record.id, phase: "start", x: 400, y: 300 };
  await h.controller.resizeNote({ sender: {} }, payload);
  await h.controller.resizeNote(h.event, { ...payload, phase: "move", x: 800 });
  await h.controller.resizeNote(h.event, { ...payload, x: NaN });
  assert.equal(h.record.width, 360);
  h.change(true);
  await h.controller.resizeNote(h.event, payload);
  await h.controller.resizeNote(h.event, { ...payload, phase: "end", x: 800 });
  assert.equal(h.win.getBounds().width, 48);
  assert.equal(h.record.width, 360);
});

test("resize skips duplicate geometry and persists only after release", async () => {
  const h = setup();
  let sizes = 0;
  const setSize = h.win.setSize;
  h.win.setSize = (...args) => {
    sizes++;
    setSize(...args);
  };
  const resize = (phase, x) =>
    h.controller.resizeNote(h.event, { id: h.record.id, phase, x, y: 300 });
  await resize("start", 400);
  assert.equal(h.controller.isChanging(h.win), true);
  await resize("move", 450);
  await resize("move", 450);
  assert.equal(sizes, 1);
  assert.equal(h.record.width, 360);
  await resize("end", 450);
  assert.equal(sizes, 1);
  assert.equal(h.record.width, 410);
  assert.equal(h.controller.isChanging(h.win), false);
});

test("a burst of resize events keeps the latest move without a backlog", async () => {
  const h = setup();
  const resize = (phase, x) =>
    h.controller.resizeNote(h.event, { id: h.record.id, phase, x, y: 300 });
  await resize("start", 400);
  let sizes = 0;
  const setSize = h.win.setSize;
  h.win.setSize = (...args) => {
    sizes++;
    setSize(...args);
  };
  await Promise.all(
    Array.from({ length: 100 }, (_, i) => resize("move", 401 + i)),
  );
  assert.equal(sizes, 1);
  assert.equal(h.win.getBounds().width, 460);
  await resize("end", 500);
  assert.equal(h.record.width, 460);
});

test("resize release preserves the last size if the compositor sample fails", async () => {
  let sample = { x: 400, y: 300, scale: { x: 1, y: 1 } };
  const h = setup({ dragPointer: async () => sample });
  const resize = (phase) =>
    h.controller.resizeNote(h.event, { id: h.record.id, phase, x: 0, y: 0 });
  await resize("start");
  sample = { ...sample, x: 460 };
  await resize("move");
  sample = null;
  await resize("end");
  assert.equal(h.record.width, 420);
  assert.equal(h.controller.isChanging(h.win), false);
});
