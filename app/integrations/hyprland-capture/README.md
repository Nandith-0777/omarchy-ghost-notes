# Hyprland capture companion

This plugin renders a separate desktop scene for compositor-managed monitor and
region captures, omitting windows and layers with `no_screen_share`. The physical
display still renders those surfaces normally. Unlike the stock rule, the
capture shows the actual content behind a note, without a black rectangle.

It also maps Electron note pinning to compositor pinning, so pinned notes stay
above focused fullscreen applications. Unpinning restores ordinary stacking.
Compositor pinning makes pinned notes visible across Hyprland workspaces;
Ghost Notes workspaces still control which notes are shown.

## Build and install

Supported compositor: **Hyprland v0.56.2**, built against the installed headers
with the matching compiler and libraries. Build requirements: C++26 compiler,
pkg-config, Hyprland development headers and their dependencies. The plugin
rejects a different compositor hash; rebuild after compositor updates. Other
versions require a source review, not removal of the compile-time guard.

```sh
npm run build:capture-plugin
npm run setup:linux -- --hyprland --capture-plugin
hyprctl reload
hyprctl configerrors
hyprctl ghostnotes:status -j
```

Setup backs up changed configuration and adds `hl.plugin.load(...)` to the
generated user-local Ghost Notes integration. It references this checkout's
`dist/hyprland/ghost-notes-capture.so`. Keep the checkout in place. The plugin
stays loaded independently of the app, covering notes in packaged builds too.
No compositor restart is needed. Rebuild uses atomic replacement of the binary.

To remove the companion while retaining ordinary floating/masked notes, rerun
`npm run setup:linux -- --hyprland`, then reload and check config errors. Restart
Ghost Notes after changing the integration. Notes and their database are not
changed by installation or removal.

The status command reports `compositor-omit`, a capture frame count and the
compositor build hash. App runtime status distinguishes this mode from the stock
`compositor-mask` fallback. A loaded plugin alone is not proof that a particular
recording application uses compositor capture.

## Capture boundaries

- Covers capture requests routed through Hyprland's screenshare frame renderer,
  including monitor and region captures. Direct capture of a protected window
  remains denied by the compositor's existing window-share check.
- Direct GPU/KMS and X11/window-texture capture bypass this integration. External
  cameras/capture hardware see the physical display as usual.
- GNOME, KDE, other compositors, meeting applications, DMA-BUF transport and HDR
  require separate validation. This plugin is not a universal Linux capture API.
- Protected layers are also omitted. Closing-animation snapshots lack privacy
  metadata, so all fadeout snapshots are omitted from capture frames. Other
  windows remain visible; their closing animation may disappear immediately.
- Capture uses live blur of the clean scene and skips the physical scene's
  cached blur to prevent protected pixels from leaking through translucent apps.
  The physical display's blur cache is preserved.
- Re-rendering the capture scene adds GPU work. No performance claim is made
  for high-resolution, high-refresh or multi-stream recording.

## Reproduce validation in an isolated compositor

Never run the control tests on a desktop containing private notes: they
temporarily disable protection for disposable test notes. Launch a nested
Hyprland with a disposable Lua config containing the ordinary Ghost Notes rule,
then create a headless output named `GN-TEST`. Put one disposable Ghost Notes
window and `scripts/fixtures/capture-background.cjs` on that output. Run the app
with `GHOST_NOTES_DATA_DIR=/tmp/...`, debug port 9342; run the background fixture
with debug port 9343. Set `WAYLAND_DISPLAY`, `DISPLAY` and
`HYPRLAND_INSTANCE_SIGNATURE` to the **nested** compositor's values.

```sh
hyprctl plugin load "$PWD/dist/hyprland/ghost-notes-capture.so"
GHOST_NOTES_CAPTURE_OUTPUT=GN-TEST \
GHOST_NOTES_TEST_OUTPUT=/tmp/ghost-notes-capture-check \
node scripts/validate-capture-plugin.mjs
```

The test requires a visible unprotected control, compares protected captures
pixel-for-pixel against the scene with the note moved away, tests cropped
capture, and restores the note and its protection in a `finally` block. It also
checks that the companion rendered capture frames. Keep the note fully within
the output when changing output rotation or scale.

For real pointer delivery, download the official
[wlr virtual-pointer protocol](https://gitlab.freedesktop.org/wlroots/wlr-protocols/-/blob/master/unstable/wlr-virtual-pointer-unstable-v1.xml)
to a temporary directory. Generate `virtual-pointer.h` with `wayland-scanner
client-header`, and `virtual-pointer.c` with `wayland-scanner private-code`.
Compile those with `scripts/fixtures/virtual-pointer.c` and the
`pkg-config --cflags --libs wayland-client` flags. Then run:

```sh
GHOST_NOTES_DATA_DIR=/tmp/disposable-profile \
GHOST_NOTES_TEST_POINTER=/tmp/path/to/compiled-pointer \
node scripts/validate-ghost-pointer.mjs
```

This sends virtual-pointer motion/buttons through the compositor. It verifies
click delivery to the underlying application, toolbar input recovery, and
clicking Ghost to exit the mode. It does not substitute DOM clicks for pointer
delivery. The initial mode is enabled through the isolated renderer test API.
