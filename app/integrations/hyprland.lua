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
  no_screen_share = true,
})
