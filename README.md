# Ghost Notes for Omarchy

Local sticky notes with rich text, workspaces, colors, opacity, pinning, and
click-through mode, with a Ghost Notes button in the Omarchy bar. The complete
Electron app is included as source in `app/`; this is more than a launcher for
an independently installed app.

![Ghost Notes with sample notes](preview.png)

**Capture exclusion is version-specific.** The one-command installer enables
the native companion automatically on the supported build. The app/bar alone
without that companion do not make notes invisible to recording. The included native companion
supports Hyprland **0.56.2** and must match the running compositor's exact build
hash. Google Meet, Zoom, and other recorders must be tested with their actual
capture path. Direct GPU/KMS recorders can still see the notes.

## Developers

- **Main developer — [Navya Bijoy](https://github.com/navyabijoy):** creator of Ghost Notes / Invisible Notes and the original application.
- **Co-developer — [Nandith (Nandith-0777)](https://github.com/Nandith-0777):** Linux/Hyprland integration, interface updates, shortcuts, and the Omarchy plugin.

## Current version — 0.2.0

The plugin bundles the Linux source update of Ghost Notes 1.2.2. Version 0.2.0 adds the automatic installation, compatibility checks, configuration backups/rollback, login startup, and removal workflow described below. It also includes:

- Redesigned Notes Manager with workspace navigation, search, note cards, and All notes / On desktop / Hidden filters.
- Clear note toolbars, a purple ghost icon with an active state, compact Aa and appearance controls, and light/dark themes.
- Smoother dragging and resizing, including scaled XWayland pointer handling.
- Centered note/workspace deletion dialogs; workspace deletion preserves notes.
- Four global shortcuts while the app runs in the tray. Users can type or record shortcuts, review before saving, reset defaults, and see conflict feedback. Each shortcut requires Ctrl, Alt, Shift, or Super plus another key.
- A friendly empty-note prompt: “A thought, a plan, a little reminder…”.
- Linux desktop/keychain integration and an optional exact-build Hyprland 0.56.2 capture/input companion, with the limitations described above.
- Regression tests and disposable-profile checks for the manager, formatting, resizing, pointer input, capture, and shortcuts.

See the [complete Linux change summary](app/README.md#current-linux-version--5-november-2026) and [local validation](VALIDATION.md). This source update does not publish new standalone app binaries. Marketplace submission is awaiting owner review and approval.

## Requirements

- Omarchy 4 / Quattro with the Omarchy shell and XWayland.
- Node.js 22.12 or newer, npm, Bash, and the standard `sha256sum` utility.
- Electron 43.6.0, installed from the pinned `runtime/package-lock.json` during
  the explicit setup step. Setup needs network access and downloads Electron.
- Electron's ordinary Linux runtime libraries, supplied by an Omarchy desktop.
- Optional capture companion: matching Hyprland development headers, a C++26
  compiler, pkg-config, pixman, libdrm, and xcb-shape development files.

## Install — one command

On **Omarchy 4.5.0** (including package revision `4.5.0-3`) running the supported
Hyprland **0.56.2**, open a terminal and run:

```sh
omarchy plugin add https://github.com/Nandith-0777/omarchy-ghost-notes --yes && bash "$HOME/.config/omarchy/plugins/io.github.nandith-0777.ghost-notes/scripts/install.sh"
```

This is for a fresh installation. An internet connection is required. You may
be asked for your system password to install missing packages. **No manual
configuration editing or separate compilation steps are needed.** The automatic
flow passed a clean-install and reinstall trial on the maintainer's laptop.
Testing on a second machine is still recommended.

The installer:

1. Checks the Omarchy version and exact running Hyprland build against
   [compatibility.json](compatibility.json). Unsupported builds stop before
   dependency installation or desktop configuration changes.
2. Installs missing build/runtime dependencies using `omarchy pkg add` and the
   locked Electron 43.6.0 runtime outside the plugin checkout.
3. Builds the C++ capture companion against the installed matching headers.
4. Backs up affected desktop files, installs the launcher and app-menu entry,
   configures the native companion, and adds login startup for global shortcuts.
5. Reloads Hyprland, checks configuration errors and the companion status,
   enables the bar button, and opens Notes Manager.
6. If Voxtype is already installed without another post-processor, installs the
   scoped Ghost Notes dictation helper. Other dictation tools are retained.

Configuration failures restore the backed-up files and unload the new companion.
Installed system packages and downloaded runtimes are retained; the installer
never deletes a note profile. A running Ghost Notes copy from another checkout
or an unmanaged capture companion is reported instead of being taken over.

The exact supported compositor commit is
`efb50993780079460b0cbed1363e2166a2de1d9f`. Matching the Omarchy name alone is not
enough. The installer checks header compatibility too, so a pending compositor
upgrade cannot silently build the wrong plugin.

For an existing installation, run the installer again from its installed path.
It keeps a single autostart entry and retains the original configuration backup.
To check compatibility without installation, use `bash scripts/install.sh --check`.
To finish setup without opening the app immediately, use `--no-launch`.

### Notes without the native capture companion

The older manual runtime-only path remains available:

```sh
bash "$HOME/.config/omarchy/plugins/io.github.nandith-0777.ghost-notes/scripts/setup.sh"
omarchy plugin enable io.github.nandith-0777.ghost-notes --section right
```

This path does not enable capture exclusion or login startup. Loading the bar
widget alone never downloads dependencies or changes desktop configuration.
The one-command installer is a separate, explicitly invoked action.

The runtime lives under
`${XDG_DATA_HOME:-~/.local/share}/ghost-notes/omarchy-runtime/<lockfile-sha256>`.
It stays outside the plugin tree to avoid dependency symlinks in Omarchy plugin
validation.

## Use

- Click the ghost in the bar to open Notes Manager.
- Right-click it to create a note.
- Organize notes into workspaces and filter by All notes, On desktop, or Hidden.
- In Settings → Shortcuts, edit the Global shortcuts section to use your chosen
  keys from other apps. App-only shortcuts are separate optional alternatives.
  Type a combination or use Record keys,
  then save. Ctrl, Alt, Shift, and Super combinations with function keys,
  navigation keys, punctuation, and numpad keys are supported. Conflicts preserve
  the previous shortcut.
- In a floating note, use Aa for formatting and the sliders button for appearance.
- Global shortcuts while the app runs in the tray: Ctrl+Alt+Shift+N (new note),
  M (manager), H (hide/show), and G (click-through). Settings → Shortcuts shows
  conflicts and allows rebinding.
- Pin keeps a note above ordinary windows. The ghost button enables click-through;
  this is distinct from capture exclusion.

The app uses the existing Ghost Notes profile (`invisible-notes`). A previously
running Ghost Notes instance handles launches through its single-instance lock.
For isolated testing, set `GHOST_NOTES_DATA_DIR` to a disposable directory.

## Optional capture companion: expert setup

Read [the companion documentation](app/integrations/hyprland-capture/README.md)
and [Linux capture boundaries](app/LINUX.md) before enabling it. It is not a
universal Linux capture API. Do not bypass its version/hash guards.

On Hyprland 0.56.2, after reviewing the changes and closing Ghost Notes:

```sh
cd ~/.config/omarchy/plugins/io.github.nandith-0777.ghost-notes
bash app/scripts/build-capture-plugin.sh
runtime_dir=$(bash scripts/runtime-path.sh)
NODE_PATH="$runtime_dir/node_modules" node app/scripts/setup-linux.js --hyprland --capture-plugin
hyprctl reload
hyprctl configerrors
hyprctl ghostnotes:status -j
```

That **explicit** setup command creates/replaces the `ghost-notes` launcher and
desktop entry, writes `~/.config/hypr/ghost-notes.lua`, and adds its `dofile` line
to your Hyprland Lua configuration. Changed Hyprland files are backed up first.
If another Ghost Notes installation exists, preserve its launcher and desktop
entry before replacing them. Rebuild and revalidate after Hyprland updates.

The companion can affect capture of other windows carrying `no_screen_share`
and closing-animation snapshots. See its documentation for the exact boundaries.
Native pointer and capture hooks need explicit maintainer review.

## Update

```sh
omarchy plugin update io.github.nandith-0777.ghost-notes
bash ~/.config/omarchy/plugins/io.github.nandith-0777.ghost-notes/scripts/install.sh
```

The installer rebuilds the companion, restarts its own app, and checks the
configuration. It stops on unsupported compositor upgrades instead of bypassing
the version guard. For runtime-only installations, retain that setup path if
you do not want to enable the native companion.

## Remove

If you used the automatic installer, restore the pre-install desktop files first:

```sh
bash "$HOME/.config/omarchy/plugins/io.github.nandith-0777.ghost-notes/scripts/install.sh" --uninstall
omarchy plugin remove io.github.nandith-0777.ghost-notes
```

The uninstaller closes its own app, unloads the companion, restores the original
configuration, and keeps notes, runtime downloads, and shared system packages.
If a managed file has changed since installation, it stops instead of discarding
your edits; use the retained backup and the manual instructions below to remove
only the Ghost Notes integration. Do not remove the checkout before unloading
its native companion.

### Manual removal

Quit Ghost Notes first. If you never enabled the optional capture companion:

```sh
omarchy plugin remove io.github.nandith-0777.ghost-notes
```

No note database is deleted. To remove only downloaded runtimes, you may also
remove `${XDG_DATA_HOME:-~/.local/share}/ghost-notes/omarchy-runtime`; this is
separate from the `invisible-notes` profile. Keep that profile to keep your notes.

If you enabled the companion, **before removing the plugin checkout**:

1. Quit Ghost Notes so protected note windows are closed.
2. Remove only the Ghost Notes `dofile` line from `~/.config/hypr/hyprland.lua`,
   and remove `~/.config/hypr/ghost-notes.lua` if it belongs to this installation.
   Restore your pre-install backups if you had another Ghost Notes integration.
3. Unload this companion with `hyprctl plugin unload /absolute/path/to/app/dist/hyprland/ghost-notes-capture.so`.
4. Run `hyprctl reload` and `hyprctl configerrors`. Resolve errors before continuing.
5. Remove or restore `~/.local/bin/ghost-notes` and
   `~/.local/share/applications/com.invisiblenotes.app.desktop` only if they point
   into this checkout. Then remove the Omarchy plugin with the command above.

Do not delete unrelated configuration or the note profile.

## License and provenance

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The bundled application is
derived from [Navya Bijoy's Invisible Notes](https://github.com/navyabijoy/invisible-notes)
with Navya Bijoy credited as the main developer and Nandith-0777 as co-developer for Linux/Hyprland, interface changes, and the Omarchy integration. Its original
license and attribution are retained. Dependency licenses are included in the
installed runtime's packages. The screenshot contains disposable sample notes.

## Validation

```sh
omarchy plugin validate .
bash -n scripts/*.sh
bash scripts/setup.sh --check
node --test test/*.test.cjs
```

The app's Node tests are in `app/test/`. Point `NODE_PATH` at the installed
runtime's `node_modules` when running `node --test app/test/*.test.js`.

The native companion has been tested on Hyprland 0.56.2 with disposable scenes,
including scaled/rotated capture and real pointer delivery. Those checks do not
establish that every recording or meeting app excludes notes.

### Screen-sharing visibility

Use the monitor-and-arrow button on a note to show it in a screen share. The
button turns orange while sharing is enabled. Click again to request privacy.
The choice is saved per note; existing and new notes start private. The ghost
button continues to control mouse click-through only. This applies to sharing
a screen containing the note, not an unrelated application window or browser tab.
