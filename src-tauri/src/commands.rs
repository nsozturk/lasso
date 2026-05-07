use crate::db::{now_seconds, Db};
use crate::models::{Channel, ChannelPreview, DownloadProgress, Video};
use crate::ytdlp;
use anyhow::Context;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub type DbState = Arc<Db>;
pub type ProgressState = Arc<Mutex<HashMap<String, DownloadProgress>>>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn list_channels(db: State<'_, DbState>) -> Result<Vec<Channel>, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || db.list_channels())
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
pub async fn list_videos(
    db: State<'_, DbState>,
    channel_id: String,
) -> Result<Vec<Video>, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || db.list_videos_for_channel(&channel_id))
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
pub async fn fetch_channel_preview(url: String) -> Result<ChannelPreview, String> {
    ytdlp::fetch_channel_with_videos(&url, 0)
        .await
        .map(|(preview, _)| preview)
        .map_err(err)
}

#[tauri::command]
pub async fn add_channel(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    url: String,
    initial_video_count: Option<u32>,
    quality: Option<String>,
    format: Option<String>,
    skip_shorts: Option<bool>,
    mode: Option<String>,
) -> Result<Channel, String> {
    let db_clone = db.inner().clone();
    let settings = tauri::async_runtime::spawn_blocking(move || db_clone.all_settings())
        .await
        .map_err(err)?
        .map_err(err)?;

    let max = initial_video_count.unwrap_or_else(|| {
        settings
            .get("default_backlog")
            .and_then(|s| s.parse().ok())
            .unwrap_or(25)
    });
    let quality_pref = quality.unwrap_or_else(|| {
        settings
            .get("default_quality")
            .cloned()
            .unwrap_or_else(|| "1080p".into())
    });
    let format_pref = format.unwrap_or_else(|| {
        settings
            .get("default_format")
            .cloned()
            .unwrap_or_else(|| "mp4".into())
    });
    let skip_shorts_pref = skip_shorts.unwrap_or_else(|| {
        settings
            .get("skip_shorts_default")
            .map(|s| s == "1" || s == "true")
            .unwrap_or(true)
    });

    let (preview, videos) = ytdlp::fetch_channel_with_videos(&url, max)
        .await
        .map_err(err)?;

    let base_dir = settings
        .get("default_save_dir")
        .cloned()
        .or_else(|| {
            app.path()
                .home_dir()
                .ok()
                .map(|h| h.join("Movies").join("Lasso").to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "./Lasso".to_string());
    let save_path = PathBuf::from(&base_dir)
        .join(ytdlp::sanitize_dir_name(&preview.name))
        .to_string_lossy()
        .to_string();

    let mode_pref = mode
        .map(|m| if m == "audio" { "audio" } else { "video" }.to_string())
        .unwrap_or_else(|| "video".to_string());

    let channel = Channel {
        id: preview.id.clone(),
        name: preview.name.clone(),
        handle: preview.handle.clone(),
        url: preview.url.clone(),
        subscriber_count: preview.subscriber_count,
        avatar_url: preview.avatar_url.clone(),
        auto_archive: true,
        skip_shorts: skip_shorts_pref,
        quality_pref,
        format_pref,
        mode: mode_pref,
        save_path,
        last_synced_at: Some(now_seconds()),
        created_at: now_seconds(),
        video_count: videos.len() as i64,
        storage_bytes: 0,
    };

    let db_clone = db.inner().clone();
    let channel_clone = channel.clone();
    let videos_clone = videos.clone();
    tauri::async_runtime::spawn_blocking(move || {
        db_clone.insert_channel(&channel_clone)?;
        db_clone.upsert_videos(&videos_clone)?;
        anyhow::Ok(())
    })
    .await
    .map_err(err)?
    .map_err(err)?;

    let db_clone = db.inner().clone();
    let id = channel.id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || db_clone.get_channel(&id))
        .await
        .map_err(err)?
        .map_err(err)?;
    result.ok_or_else(|| "channel not found after insert".to_string())
}

#[tauri::command]
pub async fn sync_channel(
    db: State<'_, DbState>,
    channel_id: String,
    max_videos: Option<u32>,
) -> Result<i64, String> {
    let max = max_videos.unwrap_or(25);
    let db_clone = db.inner().clone();
    let id_clone = channel_id.clone();
    let channel = tauri::async_runtime::spawn_blocking(move || db_clone.get_channel(&id_clone))
        .await
        .map_err(err)?
        .map_err(err)?
        .ok_or_else(|| "channel not found".to_string())?;

    let (_, videos) = ytdlp::fetch_channel_with_videos(&channel.url, max)
        .await
        .map_err(err)?;

    let db_clone = db.inner().clone();
    let id_clone = channel_id.clone();
    let inserted = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<usize> {
        let n = db_clone.upsert_videos(&videos)?;
        db_clone.set_last_synced(&id_clone)?;
        Ok(n)
    })
    .await
    .map_err(err)?
    .map_err(err)?;

    Ok(inserted as i64)
}

