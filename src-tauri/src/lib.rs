mod commands;
mod db;
mod models;
mod ytdlp;

use crate::commands::ProgressState;
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
            app.manage(progress);

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
            commands::get_active_downloads,
            commands::get_settings,
            commands::update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lasso");
}
