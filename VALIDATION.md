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
A complete fresh-laptop trial remains to be done.
