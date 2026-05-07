# Lasso — agent rules

## Update README.md after every commit, if needed

If a commit changes user-facing surface — features added/removed/changed,
install or run instructions, dependencies, supported platforms, screenshots,
license, or roadmap items — update `README.md` in the same commit. Skip the
update for pure internal refactors, styling, or bug fixes that do not change
user-visible behaviour.

## Build / dev

- `cd src-tauri && cargo build` — backend
- `pnpm build` — frontend (tsc + vite)
- `pnpm tauri dev` — full dev loop with hot reload (Rust + TS)

## Runtime dependencies

`yt-dlp` and `ffmpeg` must be on PATH. macOS:

```sh
brew install yt-dlp ffmpeg
```

## Default seed channel

On first launch, if the channel list is empty, Lasso seeds
`https://www.youtube.com/@azelofi`. Useful for end-to-end smoke tests.

## Database

SQLite at `~/Library/Application Support/dev.youlasso.app/lasso.db` on macOS.
Schema migrates additively on `Db::open` (additive `ALTER TABLE` calls that
fail-silently when the column already exists).

## Commit style

- Short imperative title (under 70 characters)
- Body explains the *why* if non-obvious
- Co-author footer is fine

## Push policy

- Default branch: `main`
- No force-push to `main`
- Risky or large refactors → open a PR first

## Test before reporting done

For UI changes, run `pnpm tauri dev` and exercise the change in the actual
WebView. Type-checks (`tsc`) and `cargo build` verify code correctness, not
behaviour — confirm the feature visibly works before claiming completion.
