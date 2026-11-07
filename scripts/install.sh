#!/usr/bin/env bash
set -euo pipefail
plugin_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
case ${1:-} in
  ''|--no-launch|--check|--uninstall) ;;
  *) echo 'Usage: bash scripts/install.sh [--check|--no-launch|--uninstall]' >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || exit 2
[[ $EUID != 0 ]] || { echo 'Run as your desktop user, without sudo. Package installation requests sudo itself.' >&2; exit 1; }
for command in omarchy hyprctl jq; do
  command -v "$command" >/dev/null || { echo "This installer requires an active Omarchy desktop ($command missing)." >&2; exit 1; }
done
# Reject unsupported desktops before installing dependencies or editing config.
omarchy_version=$(omarchy version)
hyprland=$(hyprctl version -j)
if [[ ${1:-} != --uninstall ]]; then
  jq -e --arg version "${omarchy_version%%-*}" '.omarchyVersions | index($version) != null' "$plugin_root/compatibility.json" >/dev/null || {
    echo "Unsupported Omarchy version: $omarchy_version. See compatibility.json." >&2; exit 1;
  }
  expected_commit=$(jq -r .hyprlandCommit "$plugin_root/compatibility.json")
  expected_version=$(jq -r .hyprlandVersion "$plugin_root/compatibility.json")
  [[ $(jq -r .commit <<< "$hyprland") == "$expected_commit" && $(jq -r .version <<< "$hyprland") == "$expected_version" ]] || {
    echo 'Unsupported Hyprland build. No packages or desktop configuration were changed.' >&2; exit 1;
  }
fi
if [[ ${1:-} != --check && ${1:-} != --uninstall ]]; then
  echo 'Installing missing build/runtime dependencies (sudo may request your password).'
  packages=(gcc pkgconf pixman libdrm libxcb xorg-xwayland libsecret gnome-keyring python libxtst wl-clipboard)
  # Omarchy may already supply a suitable Node runtime through mise.
  if ! command -v node >/dev/null || ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major < 22 || (major === 22 && minor < 12) ? 1 : 0)'; then
    packages+=(nodejs npm)
  elif ! command -v npm >/dev/null; then
    packages+=(npm)
  fi
  omarchy pkg add "${packages[@]}"
fi
command -v node >/dev/null || { echo 'Node.js is required to run the configuration transaction.' >&2; exit 1; }
exec node "$plugin_root/scripts/install-omarchy.cjs" "$@"
