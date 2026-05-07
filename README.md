# Lasso

> Subscribe to a YouTube channel — Lasso archives every video to your disk.

Lasso is a local-first desktop app that subscribes to YouTube channels and
auto-downloads new uploads as they appear. It targets the gap between
server-tier tools (TubeArchivist, Pinchflat) that need Docker, and one-off
downloaders (Parabolic, Tartube) that don't really do "subscribe and watch".

**Status:** early alpha. macOS-only build. Works end-to-end on the author's
machine — channel add → live progress → file on disk. Not packaged into a
.dmg yet; run from source.

## Features today

- Add a channel by URL (`youtube.com/@name`) — Lasso fetches metadata and
  the latest 25 videos.
- One-click download with **live percentage + progress bar** per video card.
- Per-channel quality preference: 1080p / 720p / Best, MP4 / WebM / MKV.
- "Sync now" button refreshes a channel's recent uploads.
- Search (live filter), filter pills (All / Saved / New), Skip Shorts toggle,
  minimum-duration filter.
- Settings sheet: default save folder, default quality / format, default
  backlog size, Skip Shorts default, concurrent download count.
- Auto-archive toggle per channel (sidebar + channel header).
- Apple-vari light theme. macOS native title bar (overlay traffic lights).

## Coming soon

- Audio extraction — MP3 / M4A / FLAC / OPUS / WAV / OGG / AAC, with a
  separate Audio Settings sheet and per-video kebab menu override.
- Per-channel mode (`video` vs `audio`) for music channels.
- "Download all" button + actual concurrent-download queue that respects the
  setting.
- Bundled `yt-dlp` sidecar (no PATH dependency).
- Background scheduler (auto-sync every N minutes / hours).
- Linux + Windows builds.
- Pause / resume / cancel.

## Run from source

Requirements: macOS 13+, Node 20+, [pnpm](https://pnpm.io), Rust toolchain
(`rustup`), and `yt-dlp` + `ffmpeg` on PATH.

```sh
brew install yt-dlp ffmpeg pnpm rustup-init
rustup-init -y && source "$HOME/.cargo/env"

git clone https://github.com/nsozturk/lasso.git
cd lasso
pnpm install
pnpm tauri dev
```

First run seeds a default channel (`@azelofi`) so you have something to play
with immediately. Files land in `~/Movies/Lasso/<Channel-Name>/`.

## Stack

| Layer       | Tech                                           |
|-------------|------------------------------------------------|
| Shell       | [Tauri 2](https://tauri.app) (Rust)            |
| UI          | React 19 + Vite + TypeScript, hand-rolled CSS  |
| Storage     | SQLite (`rusqlite` with bundled feature)       |
| Downloader  | `yt-dlp` subprocess + `ffmpeg` for merge       |
| State       | `Arc<Mutex<HashMap>>` for in-flight progress   |

## Architecture

A thin Rust shell (Tauri 2) hosts a React WebView. The Rust side owns the
SQLite database and a shared progress map. Each download spawns a `yt-dlp`
child process whose stdout is parsed line-by-line via a custom
`--progress-template`; parsed updates land in the shared map. The frontend
polls the map every second while any download is in-flight and re-renders
percentages and progress bars. Channel folder names are sanitised
(spaces → `-`) to keep filesystem paths shell-safe. Schema migrations are
additive `ALTER TABLE` calls that fail-silently when the column already
exists.

## Legal note

YouTube's Terms of Service prohibit downloading content. This software is
intended for the end user's **personal backup / archival** of channels they
have a legitimate reason to preserve. Distributing copyrighted material
without permission is illegal. The user assumes all responsibility. The
maintainers are aware this puts the project at DMCA risk and are okay with
that.

## License

MIT — see [LICENSE](./LICENSE).
