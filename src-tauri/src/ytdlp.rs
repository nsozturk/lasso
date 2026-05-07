use crate::models::{ChannelPreview, DownloadProgress, Video};
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Resolve a bundled sidecar binary by name. Tauri 2 copies sidecars to:
/// - dev: `target/<profile>/<name>-<target>`
/// - bundled (.app): `<app>/Contents/Resources/_up_/binaries/<name>-<target>` and
///   sometimes alongside the main exe.
/// We probe both locations and fall back to the bin name on PATH.
fn resolve_sidecar(name: &str) -> PathBuf {
    let target = option_env!("TARGET").unwrap_or("");

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Same directory as the running exe (covers `cargo run` dev + bundled exe).
            if !target.is_empty() {
                candidates.push(dir.join(format!("{}-{}", name, target)));
            }
            candidates.push(dir.join(name));

            // macOS .app/Contents/MacOS/<exe> → Resources sibling.
            if let Some(contents) = dir.parent() {
                candidates.push(contents.join("Resources").join(name));
                if !target.is_empty() {
                    candidates
                        .push(contents.join("Resources").join(format!("{}-{}", name, target)));
                }
            }
        }
    }
    // Dev fallback: src-tauri/binaries/<name>-<target> relative to cwd.
    if !target.is_empty() {
        candidates.push(PathBuf::from(format!("src-tauri/binaries/{}-{}", name, target)));
    }

    for c in &candidates {
        if c.exists() {
            return c.clone();
        }
    }

    // Last resort: assume it's on PATH.
    PathBuf::from(name)
}

fn ytdlp_path() -> &'static PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        let p = resolve_sidecar("yt-dlp");
        eprintln!("[lasso] yt-dlp resolved to: {}", p.display());
        p
    })
}

fn ffmpeg_path() -> &'static PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        let p = resolve_sidecar("ffmpeg");
        eprintln!("[lasso] ffmpeg resolved to: {}", p.display());
        p
    })
}

/// Canonicalize a user-provided channel URL to the /videos endpoint.
fn videos_url(input: &str) -> String {
    let trimmed = input.trim().trim_end_matches('/');
    for suffix in &[
        "/videos", "/shorts", "/streams", "/playlists", "/community", "/about", "/featured",
    ] {
        if let Some(stripped) = trimmed.strip_suffix(suffix) {
            return format!("{}/videos", stripped);
        }
    }
    format!("{}/videos", trimmed)
}

pub fn canonical_channel_url(input: &str) -> String {
    let trimmed = input.trim().trim_end_matches('/');
    for suffix in &[
        "/videos", "/shorts", "/streams", "/playlists", "/community", "/about", "/featured",
    ] {
        if let Some(stripped) = trimmed.strip_suffix(suffix) {
            return stripped.to_string();
        }
    }
    trimmed.to_string()
}

/// Convert a channel display name into a filesystem-safe directory name.
/// Spaces and other shell-unfriendly characters become `-`. Consecutive replacements
/// collapse to a single `-`. Leading/trailing dashes are trimmed.
pub fn sanitize_dir_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_was_dash = false;
    for c in name.chars() {
        let replaced = match c {
            ' ' | '\t' | '\n' | '\r' => '-',
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c => c,
        };
        if replaced == '-' {
            if !last_was_dash {
                out.push('-');
                last_was_dash = true;
            }
        } else {
            out.push(replaced);
            last_was_dash = false;
        }
    }
    out.trim_matches('-').to_string()
}

async fn run_ytdlp(args: &[&str]) -> Result<String> {
    let output = Command::new(ytdlp_path())
        .args(args)
        .output()
        .await
        .context("failed to spawn yt-dlp")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("yt-dlp exited {}: {}", output.status, stderr));
    }
    String::from_utf8(output.stdout).context("yt-dlp output was not valid UTF-8")
}

