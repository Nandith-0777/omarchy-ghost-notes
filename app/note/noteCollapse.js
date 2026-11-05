const platform = require("../platform");
const { clampToVisibleDisplay, displayIdForPoint } = require("../displayUtils");
const {
  COLLAPSED_NOTE_SIZE,
  MIN_NOTE_WIDTH,
  MIN_NOTE_HEIGHT,
} = require("./noteSize");

function createNoteCollapseController({
  store,
  noteWindows,
  screen,
  onChanged,
  dragPointer = platform.dragPointer,
}) {
  const changing = new WeakSet();
  const drags = new WeakMap();
  const dragQueues = new WeakMap();

  function target(event, payload) {
    if (!payload || typeof payload.id !== "string") return null;
    const win = noteWindows.get(payload.id);
    if (!win || win.isDestroyed() || win.webContents !== event.sender)
      return null;
    const record = store.get(payload.id);
    return record ? { win, record } : null;
  }

  function visibleBounds(bounds) {
    const safe = clampToVisibleDisplay(bounds);
    const { workArea } = screen.getDisplayMatching(safe);
    return {
      x: Math.round(
        Math.max(
          workArea.x,
          Math.min(safe.x, workArea.x + workArea.width - safe.width),
        ),
      ),
      y: Math.round(
        Math.max(
          workArea.y,
          Math.min(safe.y, workArea.y + workArea.height - safe.height),
        ),
      ),
      width: safe.width,
      height: safe.height,
    };
  }

  function setCollapsed(event, payload) {
    const found = target(event, payload);
    if (!found || typeof payload.collapsed !== "boolean") return null;
    const { win, record } = found;
    const { collapsed } = payload;
    if (!!record.collapsed === collapsed) return collapsed;
    const previous = win.getBounds();
    const width = collapsed
      ? previous.width
      : Math.max(record.width, MIN_NOTE_WIDTH);
    const height = collapsed
      ? previous.height
      : Math.max(record.height, MIN_NOTE_HEIGHT);
    const size = collapsed
      ? { width: COLLAPSED_NOTE_SIZE, height: COLLAPSED_NOTE_SIZE }
      : { width, height };
    const bounds = visibleBounds({
      x: Math.round(previous.x + (previous.width - size.width) / 2),
      y: Math.round(previous.y + (previous.height - size.height) / 2),
      ...size,
    });

    changing.add(win);
    try {
      store.update(record.id, {
        collapsed,
        width,
        height,
        x: bounds.x,
        y: bounds.y,
        displayId: displayIdForPoint(bounds.x, bounds.y),
      });
      win.setIgnoreMouseEvents(false);
      win.setMinimumSize(COLLAPSED_NOTE_SIZE, COLLAPSED_NOTE_SIZE);
      win.setResizable(true);
      win.setBounds(bounds);
      win.setMinimumSize(
        collapsed ? COLLAPSED_NOTE_SIZE : MIN_NOTE_WIDTH,
        collapsed ? COLLAPSED_NOTE_SIZE : MIN_NOTE_HEIGHT,
      );
      win.setResizable(!collapsed);
      win.setContentProtection(true);
      drags.delete(win);
    } finally {
      changing.delete(win);
    }
    onChanged();
    return collapsed;
  }

  function dragBubble(
    event,
    payload,
    expanded = false,
    sampled = null,
    resizing = false,
  ) {
    const found = target(event, payload);
    if (!found || (expanded ? found.record.collapsed : !found.record.collapsed))
      return;
    if (
      expanded &&
      (!Number.isFinite(payload.x) ||
        !Number.isFinite(payload.y) ||
        Math.abs(payload.x) > 100000 ||
        Math.abs(payload.y) > 100000)
    )
      return;
    const pointer = () => (expanded ? sampled : screen.getCursorScreenPoint());
    if (!["start", "move", "end"].includes(payload.phase)) return;
    const { win, record } = found;
    if (payload.phase === "start") {
      const cursor = pointer();
      if (!cursor) return;
      drags.set(win, {
        cursor,
        lastCursor: cursor,
        bounds: win.getBounds(),
        active: false,
        resizing,
        lastBounds: win.getBounds(),
      });
      return;
    }
    const drag = drags.get(win);
    if (!drag || drag.resizing !== resizing) return;
    const cursor =
      pointer() || (payload.phase === "end" ? drag.lastCursor : null);
    if (!cursor) return;
    drag.lastCursor = cursor;
    const dx = cursor.x - drag.cursor.x;
    const dy = cursor.y - drag.cursor.y;
    if (Math.hypot(dx, dy) >= (expanded ? 8 : 4)) drag.active = true;
    if (drag.active) {
      const bounds = resizing
        ? {
            ...drag.bounds,
            width: Math.max(MIN_NOTE_WIDTH, Math.round(drag.bounds.width + dx)),
            height: Math.max(
              MIN_NOTE_HEIGHT,
              Math.round(drag.bounds.height + dy),
            ),
          }
        : visibleBounds({
            ...drag.bounds,
            x: drag.bounds.x + dx,
            y: drag.bounds.y + dy,
          });
      const previous = drag.lastBounds;
      if (Object.keys(bounds).some((key) => bounds[key] !== previous[key])) {
        changing.add(win);
        try {
          if (resizing) win.setSize(bounds.width, bounds.height, false);
          else win.setBounds(bounds, false);
          drag.lastBounds = bounds;
        } finally {
          changing.delete(win);
        }
      }
      if (!resizing || payload.phase === "end")
        store.update(record.id, {
          x: bounds.x,
          y: bounds.y,
          displayId: displayIdForPoint(bounds.x, bounds.y),
          ...(resizing ? { width: bounds.width, height: bounds.height } : {}),
        });
    }
    if (payload.phase === "end") drags.delete(win);
  }

  function dragNote(event, payload, resizing = false) {
    const found = target(event, payload);
    if (
      !found ||
      found.record.collapsed ||
      !["start", "move", "end"].includes(payload.phase) ||
      !Number.isFinite(payload.x) ||
      !Number.isFinite(payload.y) ||
      Math.abs(payload.x) > 100000 ||
      Math.abs(payload.y) > 100000
    )
      return Promise.resolve();
    const { win } = found;
    let queue = dragQueues.get(win);
    if (!queue) {
      queue = { tail: Promise.resolve(), pending: null };
      dragQueues.set(win, queue);
    }
    // Keep only the latest waiting move; stale pointer samples add visible lag.
    if (payload.phase === "move" && queue.pending?.resizing === resizing) {
      queue.pending.payload = payload;
      return queue.pending.promise;
    }
    const job = { payload, resizing };
    if (payload.phase !== "move") queue.pending = null;
    const next = queue.tail.then(async () => {
      if (queue.pending === job) queue.pending = null;
      const payload = job.payload;
      if (win.isDestroyed()) return;
      const drag = drags.get(win);
      if (payload.phase !== "start" && !drag) return;
      const sampled =
        drag && !drag.cursor.scale
          ? { x: payload.x, y: payload.y, scale: null }
          : await dragPointer(
              win,
              { x: payload.x, y: payload.y },
              drag?.cursor.scale,
            );
      dragBubble(event, payload, true, sampled, resizing);
    });
    const queued = next.catch(() => drags.delete(win));
    queue.tail = queued;
    job.promise = queued;
    if (payload.phase === "move") queue.pending = job;
    return queued;
  }

  return {
    setCollapsed,
    dragBubble,
    dragNote,
    resizeNote: (event, payload) => dragNote(event, payload, true),
    isChanging: (win) => changing.has(win) || drags.has(win),
  };
}

module.exports = { createNoteCollapseController };
