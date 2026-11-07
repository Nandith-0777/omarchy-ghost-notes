# Proposed marketplace submission

Title: **[Plugin]: Ghost Notes**

Target: https://github.com/omacom/omarchy-plugin-marketplace

The owner must confirm the checklist and approve this completed submission
before the issue is created, as required by the marketplace submission guide.

---

### Repository URL

https://github.com/Nandith-0777/omarchy-ghost-notes

### Category

Productivity

### Tags

bar, hyprland, workspaces

### Suggest a missing tag

_No response_

### Maintainer notes

Ghost Notes includes the full Electron application source and a Quattro bar
widget. Left-click opens Notes Manager; right-click creates a note. Please mark
this listing as manual-setup: users explicitly run scripts/install.sh after adding the repository. This
installs missing dependencies, the locked Electron 43.6.0 runtime outside the
plugin tree, and the matching native companion; config changes are backed up. Loading the widget
performs no installation or desktop configuration changes.

The optional native capture companion uses Hyprland internal APIs, pointer
input handling, and X11 input shapes. It supports Hyprland 0.56.2 only and rejects
an exact-build hash mismatch. The explicit installer enables it only on the supported build. It requires
manual maintainer review; the plugin does not promise universal recording exclusion.
Direct GPU/KMS capture bypasses it. Actual Meet and Zoom capture paths require
user validation. Dependencies, capture limits, configuration changes, and safe
removal are documented in README.md. The original Apache-2.0 license and
attribution are retained; the preview contains disposable sample notes.

### Submission checklist

- [ ] The repository is public and contains installation and removal instructions.
- [ ] I have documented the plugin license and any external dependencies.
- [ ] I confirm that I own or have permission to submit this plugin and its preview assets.
- [ ] The plugin does not overwrite user configuration without explicit consent.
- [ ] I understand that approval is for listing and is not a security review.