/// Fetch channel metadata + a flat list of recent videos in one pass.
/// `max_videos == 0` means "From now on" — fetch only channel metadata, return
/// an empty videos list. yt-dlp rejects `--playlist-end 0`, so we fetch one
/// video for the metadata pass and discard it.
pub async fn fetch_channel_with_videos(
    channel_url: &str,
    max_videos: u32,
) -> Result<(ChannelPreview, Vec<Video>)> {
    let url = videos_url(channel_url);
    let metadata_only = max_videos == 0;
    let effective_max = if metadata_only { 1 } else { max_videos };
    let limit = effective_max.to_string();
    let stdout = run_ytdlp(&[
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-end",
        &limit,
        "--no-warnings",
        &url,
    ])
    .await?;
    let v: Value = serde_json::from_str(&stdout).context("yt-dlp returned invalid JSON")?;

    let channel_id = v["channel_id"]
        .as_str()
        .ok_or_else(|| anyhow!("missing channel_id in yt-dlp output"))?
        .to_string();
    let name = v["channel"]
        .as_str()
        .or_else(|| v["uploader"].as_str())
        .or_else(|| v["title"].as_str())
        .ok_or_else(|| anyhow!("missing channel name"))?
        .to_string();
    let handle = v["uploader_id"].as_str().map(|s| s.to_string());
    let canonical_url = v["channel_url"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| canonical_channel_url(channel_url));
    let subscriber_count = v["channel_follower_count"].as_i64();
    let avatar_url = v["thumbnails"]
        .as_array()
        .and_then(|arr| arr.last())
        .and_then(|t| t["url"].as_str())
        .map(|s| s.to_string());

    let preview = ChannelPreview {
        id: channel_id.clone(),
        name,
        handle,
        url: canonical_url,
        subscriber_count,
        avatar_url,
    };

    let now = crate::db::now_seconds();
    let videos: Vec<Video> = if metadata_only {
        Vec::new()
    } else {
        v["entries"]
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|e| {
                    let id = e["id"].as_str()?.to_string();
                    let title = e["title"].as_str().unwrap_or("(untitled)").to_string();
                    let duration_seconds = e["duration"]
                        .as_f64()
                        .map(|d| d as i64)
                        .or_else(|| e["duration"].as_i64());
                    let thumbnail_url = e["thumbnails"]
                        .as_array()
                        .and_then(|arr| arr.last())
                        .and_then(|t| t["url"].as_str())
                        .map(|s| s.to_string());
                    let is_short = duration_seconds.map(|s| s > 0 && s < 60).unwrap_or(false);
                    Some(Video {
                        id,
                        channel_id: channel_id.clone(),
                        title,
                        duration_seconds,
                        upload_date: None,
                        view_count: e["view_count"].as_i64(),
                        thumbnail_url,
                        is_short,
                        status: "pending".to_string(),
                        file_path: None,
                        file_size_bytes: None,
                        created_at: now,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
    };

    Ok((preview, videos))
}

fn format_arg_for(quality: &str) -> &'static str {
    match quality {
        "720p" => "bestvideo[height<=720]+bestaudio/best[height<=720]",
        "Best" | "best" | "Best available" => "bestvideo+bestaudio/best",
        _ => "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
    }
}

fn merge_format_for(format: &str) -> &'static str {
    match format.to_lowercase().as_str() {
        "webm" => "webm",
        "mkv" => "mkv",
        _ => "mp4",
    }
}

/// Parse a single yt-dlp progress line emitted by our --progress-template.
/// Format: `download:<_percent_str>|<downloaded_bytes>|<total_bytes>|<speed>|<eta>`
/// Any field can be "NA" if unknown.
fn parse_progress_line(line: &str, video_id: &str) -> Option<DownloadProgress> {
    let body = line.strip_prefix("download:")?;
    let parts: Vec<&str> = body.split('|').collect();
    if parts.len() < 5 {
        return None;
    }

    let percent_str = parts[0].trim().trim_end_matches('%');
    let percent: f64 = percent_str.parse().ok().unwrap_or(0.0);

    let downloaded_bytes: i64 = parts[1].trim().parse().unwrap_or(0);
    let total_bytes: i64 = parts[2].trim().parse().unwrap_or(0);
    let speed_bps: Option<f64> = parts[3].trim().parse().ok();
    let eta_seconds: Option<i64> = parts[4].trim().parse().ok();

    let computed_percent = if percent > 0.0 {
        percent
    } else if total_bytes > 0 {
        (downloaded_bytes as f64 / total_bytes as f64) * 100.0
    } else {
        0.0
    };

    Some(DownloadProgress {
        video_id: video_id.to_string(),
        percent: computed_percent,
        downloaded_bytes,
        total_bytes,
        speed_bps,
        eta_seconds,
    })
}

const PROGRESS_TEMPLATE: &str =
    "download:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s";

async fn run_ytdlp_with_progress<F>(
    args: &[&str],
    video_id: &str,
    on_progress: F,
) -> Result<()>
where
    F: Fn(DownloadProgress) + Send + 'static,
{
    let mut child = Command::new(ytdlp_path())
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("failed to spawn yt-dlp for download")?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("could not capture yt-dlp stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("could not capture yt-dlp stderr"))?;

    let video_id_owned = video_id.to_string();
    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(dp) = parse_progress_line(&line, &video_id_owned) {
                on_progress(dp);
            }
        }
    });

    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut buf = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            buf.push_str(&line);
            buf.push('\n');
        }
        buf
    });

    let status = child.wait().await.context("yt-dlp wait failed")?;
    let _ = stdout_handle.await;
    let stderr_buf = stderr_handle.await.unwrap_or_default();

    if !status.success() {
        return Err(anyhow!("yt-dlp download failed: {}", stderr_buf.trim()));
    }
    Ok(())
}

