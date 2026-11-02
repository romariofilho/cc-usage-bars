#!/bin/bash
# Installs the extension (symlink, so edits in the repo apply after reloading the shell)
# and creates ~/.config/cc-usage-bars/config.json from the example if it doesn't exist.
set -e
uuid=cc-usage-bars@romariofilho.github.io
here=$(cd "$(dirname "$0")" && pwd)
dest=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions
mkdir -p "$dest"
ln -sfn "$here/$uuid" "$dest/$uuid"

cfg=${XDG_CONFIG_HOME:-$HOME/.config}/cc-usage-bars/config.json
if [ ! -f "$cfg" ]; then
  mkdir -p "$(dirname "$cfg")"
  cp "$here/config.example.json" "$cfg"
  chmod 600 "$cfg"
  echo "Created $cfg — put your Home Assistant URL and long-lived token in it."
fi

gnome-extensions enable "$uuid" 2>/dev/null || true
echo "Installed. On Wayland, log out and back in once so GNOME Shell discovers the extension,"
echo "then run: gnome-extensions enable $uuid"
