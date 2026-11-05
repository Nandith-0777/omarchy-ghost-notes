#!/usr/bin/env bash
set -euo pipefail
plugin_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
for tool in node npm sha256sum; do
  command -v "$tool" >/dev/null || { printf 'Missing dependency: %s\n' "$tool" >&2; exit 1; }
done
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Node.js 22.12 or newer is required"); process.exit(1); }'
runtime_dir=$(bash "$plugin_root/scripts/runtime-path.sh")
if [[ ${1:-} == --check ]]; then
  printf 'Runtime location: %s\n' "$runtime_dir"
  exit 0
fi
[[ $# == 0 ]] || { echo 'Usage: bash scripts/setup.sh [--check]' >&2; exit 2; }
umask 077
mkdir -p -- "$runtime_dir"
cp -- "$plugin_root/runtime/package.json" "$plugin_root/runtime/package-lock.json" "$runtime_dir/"
printf 'Installing the locked Electron runtime into %s\n' "$runtime_dir"
npm ci --ignore-scripts --prefix "$runtime_dir" --no-audit --no-fund
node "$runtime_dir/node_modules/electron/install.js"
[[ -x "$runtime_dir/node_modules/electron/dist/electron" ]] || { echo 'Electron installation is incomplete' >&2; exit 1; }
printf 'Ready. Click Ghost Notes in the Omarchy bar.\nNo desktop configuration was changed. Capture exclusion requires separate companion setup; see README.md.\n'
