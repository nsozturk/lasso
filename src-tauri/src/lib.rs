mod commands;
mod coordinator;
mod db;
mod models;
mod ytdlp;

use crate::commands::ProgressState;
use crate::coordinator::{DownloadCoordinator, EnqueuedJob};
use crate::db::Db;
use crate::models::DownloadProgress;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

const DEFAULT_SEED_URL: &str = "https://www.youtube.com/@azelofi";

async fn seed_default_channel(db: Arc<Db>, app: tauri::AppHandle) {
    let db_clone = db.clone();
    let count = match tauri::async_runtime::spawn_blocking(move || db_clone.channel_count()).await {
        Ok(Ok(n)) => n,
        Ok(Err(e)) => {
            eprintln!("[seed] failed to count channels: {e}");
            return;
        }
        Err(e) => {
            eprintln!("[seed] join error: {e}");
            return;
        }
    };
    if count > 0 {
        return;
    }
    eprintln!("[seed] no channels found — seeding {DEFAULT_SEED_URL}");

    let db_for_settings = db.clone();
    let settings = tauri::async_runtime::spawn_blocking(move || db_for_settings.all_settings())
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or_default();

    match ytdlp::fetch_channel_with_videos(DEFAULT_SEED_URL, 25).await {
        Ok((preview, videos)) => {
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

            let now = db::now_seconds();
            let channel = models::Channel {
                id: preview.id.clone(),
                name: preview.name.clone(),
                handle: preview.handle.clone(),
                url: preview.url.clone(),
                subscriber_count: preview.subscriber_count,
                avatar_url: preview.avatar_url.clone(),
                auto_archive: true,
                skip_shorts: settings
                    .get("skip_shorts_default")
                    .map(|s| s == "1")
                    .unwrap_or(true),
                quality_pref: settings
                    .get("default_quality")
                    .cloned()
                    .unwrap_or_else(|| "1080p".into()),
                format_pref: settings
                    .get("default_format")
                    .cloned()
                    .unwrap_or_else(|| "mp4".into()),
                mode: "video".to_string(),
                save_path,
                last_synced_at: Some(now),
                created_at: now,
                video_count: videos.len() as i64,
                storage_bytes: 0,
            };

            let _ = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
                db.insert_channel(&channel)?;
                db.upsert_videos(&videos)?;
                Ok(())
            })
            .await;
            eprintln!("[seed] inserted {DEFAULT_SEED_URL}");
        }
        Err(e) => {
            eprintln!("[seed] yt-dlp failed for {DEFAULT_SEED_URL}: {e}");
        }
    }
}

/// Resolve the channel + audio overrides for a video into concrete yt-dlp args,
/// fetching from DB inside spawn_blocking.
struct ResolvedJob {
    save_path: String,
    kind: ResolvedKind,
}
enum ResolvedKind {
    Video {
        quality: String,
        format: String,
    },
    Audio {
        audio_format: String,
        audio_quality: String,
    },
}

