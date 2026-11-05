// Shortcuts that apply while a Ghost Notes window is focused.
const platform = require("../platform");
const keys = require("./key-combo");
const capturing = new WeakSet();

// Shared shortcut list for matching, tray accelerators, and the in-app legend.
const SHORTCUTS = [
  {
    id: "newNote",
    scope: "app",
    accelerator: "CommandOrControl+Shift+N",
    label: "New note",
    description: "Drops a fresh note next to the cursor.",
  },
  {
    id: "openManager",
    scope: "app",
    accelerator: "CommandOrControl+Shift+M",
    label: "Notes Manager",
    description: "Every note you have saved, open or hidden.",
  },
  {
    id: "toggleHideAll",
    scope: "app",
    accelerator: "CommandOrControl+Shift+H",
    label: "Hide / show all notes",
    description:
      "Hiding keeps the contents — notes reopen exactly where they were.",
  },
  {
    id: "toggleGhostAll",
    scope: "app",
    accelerator: "CommandOrControl+Shift+G",
    label: "Toggle click-through",
    description:
      "Clicks pass straight through your notes. Hover a note bar to interact again.",
  },
  {
    id: "newNoteAnywhere",
    scope: "global",
    accelerator: "CommandOrControl+Alt+Shift+N",
    label: "New note from anywhere",
    description:
      "Create a note while another app has focus. Ghost Notes must be running in the tray.",
  },
  {
    id: "openManagerAnywhere",
    scope: "global",
    action: "openManager",
    accelerator: "CommandOrControl+Alt+Shift+M",
    label: "Notes Manager from anywhere",
    description: "Open your notes while another app has focus.",
  },
  {
    id: "toggleHideAllAnywhere",
    scope: "global",
    action: "toggleHideAll",
    accelerator: "CommandOrControl+Alt+Shift+H",
    label: "Hide / show notes from anywhere",
    description: "Show or hide notes without switching apps.",
  },
  {
    id: "toggleGhostAllAnywhere",
    scope: "global",
    action: "toggleGhostAll",
    accelerator: "CommandOrControl+Alt+Shift+G",
    label: "Click-through from anywhere",
    description: "Toggle click-through while another app has focus.",
  },
];

const GLOBAL_SHORTCUT = SHORTCUTS.find(
  (shortcut) => shortcut.scope === "global",
);

const FALLBACK_BINDING = GLOBAL_SHORTCUT.accelerator;

const globalResults = new Map();
let activeOverrides = {};
let registeredFallbackBinding = null;

function resolveShortcuts(overrides = activeOverrides) {
  return SHORTCUTS.map((shortcut) => {
    const accelerator = overrides[shortcut.id] || shortcut.accelerator;
    return {
      ...shortcut,
      accelerator,
      defaultAccelerator: shortcut.accelerator,
      isCustom: Boolean(
        overrides[shortcut.id] &&
        overrides[shortcut.id] !== shortcut.accelerator,
      ),
    };
  });
}

let BINDINGS = Object.fromEntries(
  resolveShortcuts()
    .filter((s) => s.scope === "app")
    .map((s) => [s.id, s.accelerator]),
);

function buildLookupTables(overrides = activeOverrides) {
  BINDINGS = Object.fromEntries(
    resolveShortcuts(overrides)
      .filter((s) => s.scope === "app")
      .map((s) => [s.id, s.accelerator]),
  );
}

buildLookupTables();

function applyOverrides(overrides = {}) {
  activeOverrides = { ...overrides };
  buildLookupTables(activeOverrides);
}

function getShortcuts(overrides = activeOverrides) {
  return resolveShortcuts(overrides).map((shortcut) => ({
    ...shortcut,
    registration:
      shortcut.scope === "global"
        ? globalResults.has(shortcut.id)
          ? globalResults.get(shortcut.id)
            ? "registered"
            : "unavailable"
          : "not-registered"
        : null,
    display: platform.formatAccelerator(shortcut.accelerator),
  }));
}

function shortcutNameForInput(input) {
  if (!input || input.type !== "keyDown" || input.isAutoRepeat) return null;
  return (
    resolveShortcuts().find(
      (shortcut) =>
        shortcut.scope === "app" &&
        keys.matches(shortcut.accelerator, input, platform.isMac),
    )?.id || null
  );
}

