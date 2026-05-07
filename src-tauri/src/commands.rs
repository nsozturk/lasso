use crate::coordinator::{CancelOutcome, DownloadCoordinator, EnqueuedJob};
use crate::db::{now_seconds, Db};
use crate::models::{Channel, ChannelPreview, DownloadProgress, FetchProgress, Video};
use crate::ytdlp;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub type DbState = Arc<Db>;
pub type ProgressState = Arc<Mutex<HashMap<String, DownloadProgress>>>;
pub type FetchState = Arc<Mutex<HashMap<String, FetchProgress>>>;
pub type CoordinatorState = DownloadCoordinator;

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

/// Add a channel. Returns immediately with the channel's metadata + the first
/// video (so the UI has something to show right away). The remaining
/// `initial_video_count - 1` entries are streamed in the background and inserted
/// into the DB one-by-one. Frontend can poll `list_videos` to see them appear,
/// and `get_fetch_progress` to size skeleton placeholders.
#[tauri::command]
pub async fn add_channel(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    fetch_state: State<'_, FetchState>,
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

    // Quick metadata pass: channel info + the first video (or empty for max=0).
    let bootstrap_count = if max == 0 { 0 } else { 1 };
    let (preview, initial_videos) = ytdlp::fetch_channel_with_videos(&url, bootstrap_count)
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
        video_count: initial_videos.len() as i64,
        storage_bytes: 0,
    };

    let db_clone = db.inner().clone();
    let channel_clone = channel.clone();
    let initial_clone = initial_videos.clone();
    tauri::async_runtime::spawn_blocking(move || {
        db_clone.insert_channel(&channel_clone)?;
        db_clone.upsert_videos(&initial_clone)?;
        anyhow::Ok(())
    })
    .await
    .map_err(err)?
    .map_err(err)?;

    // If the user asked for more, stream the rest in the background. We start at
    // `bootstrap_count + 1` to skip the video we already inserted.
    if max > bootstrap_count {
        let fetch_state_clone = fetch_state.inner().clone();
        let db_for_stream = db.inner().clone();
        let channel_id = channel.id.clone();
        let channel_url = channel.url.clone();

        // Seed fetch progress so UI can render skeletons.
        {
            let mut map = fetch_state_clone.lock().unwrap();
            map.insert(
                channel_id.clone(),
                FetchProgress {
                    channel_id: channel_id.clone(),
                    fetched: initial_videos.len() as i64,
                    expected: max as i64,
                },
            );
        }

        let start = bootstrap_count + 1;
        let end = max;
        tauri::async_runtime::spawn(async move {
            let fetch_state_for_cb = fetch_state_clone.clone();
            let db_for_cb = db_for_stream.clone();
            let channel_id_for_cb = channel_id.clone();

            let on_video = move |video: Video| {
                let cid = channel_id_for_cb.clone();
                let videos = vec![video];
                // Insert immediately (sync, fast).
                if let Err(e) = db_for_cb.upsert_videos(&videos) {
                    eprintln!("[stream] upsert failed for {}: {}", cid, e);
                    return;
                }
                let mut map = match fetch_state_for_cb.lock() {
                    Ok(m) => m,
                    Err(_) => return,
                };
                if let Some(fp) = map.get_mut(&cid) {
                    fp.fetched += 1;
                }
            };

            let result =
                ytdlp::stream_channel_videos(&channel_url, &channel_id, start, end, on_video).await;
            if let Err(e) = result {
                eprintln!("[stream] failed for {}: {}", channel_id, e);
            } else {
                eprintln!("[stream] finished for {}", channel_id);
            }
            // Drop entry — UI will see fetched == expected (or just gone).
            if let Ok(mut map) = fetch_state_clone.lock() {
                map.remove(&channel_id);
            }
        });
    }

    let db_clone = db.inner().clone();
    let id = channel.id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || db_clone.get_channel(&id))
        .await
        .map_err(err)?
        .map_err(err)?;
    result.ok_or_else(|| "channel not found after insert".to_string())
}

#[tauri::command]
pub async fn get_fetch_progress(
    fetch_state: State<'_, FetchState>,
) -> Result<Vec<FetchProgress>, String> {
    let map = fetch_state.inner().lock().map_err(err)?;
    Ok(map.values().cloned().collect())
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

/// Enqueue a single video for download. Returns immediately. The actual yt-dlp run
/// happens in the background worker, respecting the `concurrent_downloads` setting.
///
/// `audio_format` overrides the channel's mode — when set, the video is extracted
/// as audio in the requested format. When unset, the channel's `mode` field decides
/// (`audio` → extract audio using global defaults; `video` → normal video download).
#[tauri::command]
pub async fn download_video(
    db: State<'_, DbState>,
    coordinator: State<'_, CoordinatorState>,
    video_id: String,
    audio_format: Option<String>,
) -> Result<(), String> {
    let db = db.inner().clone();
    let coord = coordinator.inner().clone();

    {
        let db = db.clone();
        let id = video_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            db.update_video_status(&id, "queued", None, None)
        })
        .await
        .map_err(err)?
        .map_err(err)?;
    }

    coord.enqueue(EnqueuedJob {
        video_id,
        audio_format,
        video_quality: None,
        video_format: None,
    });
    Ok(())
}

