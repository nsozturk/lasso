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
    FFMPEG_KIND="zip"
    ;;
  x86_64-apple-darwin)
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    FFMPEG_URL="https://evermeet.cx/ffmpeg/getrelease/zip"
    FFMPEG_KIND="zip"
    ;;
  x86_64-unknown-linux-gnu)
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
    # John Van Sickle's static builds are the de-facto Linux distribution.
    FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
    FFMPEG_KIND="tar.xz"
    ;;
  aarch64-unknown-linux-gnu)
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64"
    FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz"
    FFMPEG_KIND="tar.xz"
    ;;
  x86_64-pc-windows-msvc)
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    # Gyan's essentials build is the typical Windows ffmpeg distribution.
    FFMPEG_URL="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    FFMPEG_KIND="zip-windows"
    ;;
  *)
    echo "Unsupported target: $TARGET" >&2
    echo "Add it to scripts/fetch-binaries.sh and submit a PR." >&2
    exit 1
    ;;
esac

# yt-dlp: simple file download.
fetch_or_copy "yt-dlp" "$ytdlp_dst" "$YTDLP_URL" "yt-dlp"

# ffmpeg: archive format depends on platform.
if [[ ! -f "$ffmpeg_dst" ]]; then
  echo "→ Fetching ffmpeg..."
  TMP="$(mktemp -d)"
  trap "rm -rf '$TMP'" EXIT

  case "$FFMPEG_KIND" in
    zip)
      if curl -fsSL --output "$TMP/ffmpeg.zip" "$FFMPEG_URL"; then
        ( cd "$TMP" && unzip -q ffmpeg.zip )
        cp "$TMP/ffmpeg" "$ffmpeg_dst"
        chmod +x "$ffmpeg_dst"
        echo "✓ ffmpeg → $ffmpeg_dst"
      else
        echo "  download failed; falling back to PATH"
        if command -v ffmpeg >/dev/null 2>&1; then
          cp "$(command -v ffmpeg)" "$ffmpeg_dst"
          chmod +x "$ffmpeg_dst"
          echo "✓ ffmpeg copied from $(command -v ffmpeg)"
        else
          echo "✗ Could not obtain ffmpeg." >&2
          exit 1
        fi
      fi
      ;;
    tar.xz)
      if curl -fsSL --output "$TMP/ffmpeg.tar.xz" "$FFMPEG_URL"; then
        ( cd "$TMP" && tar -xf ffmpeg.tar.xz )
        # Locate the ffmpeg binary inside the extracted folder.
        ff_path="$(find "$TMP" -type f -name ffmpeg -perm -u+x | head -n 1)"
        if [[ -z "$ff_path" ]]; then
          echo "✗ ffmpeg binary not found inside archive" >&2
          exit 1
        fi
        cp "$ff_path" "$ffmpeg_dst"
        chmod +x "$ffmpeg_dst"
        echo "✓ ffmpeg → $ffmpeg_dst"
      else
        echo "✗ Could not download ffmpeg from $FFMPEG_URL" >&2
        exit 1
      fi
      ;;
    zip-windows)
      ffmpeg_dst="$BIN_DIR/ffmpeg-$TARGET.exe"
      if curl -fsSL --output "$TMP/ffmpeg.zip" "$FFMPEG_URL"; then
        ( cd "$TMP" && unzip -q ffmpeg.zip )
        ff_path="$(find "$TMP" -type f -name ffmpeg.exe | head -n 1)"
        if [[ -z "$ff_path" ]]; then
          echo "✗ ffmpeg.exe not found inside archive" >&2
          exit 1
        fi
        cp "$ff_path" "$ffmpeg_dst"
        echo "✓ ffmpeg → $ffmpeg_dst"
      else
        echo "✗ Could not download ffmpeg from $FFMPEG_URL" >&2
        exit 1
      fi
      ;;
    *)
      echo "✗ Unknown FFMPEG_KIND: $FFMPEG_KIND" >&2
      exit 1
      ;;
  esac
else
  echo "✓ ffmpeg already at $ffmpeg_dst"
fi

# yt-dlp on Windows is a .exe; rename if needed.
if [[ "$TARGET" == *-pc-windows-msvc ]] && [[ -f "$ytdlp_dst" ]] && [[ ! -f "$ytdlp_dst.exe" ]]; then
  mv "$ytdlp_dst" "$ytdlp_dst.exe"
fi

echo
ls -la "$BIN_DIR/"
echo
echo "Done. Binaries are bundled into the .app/.dmg/.exe/.AppImage by 'pnpm tauri build'."
