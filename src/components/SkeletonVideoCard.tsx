/// Placeholder card shown while a channel's videos are still streaming in
/// from yt-dlp. Same dimensions as VideoCard so the list doesn't shift.
export function SkeletonVideoCard() {
  return (
    <li className="video-card skeleton-card" aria-hidden="true">
      <div className="thumb skeleton-thumb" />
      <div className="video-info">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-meta" />
      </div>
      <div className="video-status">
        <div className="skeleton-chip" />
      </div>
      <div className="video-kebab" />
    </li>
  );
}
