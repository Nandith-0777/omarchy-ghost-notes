#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist/hyprland
plugin_output="dist/hyprland/.ghost-notes-capture-$$.so"
trap 'rm -f "$plugin_output"' EXIT HUP INT TERM
${CXX:-c++} -std=c++26 -O2 -g -shared -fPIC -fno-gnu-unique \
  $(pkg-config --cflags hyprland pixman-1 libdrm xcb-shape) \
  integrations/hyprland-capture/main.cpp \
  -o "$plugin_output" $(pkg-config --libs xcb-shape)
mv "$plugin_output" dist/hyprland/ghost-notes-capture.so
printf 'Built %s/dist/hyprland/ghost-notes-capture.so\n' "$PWD"
