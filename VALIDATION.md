# Local validation — 2026-11-05

- `omarchy plugin validate .`: passed, including the no-symlink check.
- `qmllint`: passed with the installed Omarchy `qs.Ui` imports resolved through
  a temporary import directory outside the plugin checkout.
- `bash -n scripts/*.sh`: passed.
- Launcher regression test: passed for manager/new-note actions, paths containing
  spaces, rejected invalid actions, and removal of `ELECTRON_RUN_AS_NODE`.
- Locked runtime setup: tested under a disposable `XDG_DATA_HOME`, including
  Electron's explicit binary installation. No desktop configuration was modified.
- Bundled app tests: all test files passed with the installed runtime on `NODE_PATH`.
- Cold launch: the downloaded runtime opened the bundled app's Notes Manager and
  note window with a disposable profile; manager filters were present.
- Native companion: built successfully against installed Hyprland 0.56.2 headers.
  The copy built for this package was not loaded into the live compositor.
- Global shortcuts: all four actions passed real Wayland keyboard tests while
  a separate application held focus, including recovery with every note hidden.
- Custom shortcut editor: nine integration checks passed, including actual key
  recording, suppression of existing shortcuts during capture, exact Alt+F8
  matching, global Space, duplicate/system-conflict rollback, and reset.
- Source formatting: passed.
- Marketplace preflight: the proposed ID and repository were not in the registry.

The shell widget was type-checked but has not been enabled in the user's live
bar. The app and capture companion derive from the locally tested Ghost Notes
implementation. No fresh Google Meet or Zoom session was tested for this package.

Marketplace submission requires the owner's review of `SUBMISSION.md`.
The checks above describe local validation before the initial publication.

## Automatic installer — 7 November 2026

The one-command installer is tested with disposable homes and mocked package,
compiler, and compositor commands. Coverage includes fresh installation,
repeat installation, removal, preserving later user edits, unsupported builds,
mismatched headers, dependency bootstrap, compiler failure, and configuration
rollback. No live desktop configuration or real package installation was used
for those tests.

The real C++ companion also built successfully against this machine's installed
headers. The test build was not loaded into the live compositor.

A read-only preflight passed on Omarchy 4.5.0-3 with Hyprland 0.56.2 at the
supported exact commit. Existing capture behavior on that laptop was checked
separately; the user reports successful Google Meet and Zoom sharing.

## Real clean-install and reinstall trial

The existing source-based app was stopped, its native companion and desktop
integration removed, and its note profile moved into a private backup. The
published GitHub command then installed a new checkout and locked Electron
runtime, compiled the companion against real headers, configured Hyprland and
autostart, enabled the bar button, and launched Notes Manager. Shared operating
system dependencies were retained.

Real keyboard input from another focused application verified new-note,
manager, and hide/show shortcuts. Ghost-toggle dispatch also completed. Capture
status reported `compositor-omit`; configuration errors were empty. This trial
did not include a new meeting/capture recording.

The repeat-install trial exposed two issues: Electron can rewrite `/proc`
arguments into a process-title string, and config reload does not necessarily
reload a manually unloaded native plugin. Both were corrected with regression
tests. A second real installer run subsequently stopped/restarted its own app,
explicitly reloaded the companion, and left exactly one autostart entry and one
Ghost Notes source line. Both repositories' code CI runs passed.

Chromium logged graphics/VSync warnings but the app opened and the tested
operations succeeded. The original note profile was retained privately; no
private note content is included in this repository. A separate laptop remains
a useful next compatibility test.

## Per-note sharing toggle — 11 November 2026

A disposable note on the supported Omarchy/Hyprland build switched capture
protection true → false → true using its new screen-sharing button. A temporary
headless display and public patterned fixture verified captured pixels: private
and private-again frames matched the background-only baseline, while shared
mode included the note. Restarting preserved an explicitly shared note; its
initial identity stayed compatible with input routing and pinning. Reloading
configuration preserved the sharing choice. Invalid sharing IPC was rejected.

Updated bundled app and installer suite: 142 passed, 7 skipped, no failures.
This change has not been tested in a new Meet/Zoom call or on physical
Windows/macOS hardware.
