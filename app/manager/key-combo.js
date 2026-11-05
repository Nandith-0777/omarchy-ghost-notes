(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShortcutKeys = factory();
})(globalThis, function () {
  const named = [
    "Space",
    "Tab",
    "Capslock",
    "Numlock",
    "Scrolllock",
    "Backspace",
    "Delete",
    "Insert",
    "Enter",
    "Up",
    "Down",
    "Left",
    "Right",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Escape",
    "VolumeUp",
    "VolumeDown",
    "VolumeMute",
    "MediaNextTrack",
    "MediaPreviousTrack",
    "MediaStop",
    "MediaPlayPause",
    "PrintScreen",
    "numdec",
    "numadd",
    "numsub",
    "nummult",
    "numdiv",
  ];
  const names = Object.fromEntries(
    named.map((key) => [key.toLowerCase(), key]),
  );
  Object.assign(names, {
    return: "Enter",
    esc: "Escape",
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
    audiovolumeup: "VolumeUp",
    audiovolumedown: "VolumeDown",
    audiovolumemute: "VolumeMute",
    mediatracknext: "MediaNextTrack",
    mediatrackprevious: "MediaPreviousTrack",
  });
  const punctuation = {
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
  };
  const shifted = {
    "~": "`",
    "!": "1",
    "@": "2",
    "#": "3",
    $: "4",
    "%": "5",
    "^": "6",
    "&": "7",
    "*": "8",
    "(": "9",
    ")": "0",
    _: "-",
    "+": "=",
    "{": "[",
    "}": "]",
    "|": "\\",
    ":": ";",
    '"': "'",
    "<": ",",
    ">": ".",
    "?": "/",
  };
  const numpad = {
    NumpadDecimal: "numdec",
    NumpadAdd: "numadd",
    NumpadSubtract: "numsub",
    NumpadMultiply: "nummult",
    NumpadDivide: "numdiv",
    NumpadEnter: "Enter",
  };
  function parse(value, isMac = false) {
    if (typeof value !== "string" || !value.trim() || value.length > 120)
      return null;
    let text = value.trim();
    if (text === "+") text = "Plus";
    else if (text.endsWith("++")) text = text.slice(0, -1) + "Plus";
    const parts = text.split("+").map((part) => part.trim());
    let key = parts.pop();
    const mods = {
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      altgr: false,
    };
    for (const part of parts) {
      const name = part.toLowerCase();
      const field = ["control", "ctrl"].includes(name)
        ? "ctrl"
        : ["commandorcontrol", "cmdorctrl"].includes(name)
          ? isMac
            ? "meta"
            : "ctrl"
          : ["command", "cmd", "super", "meta", "win"].includes(name)
            ? "meta"
            : ["alt", "option"].includes(name)
              ? "alt"
              : name === "shift"
                ? "shift"
                : name === "altgr"
                  ? "altgr"
                  : null;
      if (!field || mods[field]) return null;
      mods[field] = true;
    }
    if (!mods.ctrl && !mods.alt && !mods.shift && !mods.meta) return null;
    if (key.toLowerCase() === "plus") key = "+";
    if (Object.hasOwn(shifted, key)) {
      mods.shift = true;
      key = shifted[key];
    }
    if (/^[a-z0-9]$/i.test(key)) key = key.toUpperCase();
    else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(key)) key = key.toUpperCase();
    else if (/^num[0-9]$/i.test(key)) key = key.toLowerCase();
    else if (names[key.toLowerCase()]) key = names[key.toLowerCase()];
    else if (![...Object.values(punctuation)].includes(key)) return null;
    const prefix = [
      ["ctrl", "Ctrl"],
      ["alt", "Alt"],
      ["shift", "Shift"],
      ["meta", "Super"],
      ["altgr", "AltGr"],
    ]
      .filter(([field]) => mods[field])
      .map(([, name]) => name);
    return { ...mods, key, accelerator: [...prefix, key].join("+") };
  }
  function eventKey(event) {
    const code = event.code || "";
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return "num" + code.slice(6);
    if (numpad[code]) return numpad[code];
    if (punctuation[code]) return punctuation[code];
    if (
      [
        "Control",
        "Shift",
        "Alt",
        "Meta",
        "OS",
        "AltGraph",
        "Dead",
        "Unidentified",
      ].includes(event.key)
    )
      return null;
    const key = event.key === " " ? "Space" : event.key;
    return names[String(key).toLowerCase()] || key;
  }
  function fromEvent(event) {
    const key = eventKey(event);
    if (!key || event.isComposing) return null;
    const parts = [];
    if (event.ctrlKey ?? event.control) parts.push("Ctrl");
    if (event.altKey ?? event.alt) parts.push("Alt");
    if (event.shiftKey ?? event.shift) parts.push("Shift");
    if (event.metaKey ?? event.meta) parts.push("Super");
    if (event.altgr) parts.push("AltGr");
    return parse([...parts, key].join("+"));
  }
  function matches(accelerator, event, isMac = false) {
    const expected = parse(accelerator, isMac),
      actual = fromEvent(event);
    return (
      !!expected && !!actual && expected.accelerator === actual.accelerator
    );
  }
  const hyprNames = {
    Space: "space",
    Enter: "Return",
    numenter: "KP_Enter",
    Backspace: "BackSpace",
    Capslock: "Caps_Lock",
    Numlock: "Num_Lock",
    Scrolllock: "Scroll_Lock",
    PageUp: "Prior",
    PageDown: "Next",
    PrintScreen: "Print",
    VolumeUp: "XF86AudioRaiseVolume",
    VolumeDown: "XF86AudioLowerVolume",
    VolumeMute: "XF86AudioMute",
    MediaNextTrack: "XF86AudioNext",
    MediaPreviousTrack: "XF86AudioPrev",
    MediaStop: "XF86AudioStop",
    MediaPlayPause: "XF86AudioPlay",
    numdec: "KP_Decimal",
    numadd: "KP_Add",
    numsub: "KP_Subtract",
    nummult: "KP_Multiply",
    numdiv: "KP_Divide",
    "`": "grave",
    "-": "minus",
    "=": "equal",
    "[": "bracketleft",
    "]": "bracketright",
    "\\": "backslash",
    ";": "semicolon",
    "'": "apostrophe",
    ",": "comma",
    ".": "period",
    "/": "slash",
  };
  function hyprKey(key) {
    return (
      hyprNames[key] || (/^num[0-9]$/.test(key) ? "KP_" + key.slice(3) : key)
    );
  }
  return { parse, fromEvent, matches, hyprKey };
});
