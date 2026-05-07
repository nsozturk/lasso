use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub handle: Option<String>,
    pub url: String,
    pub subscriber_count: Option<i64>,
    pub avatar_url: Option<String>,
    pub auto_archive: bool,
    pub skip_shorts: bool,
    pub quality_pref: String,
    pub format_pref: String,
    pub save_path: String,
    pub last_synced_at: Option<i64>,
    pub created_at: i64,
    pub video_count: i64,
    pub storage_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub video_id: String,
    pub percent: f64,
    pub downloaded_bytes: i64,
    pub total_bytes: i64,
    pub speed_bps: Option<f64>,
    pub eta_seconds: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: String,
    pub channel_id: String,
    pub title: String,
    pub duration_seconds: Option<i64>,
    pub upload_date: Option<String>,
    pub view_count: Option<i64>,
    pub thumbnail_url: Option<String>,
    pub is_short: bool,
    pub status: String,
    pub file_path: Option<String>,
    pub file_size_bytes: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPreview {
    pub id: String,
    pub name: String,
    pub handle: Option<String>,
    pub url: String,
    pub subscriber_count: Option<i64>,
    pub avatar_url: Option<String>,
}