/// Enqueue every video in the channel whose status is `pending` or `failed`.
/// Optional overrides apply to every queued video:
/// - `audio_format` — extract audio in this format (mutually exclusive with video options).
/// - `quality` / `format` — video quality + container override (when no audio_format).
/// Returns the number of newly-queued videos.
#[tauri::command]
pub async fn download_all_pending(
    db: State<'_, DbState>,
    coordinator: State<'_, CoordinatorState>,
    channel_id: String,
    audio_format: Option<String>,
    quality: Option<String>,
    format: Option<String>,
) -> Result<i64, String> {
    let db = db.inner().clone();
    let coord = coordinator.inner().clone();

    let video_ids: Vec<String> = {
        let db = db.clone();
        let cid = channel_id.clone();
        tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Vec<String>> {
            let videos = db.list_videos_for_channel(&cid)?;
            Ok(videos
                .into_iter()
                .filter(|v| v.status == "pending" || v.status == "failed")
                .map(|v| v.id)
                .collect())
        })
        .await
        .map_err(err)?
        .map_err(err)?
    };

    let mut enqueued = 0i64;
    for id in &video_ids {
        let db_for_status = db.clone();
        let id_clone = id.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            db_for_status.update_video_status(&id_clone, "queued", None, None)
        })
        .await;
        if coord.enqueue(EnqueuedJob {
            video_id: id.clone(),
            audio_format: audio_format.clone(),
            video_quality: quality.clone(),
            video_format: format.clone(),
        }) {
            enqueued += 1;
        }
    }
    Ok(enqueued)
}

/// Cancel a running or queued download. If running, aborts the spawned task and
/// kills the yt-dlp child (via kill_on_drop). If queued, removes from the queue.
/// Status is reset to `failed` so the user can retry. Progress entry is cleared.
#[tauri::command]
pub async fn cancel_download(
    db: State<'_, DbState>,
    progress: State<'_, ProgressState>,
    coordinator: State<'_, CoordinatorState>,
    video_id: String,
) -> Result<String, String> {
    let outcome = coordinator.inner().cancel(&video_id);

    if outcome != CancelOutcome::NotFound {
        let new_status = match outcome {
            CancelOutcome::AbortedRunning => "failed",
            CancelOutcome::RemovedFromQueue => "pending",
            CancelOutcome::NotFound => unreachable!(),
        };
        let db = db.inner().clone();
        let id_clone = video_id.clone();
        let status_clone = new_status.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            db.update_video_status(&id_clone, &status_clone, None, None)
        })
        .await
        .map_err(err)?
        .map_err(err)?;

        if let Ok(mut map) = progress.inner().lock() {
            map.remove(&video_id);
        }
    }

    Ok(match outcome {
        CancelOutcome::AbortedRunning => "aborted_running",
        CancelOutcome::RemovedFromQueue => "removed_from_queue",
        CancelOutcome::NotFound => "not_found",
    }
    .to_string())
}

/// Cancel every running and queued download. Running tasks are aborted (yt-dlp
/// children die via kill_on_drop). Queued entries are removed. DB statuses are
/// reset so the user can retry from the same UI ('failed' for aborted, 'pending'
/// for queue-only entries).
#[tauri::command]
pub async fn cancel_all_downloads(
    db: State<'_, DbState>,
    progress: State<'_, ProgressState>,
    coordinator: State<'_, CoordinatorState>,
) -> Result<i64, String> {
    let (aborted, removed) = coordinator.inner().cancel_all();

    let total = aborted.len() + removed.len();
    if total == 0 {
        return Ok(0);
    }

    let db = db.inner().clone();
    let aborted_clone = aborted.clone();
    let removed_clone = removed.clone();
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
        for id in &aborted_clone {
            db.update_video_status(id, "failed", None, None)?;
        }
        for id in &removed_clone {
            db.update_video_status(id, "pending", None, None)?;
        }
        Ok(())
    })
    .await
    .map_err(err)?
    .map_err(err)?;

    if let Ok(mut map) = progress.inner().lock() {
        for id in &aborted {
            map.remove(id);
        }
    }

    Ok(total as i64)
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
    coordinator: State<'_, CoordinatorState>,
    patch: HashMap<String, String>,
) -> Result<(), String> {
    let db = db.inner().clone();
    let coord = coordinator.inner().clone();

    if let Some(c) = patch.get("concurrent_downloads") {
        if let Ok(n) = c.parse::<usize>() {
            coord.set_capacity(n);
        }
    }

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
