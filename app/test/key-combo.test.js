const test = require("node:test");
const assert = require("node:assert/strict");
const keys = require("../manager/key-combo");

test("normalizes modifiers, special keys, punctuation, and keypad keys", () => {
  for (const [source, expected] of [
    ["alt+f24", "Alt+F24"],
    ["Win+Shift+Space", "Shift+Super+Space"],
    ["Control+ArrowDown", "Ctrl+Down"],
    ["Ctrl++", "Ctrl+Shift+="],
    ["Alt+numadd", "Alt+numadd"],
    ["Shift+N", "Shift+N"],
    ["Ctrl+Escape", "Ctrl+Escape"],
    ["Ctrl+?", "Ctrl+Shift+/"],
    ["CommandOrControl+N", "Ctrl+N"],
  ])
    assert.equal(keys.parse(source).accelerator, expected);
  assert.equal(keys.parse("CommandOrControl+N", true).accelerator, "Super+N");
  for (const invalid of [
    "",
    null,
    "N",
    "5",
    "Escape",
    "F8",
    "?",
    "AltGr+N",
    "Ctrl",
    "Ctrl+Shift",
    "Ctrl+Ctrl+N",
    "Control+A+B",
    "Ctrl+F25",
    "Ctrl+; malicious",
  ])
    assert.equal(keys.parse(invalid), null);
});

test("records the pressed modifiers without adding Ctrl or Shift", () => {
  assert.equal(
    keys.fromEvent({ key: "F8", code: "F8", altKey: true }).accelerator,
    "Alt+F8",
  );
  assert.equal(
    keys.fromEvent({ key: "k", code: "KeyK", metaKey: true }).accelerator,
    "Super+K",
  );
  assert.equal(keys.fromEvent({ key: "5", code: "Digit5" }), null);
  assert.equal(
    keys.fromEvent({ key: "Add", code: "NumpadAdd", ctrlKey: true })
      .accelerator,
    "Ctrl+numadd",
  );
  assert.equal(
    keys.fromEvent({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true })
      .accelerator,
    "Ctrl+Shift+/",
  );
  assert.equal(
    keys.fromEvent({ key: "Shift", code: "ShiftLeft", shiftKey: true }),
    null,
  );
});

test("matches exact modifiers and physical keys in Electron input", () => {
  assert.equal(
    keys.matches("Alt+F8", { key: "F8", code: "F8", alt: true }),
    true,
  );
  assert.equal(
    keys.matches("Alt+F8", { key: "F8", code: "F8", alt: true, control: true }),
    false,
  );
  assert.equal(
    keys.matches("Super+Shift+K", {
      key: "л",
      code: "KeyK",
      meta: true,
      shift: true,
    }),
    true,
  );
  assert.equal(
    keys.matches("Ctrl+Down", {
      key: "ArrowDown",
      code: "ArrowDown",
      control: true,
    }),
    true,
  );
  assert.equal(
    keys.matches("Ctrl+num5", { key: "5", code: "Numpad5", control: true }),
    true,
  );
  assert.equal(
    keys.matches("Ctrl+5", { key: "5", code: "Numpad5", control: true }),
    false,
  );
});

test("maps supported keys to compositor names", () => {
  for (const [key, name] of [
    ["Space", "space"],
    ["Enter", "Return"],
    ["PageUp", "Prior"],
    ["numadd", "KP_Add"],
    ["num5", "KP_5"],
    ["VolumeUp", "XF86AudioRaiseVolume"],
    ["/", "slash"],
  ])
    assert.equal(keys.hyprKey(key), name);
});
