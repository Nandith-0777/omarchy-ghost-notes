#!/usr/bin/env python3
"""Voxtype post-processor: paste into focused XWayland notes; pass other text through."""

import ctypes
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import time
import tomllib


def run(args, **kwargs):
    return subprocess.run(args, check=True, timeout=3, **kwargs)


def focused_note():
    window = json.loads(run(["hyprctl", "activewindow", "-j"], capture_output=True).stdout)
    return (
        window.get("class") in ("com.invisiblenotes.app", "invisible-notes")
        and window.get("initialTitle") == "Ghost Notes Note"
        and window.get("xwayland") is True
    )


def paste(text):
    x11 = ctypes.CDLL("libX11.so.6")
    xtest = ctypes.CDLL("libXtst.so.6")
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XKeysymToKeycode.restype = ctypes.c_ubyte
    x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    xtest.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    display = x11.XOpenDisplay(None)
    if not display:
        raise RuntimeError("Cannot connect to XWayland")
    try:
        ctrl = x11.XKeysymToKeycode(display, 0xFFE3)
        key = x11.XKeysymToKeycode(display, ord("v"))
        if not ctrl or not key:
            raise RuntimeError("Paste keys unavailable")
        # Keep clipboard contents only in memory, never in transcription files.
        previous = None
        try:
            types = run(["wl-paste", "--list-types"], capture_output=True).stdout.decode().splitlines()
            mime = next((t for t in types if t.startswith("text/plain")), types[0])
            previous = (mime, run(["wl-paste", "--no-newline", "--type", mime], capture_output=True).stdout)
        except (subprocess.SubprocessError, IndexError):
            pass
        run(["wl-copy", "--type", "text/plain;charset=utf-8"], input=text.encode(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.15)
        # Do not paste into another app if focus changed during preparation.
        if not focused_note():
            raise RuntimeError("Note lost focus before dictation was pasted")
        for code, pressed in ((ctrl, 1), (key, 1), (key, 0), (ctrl, 0)):
            xtest.XTestFakeKeyEvent(display, code, pressed, 0)
            x11.XSync(display, False)
            time.sleep(0.06)
        time.sleep(0.5)
        if previous:
            try:
                current = run(["wl-paste", "--no-newline"], capture_output=True).stdout
                if current == text.encode():
                    run(["wl-copy", "--type", previous[0]], input=previous[1], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except subprocess.SubprocessError:
                # Insertion already succeeded; never trigger duplicate fallback output.
                pass
    finally:
        x11.XCloseDisplay(display)


def install():
    for command in ("hyprctl", "wl-copy", "wl-paste"):
        if not shutil.which(command):
            raise RuntimeError(f"Required command not found: {command}")
    ctypes.CDLL("libX11.so.6")
    ctypes.CDLL("libXtst.so.6")
    config = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "voxtype/config.toml"
    source = config.read_text()
    parsed = tomllib.loads(source)
    command = "python3 " + shlex.quote(str(Path(__file__).resolve()))
    existing = parsed.get("output", {}).get("post_process", {})
    if existing.get("command") == command and existing.get("fallback_on_empty") is False:
        print("Ghost Notes dictation integration is already installed.")
        return
    if existing or "[output.post_process]" in [line.strip() for line in source.splitlines()]:
        raise RuntimeError("An existing Voxtype post-processor is configured; preserve it and integrate manually.")
    updated = source.rstrip() + "\n\n# Paste dictation only into Ghost Notes; other apps keep normal output.\n[output.post_process]\ncommand = " + json.dumps(command) + "\ntimeout_ms = 5000\ntrim = false\nfallback_on_empty = false\n"
    tomllib.loads(updated)
    backup = config.with_name(config.name + f".backup-ghost-notes-{time.time_ns()}")
    shutil.copy2(config, backup)
    temp = config.with_name(config.name + f".ghost-notes-{os.getpid()}")
    try:
        temp.write_text(updated)
        temp.chmod(config.stat().st_mode & 0o777)
        temp.replace(config)
    finally:
        temp.unlink(missing_ok=True)
    print(f"Installed. Backup: {backup}")
    print("Restart Voxtype to apply: systemctl --user restart voxtype")


if __name__ == "__main__":
    if sys.argv[1:] == ["--install"]:
        install()
    else:
        text = sys.stdin.read()
        try:
            if text and focused_note():
                paste(text)
                # Empty output suppresses Voxtype's broken per-character injection.
            else:
                sys.stdout.write(text)
        except Exception as error:
            print(f"Ghost Notes dictation: {error}", file=sys.stderr)
            # A failed post-processor lets Voxtype retain its original text.
            sys.exit(1)