/// Fire-and-forget: marks the video as `downloading`, returns immediately,
/// then runs yt-dlp in the background, streaming progress into the shared map,
/// and updates final status to `downloaded`/`failed` on completion.
///
/// `audio_format` overrides the channel's mode — when set, the video is extracted
/// as audio in the requested format (mp3 / m4a / flac / opus / wav / ogg / aac).
/// When unset, the channel's `mode` field decides: `audio` → extract audio using the
/// global `default_audio_format` setting; `video` → normal video download.
#[tauri::command]
pub async fn download_video(
    db: State<'_, DbState>,
    progress: State<'_, ProgressState>,
    video_id: String,
    audio_format: Option<String>,
) -> Result<(), String> {
    let db: Arc<Db> = db.inner().clone();
    let progress: ProgressState = progress.inner().clone();

    #[derive(Clone)]
    struct ResolvedJob {
        save_path: String,
        kind: JobKind,
    }
    #[derive(Clone)]
    enum JobKind {
        Video {
            quality: String,
            format: String,
        },
        Audio {
            audio_format: String,
            audio_quality: String,
        },
    }

    let job: ResolvedJob = {
        let db = db.clone();
        let id = video_id.clone();
        let override_audio = audio_format.clone();
        tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<ResolvedJob> {
            let channel_id = db
                .get_video_channel(&id)?
                .context("video not found in database")?;
            let channel = db
                .get_channel(&channel_id)?
                .context("channel for video not found")?;

            let kind = if let Some(fmt) = override_audio {
                let settings = db.all_settings()?;
                let q = settings
                    .get("default_audio_quality")
                    .cloned()
                    .unwrap_or_else(|| "0".into());
                JobKind::Audio {
                    audio_format: fmt,
                    audio_quality: q,
                }
            } else if channel.mode == "audio" {
                let settings = db.all_settings()?;
                let fmt = settings
                    .get("default_audio_format")
                    .cloned()
                    .unwrap_or_else(|| "mp3".into());
                let q = settings
                    .get("default_audio_quality")
                    .cloned()
                    .unwrap_or_else(|| "0".into());
                JobKind::Audio {
                    audio_format: fmt,
                    audio_quality: q,
                }
            } else {
                JobKind::Video {
                    quality: channel.quality_pref.clone(),
                    format: channel.format_pref.clone(),
                }
            };

            Ok(ResolvedJob {
                save_path: channel.save_path,
                kind,
            })
        })
        .await
        .map_err(err)?
        .map_err(err)?
    };

    {
        let db = db.clone();
        let id = video_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            db.update_video_status(&id, "downloading", None, None)
        })
        .await
        .map_err(err)?
        .map_err(err)?;
    }

    // Seed an entry so the UI immediately shows 0%
    {
        let mut map = progress.lock().unwrap();
        map.insert(
            video_id.clone(),
            DownloadProgress {
                video_id: video_id.clone(),
                percent: 0.0,
                downloaded_bytes: 0,
                total_bytes: 0,
                speed_bps: None,
                eta_seconds: None,
            },
        );
    }

    let progress_for_cb = progress.clone();
    let video_id_for_cb = video_id.clone();
    let on_progress = move |dp: DownloadProgress| {
        if let Ok(mut map) = progress_for_cb.lock() {
            map.insert(video_id_for_cb.clone(), dp);
        }
    };

    tauri::async_runtime::spawn(async move {
        let save_dir = PathBuf::from(&job.save_path);
        let download_result = match job.kind {
            JobKind::Video { quality, format } => {
                ytdlp::download_video(&save_dir, &video_id, &quality, &format, on_progress).await
            }
            JobKind::Audio {
                audio_format,
                audio_quality,
            } => {
                ytdlp::download_audio(
                    &save_dir,
                    &video_id,
                    &audio_format,
                    &audio_quality,
                    on_progress,
                )
                .await
            }
        };

        let (status, file_path, file_size) = match &download_result {
            Ok((path, size)) => {
                let p = path.to_string_lossy().to_string();
                eprintln!("[download] {} → {} ({} bytes)", video_id, p, size);
                ("downloaded", Some(p), Some(*size))
            }
            Err(e) => {
                eprintln!("[download] failed for {}: {}", video_id, e);
                ("failed", None, None)
            }
        };

        // Update DB FIRST so the frontend video poll picks up the new status quickly.
        let video_id_for_db = video_id.clone();
        let db_for_update = db.clone();
        let file_path_for_db = file_path.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
            db_for_update.update_video_status(
                &video_id_for_db,
                status,
                file_path_for_db.as_deref(),
                file_size,
            )?;
            Ok(())
        })
        .await;

        // On success, pin progress entry at 100% so chip stays at "↓ 100%" until the
        // video status poll catches up. Then drop it after a short delay.
        if status == "downloaded" {
            if let Ok(mut map) = progress.lock() {
                if let Some(dp) = map.get_mut(&video_id) {
                    dp.percent = 100.0;
                    if let Some(size) = file_size {
                        dp.downloaded_bytes = size;
                        dp.total_bytes = size;
                    }
                    dp.speed_bps = None;
                    dp.eta_seconds = Some(0);
                }
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        if let Ok(mut map) = progress.lock() {
            map.remove(&video_id);
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn get_active_downloads(
    progress: State<'_, ProgressState>,
) -> Result<Vec<DownloadProgress>, String> {
    let map = progress.inner().lock().map_err(err)?;
    Ok(map.values().cloned().collect())
}

#[tauri::command]
pub async fn get_settings(db: State<'_, DbState>) -> Result<HashMap<String, String>, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || db.all_settings())
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
pub async fn update_settings(
    db: State<'_, DbState>,
    patch: HashMap<String, String>,
) -> Result<(), String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || db.update_settings(&patch))
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
pub async fn set_auto_archive(
    db: State<'_, DbState>,
    channel_id: String,
    enabled: bool,
) -> Result<(), String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || db.set_auto_archive(&channel_id, enabled))
        .await
        .map_err(err)?
        .map_err(err)
}