function registerShortcuts(win, actions) {
  win.webContents.on("before-input-event", (event, input) => {
    if (capturing.has(win)) return;
    const name = shortcutNameForInput(input);
    const handler = name && actions[name];
    if (!handler) return;
    event.preventDefault();
    handler();
  });
}

function registerFallbackShortcut(globalShortcut, handler, customBinding) {
  const binding =
    customBinding || activeOverrides[GLOBAL_SHORTCUT.id] || FALLBACK_BINDING;
  if (registeredFallbackBinding && registeredFallbackBinding !== binding) {
    globalShortcut.unregister(registeredFallbackBinding);
    platform.unregisterCompositorShortcut("newNote");
    registeredFallbackBinding = null;
  }
  const compositorRegistered = platform.registerCompositorShortcut(binding);
  let registered = compositorRegistered;
  if (!registered && !platform.hasShortcutConflict()) {
    try {
      registered = globalShortcut.register(binding, handler);
    } catch {
      registered = false;
    }
  }
  if (registered) registeredFallbackBinding = binding;
  platform.setShortcutStatus(
    compositorRegistered
      ? "registered-via-compositor"
      : registered
        ? platform.runtimeStatus().backend === "wayland"
          ? "pending"
          : "registered"
        : "unavailable",
  );
  if (!registered) {
    console.warn(
      `Fallback shortcut ${binding} could not be registered. It may be in use, or the desktop shortcut portal may be unavailable.`,
    );
  }
  return registered;
}

function unregisterFallbackShortcut(globalShortcut, customBinding) {
  const binding =
    customBinding || registeredFallbackBinding || FALLBACK_BINDING;
  globalShortcut.unregister(binding);
  platform.unregisterCompositorShortcut("newNote");
  registeredFallbackBinding = null;
}

const extraGlobalBindings = new Map();
function registerGlobalShortcuts(globalShortcut, actions) {
  unregisterGlobalShortcuts(globalShortcut);
  globalResults.clear();
  globalResults.set(
    "newNoteAnywhere",
    registerFallbackShortcut(globalShortcut, actions.newNote),
  );
  for (const shortcut of getShortcuts().filter(
    (s) => s.scope === "global" && s.action,
  )) {
    const compositor = platform.registerCompositorShortcut(
      shortcut.accelerator,
      shortcut.action,
    );
    let registered = compositor;
    if (!compositor && !platform.hasShortcutConflict()) {
      try {
        registered = globalShortcut.register(
          shortcut.accelerator,
          actions[shortcut.action],
        );
      } catch {
        registered = false;
      }
    }
    globalResults.set(shortcut.id, registered);
    if (registered) extraGlobalBindings.set(shortcut.id, shortcut);
  }
  if ([...globalResults.values()].some((value) => !value))
    platform.setShortcutStatus("conflict-or-unavailable");
  return Object.fromEntries(globalResults);
}
function unregisterGlobalShortcuts(globalShortcut) {
  unregisterFallbackShortcut(globalShortcut);
  for (const shortcut of extraGlobalBindings.values()) {
    globalShortcut.unregister(shortcut.accelerator);
    platform.unregisterCompositorShortcut(shortcut.action);
  }
  extraGlobalBindings.clear();
}

function validateShortcut(id, value, overrides = activeOverrides) {
  if (!SHORTCUTS.some((s) => s.id === id))
    return { error: "Unknown shortcut." };
  const parsed = keys.parse(value, platform.isMac);
  if (!parsed)
    return {
      error:
        "Use Ctrl, Alt, Shift, or Super plus another key. For example: Alt+F8.",
    };
  const duplicate = resolveShortcuts(overrides).find(
    (s) =>
      s.id !== id &&
      keys.parse(s.accelerator, platform.isMac)?.accelerator ===
        parsed.accelerator,
  );
  if (duplicate)
    return {
      error: `Already assigned to “${duplicate.label}”. Choose a different combination.`,
    };
  return { accelerator: parsed.accelerator };
}

module.exports = {
  validateShortcut,
  setShortcutCapture: (win, active) =>
    active ? capturing.add(win) : capturing.delete(win),
  registerGlobalShortcuts,
  unregisterGlobalShortcuts,
  globalShortcutResults: () => Object.fromEntries(globalResults),
  SHORTCUTS,
  registerShortcuts,
  registerFallbackShortcut,
  unregisterFallbackShortcut,
  shortcutNameForInput,
  getShortcuts,
  applyOverrides,
  get BINDINGS() {
    return BINDINGS;
  },
  FALLBACK_BINDING,
};
