# Ghost Notes on Linux

This branch adds Linux application packaging, desktop integration, keychain
selection and a Hyprland integration. It does **not** promise Windows/macOS-style
capture exclusion on every Linux desktop or every recorder.

## Install from source

Use Node.js 22.12 or newer, npm, an X server (X11 or XWayland), and a desktop
keychain such as GNOME Keyring or KWallet. On a Wayland session, XWayland is used
by default when `DISPLAY` is available because native Wayland restricts the
positioning, focus and resizing required by note and bubble windows.

```sh
npm ci
npm start
```

Install a user-local launcher and desktop entry:

```sh
npm run setup:linux
```

On Hyprland with Lua configuration (tested on 0.56.2):

```sh
npm run setup:linux -- --hyprland
hyprctl reload
hyprctl configerrors
```

The setup command writes `~/.local/bin/ghost-notes`, an app-menu entry named
**Ghost Notes (Linux)**, and, when requested, `~/.config/hypr/ghost-notes.lua`.
It backs up changed Hyprland configuration files and adds an idempotent source
line to `hyprland.lua`. XDG_CONFIG_HOME and XDG_DATA_HOME are respected. The local
launcher references this checkout and its installed Electron runtime: rerun the
setup command if the checkout moves. No root access is required.

The Hyprland rule matches only the stable note-window title and application
class. Notes float automatically; the manager remains a normal window. The
rule is also requested at runtime for development launches. The persisted rule
keeps masking and floating rules available after compositor configuration
reloads. Older Hyprland versions are not automatically configured.

To remove the source installation, delete the generated launcher and desktop
entry. If Hyprland integration was installed, remove the Ghost Notes `dofile`
line from `hyprland.lua` and the generated `ghost-notes.lua`, then reload and
check `configerrors`. Configuration backups are retained.

## Capture protection: important limits

### True omission on the supported Hyprland build

The optional [capture companion](integrations/hyprland-capture/README.md) now
provides a separate capture scene that omits protected notes and shows the
content behind them, rather than painting a black rectangle. It also supplies
fullscreen-aware pinning. Build and install it on Hyprland v0.56.2:

```sh
npm run build:capture-plugin
npm run setup:linux -- --hyprland --capture-plugin
hyprctl reload
hyprctl configerrors
hyprctl ghostnotes:status -j
```

See [the November validation](https://github.com/Nandith-0777/invisible-notes/blob/feat/linux-support/validation/linux-parity-20261105/README.md) for
measured coverage. This changes supported compositor capture paths; direct
GPU/KMS and X11 capture still bypass protection. Other desktops need their own
implementation. Rebuild the companion after a compositor update.

### Without the companion

Electron's `setContentProtection` is a macOS/Windows API. Calling it on Linux is
not a portable privacy mechanism.

On supported Hyprland, `no_screen_share` requests a **black rectangle** over
notes in compositor-managed capture paths. This differs from omitting a window
entirely. The compositor property being enabled is not evidence that a specific
meeting or recording application honors it.

Direct GPU/KMS recorders capture the physical display output and can still
include notes. Other desktops, including GNOME, KDE and X11 window managers,
are not covered by the Hyprland masking rule. Test the exact sharing application
and capture mode before relying on it. The tray and About settings report this
limitation rather than claiming Linux notes are universally invisible.

## Shortcuts and recovery

App shortcuts use the same Ctrl-based defaults as Windows. Linux has a stable
installed desktop identity for portal registration. On Hyprland Lua sessions,
all four global actions are registered with the compositor and invoke the
single-instance commands `--new-note`, `--manager`, `--toggle-notes`, and
`--toggle-ghost`, so recovery does not depend on XWayland keyboard focus.
Ghost Notes must remain running in the tray. Custom shortcuts require Ctrl,
Alt, Shift, or Super plus another key; edit or record them in Settings → Shortcuts. Existing conflicting compositor bindings are not overwritten.
Changing a shortcut releases the previous registration.

Other desktops use Electron's globalShortcut integration. Native Wayland
registration can require portal consent and a matching installed desktop entry.
With runtimes that provide an asynchronous registration event, status updates
when the portal resolves. Otherwise a pending portal request is not presented as
confirmed. If a key is unavailable, use the tray or app-menu action:

```sh
ghost-notes --new-note
```

Ghost Notes watches Hyprland configuration reloads and reconnects its runtime
shortcut automatically. Registrations belong to the launching app/profile, so
an isolated test profile cannot claim or remove another profile's shortcut.
The persisted window rules continue to apply.

Linux ghost-mode toolbar recovery uses a desktop-pointer watcher because Electron
does not forward ignored mouse motion on Linux. On Hyprland it reads compositor
pointer coordinates, avoiding stale XWayland coordinates while input is ignored.

## Storage

On non-KDE Linux desktops, Ghost Notes selects `gnome-libsecret` unless an
explicit `--password-store` choice was supplied. KDE retains automatic KWallet
selection. Unlock your desktop keychain before starting the app. The
`basic_text` backend is never described as OS-backed encryption.

Settings → Storage reports whether the note store is encrypted. If no supported
keychain is available, new note stores use plaintext, as on the upstream app;
no plaintext fallback is forced into Electron. If an existing encrypted store
cannot be decrypted, startup stops and preserves the file instead of resetting
it as corrupt. JSON note writes use owner-only permissions, and encryption
write failures are reported while notes remain in memory. Exported backups and
pasted image files are not encrypted by this change.

## Build and test

```sh
npm run format:check
npm test
npm run dist:linux -- --dir --publish never
npm run dist:linux -- --publish never
```

On Arch/Omarchy build hosts, the legacy FPM helper used by electron-builder 25
needs `libcrypt.so.1` (provided by `libxcrypt-compat`) to produce a Debian package.
This is a build-tool requirement, not an app runtime requirement.

Targets: AppImage, Debian package and tar.gz. Linux packaging installs the same
desktop identity used by the application. Linux, Windows and macOS CI unit-test
jobs use Node 22 and 24. No production release is created by the commands above.

Desktop smoke test (use isolated data, never your real note store):

```sh
GHOST_NOTES_DATA_DIR=/tmp/ghost-notes-linux-test npm start -- --remote-debugging-port=9341
# In another terminal, in the same checkout:
GHOST_NOTES_DATA_DIR=/tmp/ghost-notes-linux-test node scripts/linux-smoke.mjs
```

The smoke test uses a temporary localhost debugging endpoint. Do not enable it
for normal use; stop the test instance afterward. It changes only the isolated
test profile. Results are written to `/tmp/ghost-notes-linux-validation`.

See [validation/LINUX-VALIDATION.md](https://github.com/Nandith-0777/invisible-notes/blob/feat/linux-support/validation/LINUX-VALIDATION.md) for measured
results and unverified behavior. A successful unit or API test is not treated
as proof of physical input delivery or recording privacy.

## Native Wayland override

```sh
npm start -- --ozone-platform=wayland
```

The override is preserved, but portable window placement, drag, resize, bubble
geometry and mouse-forwarding parity cannot be guaranteed on native Wayland.
XWayland is the tested default. Fullscreen stacking and multi-monitor behavior
must be verified for each compositor.

## References

- [Electron BrowserWindow: Wayland limitations and content protection](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron 43 safeStorage providers](https://github.com/electron/electron/blob/v43.6.0/docs/api/safe-storage.md)
- [Electron global shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Hyprland window rules](https://wiki.hypr.land/0.53.0/Configuring/Window-Rules/) — capture semantics; this branch's Lua syntax was additionally checked against the installed Hyprland 0.56.2 API.
