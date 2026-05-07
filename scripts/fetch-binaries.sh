#!/usr/bin/env bash
# Fetch yt-dlp + ffmpeg into src-tauri/binaries/ so Tauri can bundle them as
# sidecars. Names follow Tauri's convention: <name>-<rust-target-triple>.
#
# Strategy: try official downloads first; fall back to copying from PATH if
# the user already has them via brew/apt. Run this once after `git clone`.
#
# Required: rustc, curl, unzip (or xz on Linux).

set -euo pipefail

TARGET="$(rustc -vV | awk '/^host:/ {print $2}')"
if [[ -z "$TARGET" ]]; then
  echo "Could not detect rust target triple. Install rustup." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$REPO_ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"

ytdlp_dst="$BIN_DIR/yt-dlp-$TARGET"
ffmpeg_dst="$BIN_DIR/ffmpeg-$TARGET"

fetch_or_copy() {
  local name="$1" dst="$2" url="$3" path_lookup="$4"
  if [[ -f "$dst" ]]; then
    echo "✓ $name already at $dst"
    return
  fi
  echo "→ Fetching $name ..."
  if curl -fsSL --output "$dst" "$url"; then
    chmod +x "$dst"
    echo "✓ $name → $dst"
    return
  fi
  echo "  download failed, trying PATH lookup..."
  if local existing="$(command -v "$path_lookup" 2>/dev/null)"; [[ -n "$existing" ]]; then
    cp "$existing" "$dst"
    chmod +x "$dst"
    echo "✓ $name copied from $existing"
    return
  fi
  echo "✗ Could not obtain $name. Install it first (brew install $path_lookup)" >&2
  exit 1
}

case "$TARGET" in
  aarch64-apple-darwin)
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    # evermeet.cx serves universal/arm64 macOS ffmpeg builds.
    FFMPEG_URL="https://evermeet.cx/ffmpeg/getrelease/zip"
    ;;
  x86_64-apple-darwin)
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    FFMPEG_URL="https://evermeet.cx/ffmpeg/getrelease/zip"
    ;;
  x86_64-unknown-linux-gnu)
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
    FFMPEG_URL=""  # static builds at https://johnvansickle.com/ffmpeg/
    ;;
  x86_64-pc-windows-msvc)
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    FFMPEG_URL=""
    ;;
  *)
    echo "Unsupported target: $TARGET" >&2
    exit 1
    ;;
esac

# yt-dlp: simple file download.
fetch_or_copy "yt-dlp" "$ytdlp_dst" "$YTDLP_URL" "yt-dlp"

# ffmpeg: zip on macOS, copy from PATH otherwise.
if [[ "$TARGET" == *-apple-darwin ]]; then
  if [[ ! -f "$ffmpeg_dst" ]]; then
    echo "→ Fetching ffmpeg..."
    TMP="$(mktemp -d)"
    trap "rm -rf '$TMP'" EXIT
    if curl -fsSL --output "$TMP/ffmpeg.zip" "$FFMPEG_URL"; then
      ( cd "$TMP" && unzip -q ffmpeg.zip )
      cp "$TMP/ffmpeg" "$ffmpeg_dst"
      chmod +x "$ffmpeg_dst"
      echo "✓ ffmpeg → $ffmpeg_dst"
    elif command -v ffmpeg >/dev/null 2>&1; then
      cp "$(command -v ffmpeg)" "$ffmpeg_dst"
      chmod +x "$ffmpeg_dst"
      echo "✓ ffmpeg copied from $(command -v ffmpeg)"
    else
      echo "✗ Could not obtain ffmpeg. Install with: brew install ffmpeg" >&2
      exit 1
    fi
  else
    echo "✓ ffmpeg already at $ffmpeg_dst"
  fi
else
  if [[ ! -f "$ffmpeg_dst" ]]; then
    if command -v ffmpeg >/dev/null 2>&1; then
      cp "$(command -v ffmpeg)" "$ffmpeg_dst"
      chmod +x "$ffmpeg_dst"
      echo "✓ ffmpeg copied from $(command -v ffmpeg)"
    else
      echo "✗ ffmpeg not on PATH. Install with your package manager." >&2
      exit 1
    fi
  else
    echo "✓ ffmpeg already at $ffmpeg_dst"
  fi
fi

echo
ls -la "$BIN_DIR/"
echo
echo "Done. Binaries are bundled into the .app/.dmg by 'pnpm tauri build'."
