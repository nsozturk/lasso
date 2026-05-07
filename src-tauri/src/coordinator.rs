use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;
use tokio::task::JoinHandle;

#[derive(Debug, Clone)]
pub struct EnqueuedJob {
    pub video_id: String,
    pub audio_format: Option<String>,
    pub video_quality: Option<String>,
    pub video_format: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelOutcome {
    /// Job was running; the task was aborted (yt-dlp child dies via kill_on_drop).
    AbortedRunning,
    /// Job was in the queue; removed without ever starting.
    RemovedFromQueue,
    /// Nothing to cancel — id was neither pending nor in-flight.
    NotFound,
}

struct CoordState {
    pending: VecDeque<EnqueuedJob>,
    in_flight: HashSet<String>,
    capacity: usize,
    handles: HashMap<String, JoinHandle<()>>,
}

#[derive(Clone)]
pub struct DownloadCoordinator {
    inner: Arc<Mutex<CoordState>>,
    notify: Arc<Notify>,
}

impl DownloadCoordinator {
    pub fn new(initial_capacity: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(CoordState {
                pending: VecDeque::new(),
                in_flight: HashSet::new(),
                capacity: initial_capacity.max(1),
                handles: HashMap::new(),
            })),
            notify: Arc::new(Notify::new()),
        }
    }

    /// Worker registers the spawned task handle so we can abort it on cancel.
    pub fn register_handle(&self, video_id: &str, handle: JoinHandle<()>) {
        let mut state = self.inner.lock().unwrap();
        state.handles.insert(video_id.to_string(), handle);
    }

    /// Cancel every running and queued job. Returns (running_aborted, queued_removed).
    pub fn cancel_all(&self) -> (Vec<String>, Vec<String>) {
        let mut state = self.inner.lock().unwrap();
        let aborted: Vec<String> = state.handles.keys().cloned().collect();
        for (_, h) in state.handles.drain() {
            h.abort();
        }
        state.in_flight.clear();
        let removed: Vec<String> = state.pending.drain(..).map(|j| j.video_id).collect();
        self.notify.notify_one();
        (aborted, removed)
    }

    /// Cancel a job. If running → abort the task (kill_on_drop SIGKILLs yt-dlp).
    /// If queued → remove from pending.
    pub fn cancel(&self, video_id: &str) -> CancelOutcome {
        let mut state = self.inner.lock().unwrap();
        if let Some(h) = state.handles.remove(video_id) {
            h.abort();
            // The task was aborted; explicitly remove from in_flight so a new enqueue
            // for the same video_id can proceed.
            state.in_flight.remove(video_id);
            self.notify.notify_one();
            return CancelOutcome::AbortedRunning;
        }
        if let Some(pos) = state.pending.iter().position(|j| j.video_id == video_id) {
            state.pending.remove(pos);
            return CancelOutcome::RemovedFromQueue;
        }
        CancelOutcome::NotFound
    }

    /// Returns Some(true) if newly enqueued, Some(false) if already in flight or pending.
    pub fn enqueue(&self, job: EnqueuedJob) -> bool {
        let mut state = self.inner.lock().unwrap();
        if state.in_flight.contains(&job.video_id)
            || state.pending.iter().any(|j| j.video_id == job.video_id)
        {
            return false;
        }
        state.pending.push_back(job);
        self.notify.notify_one();
        true
    }

    pub fn set_capacity(&self, capacity: usize) {
        let mut state = self.inner.lock().unwrap();
        state.capacity = capacity.max(1);
        // Notify in case the new capacity allows draining queued jobs.
        self.notify.notify_one();
    }

    /// Mark a job complete: remove from in_flight + drop the handle, then wake the
    /// worker so it can pull the next pending job.
    pub fn complete(&self, completed_video_id: &str) {
        {
            let mut state = self.inner.lock().unwrap();
            state.in_flight.remove(completed_video_id);
            state.handles.remove(completed_video_id);
        }
        self.notify.notify_one();
    }

    /// Block until a job slot is free AND a pending job exists. Atomically moves
    /// the job from `pending` to `in_flight` before returning. Caller is responsible
    /// for running the actual download and calling `complete` afterwards.
    pub async fn next_job(&self) -> EnqueuedJob {
        loop {
            {
                let mut state = self.inner.lock().unwrap();
                if state.in_flight.len() < state.capacity {
                    if let Some(job) = state.pending.pop_front() {
                        state.in_flight.insert(job.video_id.clone());
                        return job;
                    }
                }
            }
            self.notify.notified().await;
        }
    }

}
