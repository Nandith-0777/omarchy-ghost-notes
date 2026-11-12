-- Hyprland Lua API, tested on 0.56.2. Only note windows are affected, not the manager.
if ghost_notes_overlay_rule then
  ghost_notes_overlay_rule:set_enabled(false)
end
ghost_notes_overlay_rule = hl.window_rule({
  name = "ghost-notes-overlay",
  match = {
    class = "^(invisible-notes|com[.]invisiblenotes[.]app)$",
    initial_title = "^Ghost Notes Note$",
  },
  float = true,
  -- Pointer-driven bounds must not compete with compositor size animations.
  no_anim = true,

})

-- Current title changes when the user explicitly shares a note.
if ghost_notes_privacy_rule then
  ghost_notes_privacy_rule:set_enabled(false)
end
ghost_notes_privacy_rule = hl.window_rule({
  name = "ghost-notes-privacy",
  match = {
    class = "^(invisible-notes|com[.]invisiblenotes[.]app)$",
    initial_title = "^Ghost Notes Note$",
    title = "^Ghost Notes Note$",
  },
  no_screen_share = true,
})
if ghost_notes_sharing_rule then
  ghost_notes_sharing_rule:set_enabled(false)
end
ghost_notes_sharing_rule = hl.window_rule({
  name = "ghost-notes-sharing",
  match = {
    class = "^(invisible-notes|com[.]invisiblenotes[.]app)$",
    initial_title = "^Ghost Notes Note$",
    title = "^Ghost Notes Note — Shared$",
  },
  no_screen_share = false,
})