/// Download a single video to `save_dir`. Streams progress via callback.
/// Returns the final file path and size in bytes.
pub async fn download_video<F>(
    save_dir: &Path,
    video_id: &str,
    quality: &str,
    format: &str,
    on_progress: F,
) -> Result<(PathBuf, i64)>
where
    F: Fn(DownloadProgress) + Send + 'static,
{
    std::fs::create_dir_all(save_dir).context("failed to create save directory")?;
    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    let template = save_dir.join(format!("{}.%(ext)s", video_id));
    let template_str = template
        .to_str()
        .ok_or_else(|| anyhow!("save path contains non-UTF8 characters"))?;

    let f_arg = format_arg_for(quality);
    let merge_arg = merge_format_for(format);
    let ffmpeg = ffmpeg_path();
    let ffmpeg_str = ffmpeg.to_str().unwrap_or("ffmpeg");

    let args = [
        "-f",
        f_arg,
        "--merge-output-format",
        merge_arg,
        "--ffmpeg-location",
        ffmpeg_str,
        "-o",
        template_str,
        "--no-warnings",
        "--no-playlist",
        "--newline",
        "--progress-template",
        PROGRESS_TEMPLATE,
        &url,
    ];

    run_ytdlp_with_progress(&args, video_id, on_progress).await?;

    for ext in [merge_arg, "mp4", "webm", "mkv", "m4a", "mp3"] {
        let path = save_dir.join(format!("{}.{}", video_id, ext));
        if path.exists() {
            let metadata = std::fs::metadata(&path)?;
            return Ok((path, metadata.len() as i64));
        }
    }
    Err(anyhow!(
        "yt-dlp finished but downloaded file not found in {}",
        save_dir.display()
    ))
}

/// Map a UI-facing audio format name to (yt-dlp `--audio-format` value, file extension).
fn audio_format_args(audio_format: &str) -> (&'static str, &'static str) {
    match audio_format.to_lowercase().as_str() {
        "flac" => ("flac", "flac"),
        "wav" => ("wav", "wav"),
        "opus" => ("opus", "opus"),
        "ogg" | "vorbis" => ("vorbis", "ogg"),
        "m4a" => ("m4a", "m4a"),
        "aac" => ("aac", "aac"),
        "alac" => ("alac", "m4a"),
        _ => ("mp3", "mp3"),
    }
}

/// Download audio-only and convert to the requested format. `audio_quality` is yt-dlp's
/// 0–10 scale (0 = best) for lossy codecs; ignored for FLAC / WAV / ALAC (lossless).
pub async fn download_audio<F>(
    save_dir: &Path,
    video_id: &str,
    audio_format: &str,
    audio_quality: &str,
    on_progress: F,
) -> Result<(PathBuf, i64)>
where
    F: Fn(DownloadProgress) + Send + 'static,
{
    std::fs::create_dir_all(save_dir).context("failed to create save directory")?;
    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    let template = save_dir.join(format!("{}.%(ext)s", video_id));
    let template_str = template
        .to_str()
        .ok_or_else(|| anyhow!("save path contains non-UTF8 characters"))?;

    let (yt_format, ext) = audio_format_args(audio_format);
    let ffmpeg = ffmpeg_path();
    let ffmpeg_str = ffmpeg.to_str().unwrap_or("ffmpeg");

    let args = [
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        yt_format,
        "--audio-quality",
        audio_quality,
        "--ffmpeg-location",
        ffmpeg_str,
        "-o",
        template_str,
        "--no-warnings",
        "--no-playlist",
        "--newline",
        "--progress-template",
        PROGRESS_TEMPLATE,
        &url,
    ];

    run_ytdlp_with_progress(&args, video_id, on_progress).await?;

    let path = save_dir.join(format!("{}.{}", video_id, ext));
    if path.exists() {
        let metadata = std::fs::metadata(&path)?;
        return Ok((path, metadata.len() as i64));
    }
    for fallback in ["mp3", "m4a", "flac", "wav", "opus", "ogg", "aac"] {
        let path = save_dir.join(format!("{}.{}", video_id, fallback));
        if path.exists() {
            let metadata = std::fs::metadata(&path)?;
            return Ok((path, metadata.len() as i64));
        }
    }
    Err(anyhow!(
        "yt-dlp finished but audio file not found in {}",
        save_dir.display()
    ))
}
