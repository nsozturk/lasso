use crate::models::{Channel, Video};
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Db {
    pub conn: Mutex<Connection>,
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS channels (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                handle TEXT,
                url TEXT NOT NULL,
                subscriber_count INTEGER,
                avatar_url TEXT,
                auto_archive INTEGER NOT NULL DEFAULT 1,
                skip_shorts INTEGER NOT NULL DEFAULT 1,
                quality_pref TEXT NOT NULL DEFAULT '1080p',
                format_pref TEXT NOT NULL DEFAULT 'mp4',
                mode TEXT NOT NULL DEFAULT 'video',
                save_path TEXT NOT NULL,
                last_synced_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS videos (
                id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                duration_seconds INTEGER,
                upload_date TEXT,
                view_count INTEGER,
                thumbnail_url TEXT,
                is_short INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                file_path TEXT,
                file_size_bytes INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
            CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;

        // Migration: add format_pref to channels if missing (existing DBs).
        let _ = conn.execute(
            "ALTER TABLE channels ADD COLUMN format_pref TEXT NOT NULL DEFAULT 'mp4'",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE channels ADD COLUMN mode TEXT NOT NULL DEFAULT 'video'",
            [],
        );

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Insert default settings rows if not present. Called from lib.rs setup.
    pub fn seed_default_settings(&self, default_save_dir: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let defaults: &[(&str, &str)] = &[
            ("default_save_dir", default_save_dir),
            ("default_quality", "1080p"),
            ("default_format", "mp4"),
            ("default_backlog", "25"),
            ("skip_shorts_default", "1"),
            ("concurrent_downloads", "1"),
            ("default_audio_format", "mp3"),
            ("default_audio_quality", "0"),
        ];
        for (k, v) in defaults {
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
                params![k, v],
            )?;
        }
        Ok(())
    }

    pub fn all_settings(&self) -> Result<HashMap<String, String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut map = HashMap::new();
        for r in rows {
            let (k, v) = r?;
            map.insert(k, v);
        }
        Ok(map)
    }

    /// Mark any videos still in "downloading" or "queued" state as "failed" — they
    /// belong to a previous app session that was killed mid-download. The user can
    /// click Download to retry from the UI.
    pub fn reset_stale_downloads(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE videos SET status = 'failed' WHERE status IN ('downloading', 'queued')",
            [],
        )?;
        Ok(n)
    }

    /// Sanitize each existing channel's save_path using the provided function.
    /// If the last path segment changes, rename the directory on disk (if present)
    /// and update the DB row. Existing target dirs are left alone — failed renames
    /// are logged and skipped.
    pub fn migrate_save_paths<F: Fn(&str) -> String>(&self, sanitize: F) -> Result<()> {
        let rows: Vec<(String, String)> = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare("SELECT id, save_path FROM channels")?;
            let mapped = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            mapped.collect::<Result<Vec<_>, _>>()?
        };

        for (id, save_path) in rows {
            let path = std::path::Path::new(&save_path);
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let sanitized = sanitize(name);
            if sanitized.is_empty() || sanitized == name {
                continue;
            }
            let new_path = path.with_file_name(&sanitized);
            let new_path_str = new_path.to_string_lossy().to_string();

            if path.exists() {
                if new_path.exists() {
                    eprintln!(
                        "[migrate] target {} already exists, leaving channel {} unchanged",
                        new_path_str, id
                    );
                    continue;
                }
                if let Err(e) = std::fs::rename(path, &new_path) {
                    eprintln!(
                        "[migrate] failed to rename {} → {}: {}",
                        save_path, new_path_str, e
                    );
                    continue;
                }
            }

            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE channels SET save_path = ?1 WHERE id = ?2",
                params![&new_path_str, &id],
            )?;
            // Rewrite any video file paths that pointed inside the renamed folder.
            let old_prefix = format!("{}/", save_path);
            let new_prefix = format!("{}/", new_path_str);
            conn.execute(
                "UPDATE videos SET file_path = ?1 || SUBSTR(file_path, LENGTH(?2) + 1)
                 WHERE channel_id = ?3 AND file_path LIKE ?4",
                params![&new_prefix, &old_prefix, &id, format!("{}%", old_prefix)],
            )?;
            eprintln!(
                "[migrate] save_path: channel {} {} → {}",
                id, save_path, new_path_str
            );
        }
        Ok(())
    }

    pub fn update_settings(&self, patch: &HashMap<String, String>) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )?;
            for (k, v) in patch {
                stmt.execute(params![k, v])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn insert_channel(&self, c: &Channel) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"INSERT INTO channels
              (id, name, handle, url, subscriber_count, avatar_url,
               auto_archive, skip_shorts, quality_pref, format_pref, mode, save_path,
               last_synced_at, created_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"#,
            params![
                c.id,
                c.name,
                c.handle,
                c.url,
                c.subscriber_count,
                c.avatar_url,
                c.auto_archive as i64,
                c.skip_shorts as i64,
                c.quality_pref,
                c.format_pref,
                c.mode,
                c.save_path,
                c.last_synced_at,
                c.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_channels(&self) -> Result<Vec<Channel>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT
                c.id, c.name, c.handle, c.url, c.subscriber_count, c.avatar_url,
                c.auto_archive, c.skip_shorts, c.quality_pref, c.format_pref, c.mode, c.save_path,
                c.last_synced_at, c.created_at,
                (SELECT COUNT(*) FROM videos v WHERE v.channel_id = c.id) AS video_count,
                COALESCE((SELECT SUM(file_size_bytes) FROM videos v WHERE v.channel_id = c.id), 0) AS storage_bytes
              FROM channels c
              ORDER BY c.created_at ASC"#,
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Channel {
                id: r.get(0)?,
                name: r.get(1)?,
                handle: r.get(2)?,
                url: r.get(3)?,
                subscriber_count: r.get(4)?,
                avatar_url: r.get(5)?,
                auto_archive: r.get::<_, i64>(6)? != 0,
                skip_shorts: r.get::<_, i64>(7)? != 0,
                quality_pref: r.get(8)?,
                format_pref: r.get(9)?,
                mode: r.get(10)?,
                save_path: r.get(11)?,
                last_synced_at: r.get(12)?,
                created_at: r.get(13)?,
                video_count: r.get(14)?,
                storage_bytes: r.get(15)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_channel(&self, id: &str) -> Result<Option<Channel>> {
        let channels = self.list_channels()?;
        Ok(channels.into_iter().find(|c| c.id == id))
    }

    pub fn channel_count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM channels", [], |r| r.get(0))?;
        Ok(n)
    }

    pub fn set_auto_archive(&self, channel_id: &str, on: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE channels SET auto_archive = ?1 WHERE id = ?2",
            params![on as i64, channel_id],
        )?;
        Ok(())
    }

    pub fn set_last_synced(&self, channel_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE channels SET last_synced_at = ?1 WHERE id = ?2",
            params![now_ts(), channel_id],
        )?;
        Ok(())
    }

    pub fn upsert_videos(&self, videos: &[Video]) -> Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut inserted = 0;
        {
            let mut stmt = tx.prepare(
                r#"INSERT OR IGNORE INTO videos
                  (id, channel_id, title, duration_seconds, upload_date, view_count,
                   thumbnail_url, is_short, status, file_path, file_size_bytes, created_at)
                  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"#,
            )?;
            for v in videos {
                let n = stmt.execute(params![
                    v.id,
                    v.channel_id,
                    v.title,
                    v.duration_seconds,
                    v.upload_date,
                    v.view_count,
                    v.thumbnail_url,
                    v.is_short as i64,
                    v.status,
                    v.file_path,
                    v.file_size_bytes,
                    v.created_at,
                ])?;
                inserted += n;
            }
        }
        tx.commit()?;
        Ok(inserted)
    }

    pub fn get_video_channel(&self, video_id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let result = conn
            .query_row(
                "SELECT channel_id FROM videos WHERE id = ?1",
                params![video_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        Ok(result)
    }

    pub fn update_video_status(
        &self,
        video_id: &str,
        status: &str,
        file_path: Option<&str>,
        file_size_bytes: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE videos SET status = ?1, file_path = ?2, file_size_bytes = ?3 WHERE id = ?4",
            params![status, file_path, file_size_bytes, video_id],
        )?;
        Ok(())
    }

    pub fn list_videos_for_channel(&self, channel_id: &str) -> Result<Vec<Video>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, channel_id, title, duration_seconds, upload_date, view_count,
                      thumbnail_url, is_short, status, file_path, file_size_bytes, created_at
              FROM videos
              WHERE channel_id = ?1
              ORDER BY created_at DESC, id DESC"#,
        )?;
        let rows = stmt.query_map(params![channel_id], |r| {
            Ok(Video {
                id: r.get(0)?,
                channel_id: r.get(1)?,
                title: r.get(2)?,
                duration_seconds: r.get(3)?,
                upload_date: r.get(4)?,
                view_count: r.get(5)?,
                thumbnail_url: r.get(6)?,
                is_short: r.get::<_, i64>(7)? != 0,
                status: r.get(8)?,
                file_path: r.get(9)?,
                file_size_bytes: r.get(10)?,
                created_at: r.get(11)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

pub fn now_seconds() -> i64 {
    now_ts()
}
