// Note BrowserWindow factory; lifecycle callbacks are supplied by the caller.
const path = require("path");
const { BrowserWindow } = require("electron");
const platform = require("../platform");
const { clampToVisibleDisplay } = require("../displayUtils");
const {
  COLLAPSED_NOTE_SIZE,
  MIN_NOTE_WIDTH,
  MIN_NOTE_HEIGHT,
} = require("./noteSize");

// Re-apply screen-capture exclusion on a note window.
const sharingVisibility = new WeakMap();

function applyContentProtection(
  win,
  shareVisible = sharingVisibility.get(win) === true,
) {
  if (!win || win.isDestroyed()) return;
  sharingVisibility.set(win, shareVisible === true);
  win.setContentProtection(shareVisible !== true);
  platform.setSharingVisibility(win, shareVisible === true);
}

function createNoteWindow(record, { onMoved, onResized, onClosed } = {}) {
  const bounds = clampToVisibleDisplay({
    ...record,
    width: record.collapsed
      ? COLLAPSED_NOTE_SIZE
      : Math.max(record.width || 0, MIN_NOTE_WIDTH),
    height: record.collapsed
      ? COLLAPSED_NOTE_SIZE
      : Math.max(record.height || 0, MIN_NOTE_HEIGHT),
  });

  const win = new BrowserWindow({
    ...platform.noteWindowOptions(),
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: !record.collapsed,
    hasShadow: false,
    skipTaskbar: true,
    minWidth: record.collapsed ? COLLAPSED_NOTE_SIZE : MIN_NOTE_WIDTH,
    minHeight: record.collapsed ? COLLAPSED_NOTE_SIZE : MIN_NOTE_HEIGHT,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (platform.isLinux) {
    win.on("page-title-updated", (event) => event.preventDefault());
  }
  sharingVisibility.set(win, record.shareVisible === true);
  platform.setPinned(win, record.ghost || record.pinned !== false);

  if (platform.isWindows || (platform.isLinux && !platform.isMac)) {
    win.on("show", () => applyContentProtection(win));
    win.on("restore", () => applyContentProtection(win));
  }

  win.loadFile(path.join(__dirname, "note.html"), { query: { id: record.id } });

  win.once("ready-to-show", () => {
    applyContentProtection(win);
    if (record.visible !== false) win.showInactive();
  });

  if (onMoved) win.on("moved", () => onMoved(win));
  if (onResized) win.on("resized", () => onResized(win));
  if (onClosed) win.on("closed", () => onClosed());

  return win;
}

module.exports = { createNoteWindow, applyContentProtection };
