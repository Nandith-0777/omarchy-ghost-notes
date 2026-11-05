#!/usr/bin/env bash
set -euo pipefail
plugin_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
runtime_hash=$(sha256sum "$plugin_root/runtime/package-lock.json")
printf '%s/ghost-notes/omarchy-runtime/%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}" "${runtime_hash%% *}"