fn resolve_job(db: &Db, job: &EnqueuedJob) -> anyhow::Result<ResolvedJob> {
    use anyhow::Context;
    let channel_id = db
        .get_video_channel(&job.video_id)?
        .context("video not found in database")?;
    let channel = db
        .get_channel(&channel_id)?
        .context("channel for video not found")?;
    let kind = if let Some(fmt) = &job.audio_format {
        let settings = db.all_settings()?;
        let q = settings
            .get("default_audio_quality")
            .cloned()
            .unwrap_or_else(|| "0".into());
        ResolvedKind::Audio {
            audio_format: fmt.clone(),
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
        ResolvedKind::Audio {
            audio_format: fmt,
            audio_quality: q,
        }
    } else {
        ResolvedKind::Video {
            quality: channel.quality_pref,
            format: channel.format_pref,
        }
    };
    Ok(ResolvedJob {
        save_path: channel.save_path,
        kind,
    })
}

async fn run_one_job(
    job: EnqueuedJob,
    db: Arc<Db>,
    progress: ProgressState,
    coordinator: DownloadCoordinator,
) {
    let video_id = job.video_id.clone();

    // Resolve channel + mode → concrete args.
    let resolved = {
        let db_for_resolve = db.clone();
        let job_for_resolve = job.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            resolve_job(&db_for_resolve, &job_for_resolve)
        })
        .await;
        match result {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                eprintln!("[worker] resolve failed for {}: {}", video_id, e);
                let _ = tauri::async_runtime::spawn_blocking({
                    let db = db.clone();
                    let id = video_id.clone();
                    move || db.update_video_status(&id, "failed", None, None)
                })
                .await;
                coordinator.complete(&video_id);
                return;
            }
            Err(e) => {
                eprintln!("[worker] join error: {}", e);
                coordinator.complete(&video_id);
                return;
            }
        }
    };

    // Mark downloading.
    {
        let db = db.clone();
        let id = video_id.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            db.update_video_status(&id, "downloading", None, None)
        })
        .await;
    }

    // Seed progress entry so UI shows 0% immediately.
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

    let save_dir = PathBuf::from(&resolved.save_path);
    let download_result = match resolved.kind {
        ResolvedKind::Video { quality, format } => {
            ytdlp::download_video(&save_dir, &video_id, &quality, &format, on_progress).await
        }
        ResolvedKind::Audio {
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

    // Pin progress at 100% on success so chip stays "↓ 100%" until the video poll
    // catches up; clear the entry after a delay regardless.
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

    // Release the slot now so the next queued job can start while we wait to clear progress.
    coordinator.complete(&video_id);

    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
    if let Ok(mut map) = progress.lock() {
        map.remove(&video_id);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("could not resolve app data dir: {e}"))?;
            let db_path = app_data.join("lasso.db");
            let db = Arc::new(Db::open(&db_path)?);

            // Seed default settings (idempotent — INSERT OR IGNORE).
            let default_save_dir = app
                .path()
                .home_dir()
                .ok()
                .map(|h| h.join("Movies").join("Lasso").to_string_lossy().to_string())
                .unwrap_or_else(|| "./Lasso".to_string());
            db.seed_default_settings(&default_save_dir)?;
            db.migrate_save_paths(|name| ytdlp::sanitize_dir_name(name))?;
            let n_reset = db.reset_stale_downloads()?;
            if n_reset > 0 {
                eprintln!(
                    "[startup] reset {} orphaned downloading/queued videos to failed",
                    n_reset
                );
            }

            app.manage(db.clone());

            let progress: ProgressState = Arc::new(Mutex::new(HashMap::<String, DownloadProgress>::new()));
            app.manage(progress.clone());

            let initial_capacity = db
                .all_settings()
                .ok()
                .and_then(|s| s.get("concurrent_downloads").cloned())
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(1);
            let coordinator = DownloadCoordinator::new(initial_capacity);
            app.manage(coordinator.clone());

            // Background worker: pulls jobs from the queue, runs each, respects capacity.
            {
                let db_for_worker = db.clone();
                let progress_for_worker = progress.clone();
                let coord_for_worker = coordinator.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        let job = coord_for_worker.next_job().await;
                        let db_inner = db_for_worker.clone();
                        let progress_inner = progress_for_worker.clone();
                        let coord_inner = coord_for_worker.clone();
                        tauri::async_runtime::spawn(async move {
                            run_one_job(job, db_inner, progress_inner, coord_inner).await;
                        });
                    }
                });
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                seed_default_channel(db, app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_channels,
            commands::list_videos,
            commands::fetch_channel_preview,
            commands::add_channel,
            commands::sync_channel,
            commands::set_auto_archive,
            commands::download_video,
            commands::download_all_pending,
            commands::get_active_downloads,
            commands::get_settings,
            commands::update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lasso");
}
