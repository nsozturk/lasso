use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

#[derive(Debug, Clone)]
pub struct EnqueuedJob {
    pub video_id: String,
    pub audio_format: Option<String>,
}

struct CoordState {
    pending: VecDeque<EnqueuedJob>,
    in_flight: HashSet<String>,
    capacity: usize,
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
            })),
            notify: Arc::new(Notify::new()),
        }
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

    /// Mark a job complete: remove from in_flight and wake the worker so it can
    /// pull the next pending job.
    pub fn complete(&self, completed_video_id: &str) {
        {
            let mut state = self.inner.lock().unwrap();
            state.in_flight.remove(completed_video_id);
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
