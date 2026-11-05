# Portable Linux capture design

The product target is cross-desktop Linux support. Hyprland integration is one
optional backend, not the product architecture or evidence of universal support.

## Define the requirement first

There are two different requirements:

1. Keep an overlay visible on the host desktop while the user chooses ordinary
   **entire-screen sharing** in an arbitrary meeting/recording app.
2. Keep private notes visible while the user shares a **clean Ghost Notes
   workspace window** containing the public work.

The first requires cooperation from the host compositor/capture implementation.
It cannot be guaranteed by the Electron app on every Linux setup. The second
can avoid reliance on host window-exclusion support by keeping public and
private surfaces separate, but changes the sharing workflow and needs a defined,
tested Linux runtime baseline. It is not a way to sanitize arbitrary host-screen
capture after the fact.

No implementation of the second mode has been built or validated yet. Its
acceptability is a product decision; it must not silently replace the first.

## Architecture

### Portable controlled-sharing workspace

Own the public scene before private notes are composited on top. Public
applications run inside an isolated/nested graphical workspace exported as one
ordinary application window. Notes remain separate host windows and never enter
the public workspace's backing surface. Meet/Zoom users explicitly select that
workspace window as their share target.

The important constraint is that public work must actually run inside the
workspace. Mirroring the already-composited host desktop and erasing note-shaped
rectangles cannot reconstruct content that was covered by the notes. Hiding
notes momentarily to take frames introduces races and is not an acceptable
privacy mechanism.

Prototype a nested Wayland compositor with XWayland for public applications,
and an X11-hosted path where available. Package runtime dependencies; document
supported architectures, library requirements, software-rendering fallback and
resource limits. Test whether each meeting app's window capture uses the public
surface rather than an output crop. If that cannot be established, do not mark
the selected capture workflow protected. A virtual-camera route is an optional
future alternative with installation and meeting-app limitations, not a
universally available fallback.

### Optional native desktop adapters

For users who require ordinary entire-screen sharing, maintain independent
adapters with explicit version and capture-path coverage:

| Backend                                         | Current evidence                                                                                              | Engineering implication                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| KDE/KWin                                        | Current official Window API exposes `excludeFromCapture`; Plasma 6.6 changelog includes screencast exclusions | Investigate native support before introducing a renderer plugin; no Ghost Notes KDE implementation or test exists yet |
| Hyprland                                        | Existing companion is validated on exact v0.56.2 build for the recorded paths                                 | Retain as an optional version-bound adapter                                                                           |
| niri                                            | Official screencasting documentation describes `block-out-from` as black-rectangle masking                    | Do not label masking as full omission or universal protection                                                         |
| GNOME/Mutter                                    | No Ghost Notes integration has been implemented or validated                                                  | Research supported extension/compositor hooks and test actual capture, including thumbnails and overview              |
| Other Wayland compositors / X11 window managers | No shared exclusion API established by this work                                                              | No universal native-privacy claim; add adapters only with evidence                                                    |

Expose a backend contract rather than a single Linux boolean:

```text
availability: available | unavailable | unknown
effect: omit | mask | none
coverage: compositor-monitor | compositor-window | controlled-workspace
version constraints
installation requirements
measured capture consumers / transports
unverified or bypassing paths
```

Backend detection must use capabilities as well as desktop/session identifiers.
An installed adapter or enabled window property does not prove a particular
meeting app's capture is protected. Unverified states must remain unverified.

## Validation and release gate

Cover GNOME, KDE, representative wlroots/compositor sessions and X11 using clean
VMs or dedicated test sessions, not only the developer's desktop. Test source
and packaged startup, ordinary note behavior, positioning, bubbles, click-through
recovery, fullscreen and mixed-DPI monitors separately from capture privacy.

For each claimed protected workflow, use a known public scene behind notes, an
unprotected control proving the notes are visible, and received/recorded output
proving the public content remains intact without private pixels. Inspect the
remote participant's result in Meet and Zoom. Include opening, closing, dragging,
resizing, overlapping notes, thumbnails, blur, display changes and capture start
and stop. Synthetic property assertions alone do not satisfy this gate.

Do not advertise "every Linux setup" without a minimum supported runtime and
precisely stated sharing workflow. Ordinary host-desktop capture that bypasses
an adapter remains outside its guarantee.

## Primary references checked 5 November 2026

- [Electron BrowserWindow content protection](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows): the API is documented for macOS/Windows.
- [XDG ScreenCast portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html): monitor/window/virtual sources and PipeWire streams; no generic requesting-app window-exclusion option is specified.
- [KWin Window API](https://api.kde.org/qml-org-kde-kwin-window.html): `excludeFromCapture`.
- [Plasma 6.6 changelog](https://kde.org/announcements/changelogs/plasma/6/6.5.5-6.6.0/): native screencast exclusion additions.
- [niri screencasting](https://github.com/niri-wm/niri/wiki/Screencasting): capture paths and black-rectangle blocking semantics.
