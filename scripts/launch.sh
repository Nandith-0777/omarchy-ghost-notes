#!/usr/bin/env bash
set -euo pipefail
plugin_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
case ${1:-manager} in
  manager) action=--manager ;;
  new) action=--new-note ;;
  *) echo 'Usage: bash scripts/launch.sh [manager|new]' >&2; exit 2 ;;
esac
runtime_dir=$(bash "$plugin_root/scripts/runtime-path.sh")
electron="$runtime_dir/node_modules/electron/dist/electron"
if [[ ! -x "$electron" ]]; then
  message="Run: bash \"$plugin_root/scripts/setup.sh\". Installation instructions are in README.md."
  printf 'Ghost Notes needs setup. %s\n' "$message" >&2
  if command -v notify-send >/dev/null; then
    notify-send 'Ghost Notes needs setup' "$message" || true
  fi
  exit 1
fi
exec env -u ELECTRON_RUN_AS_NODE "$electron" "$plugin_root/app" --ozone-platform=x11 --class=com.invisiblenotes.app "$action"
