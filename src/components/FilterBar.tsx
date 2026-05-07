export const FILTERS = ["All", "Saved", "New"] as const;
export type Filter = (typeof FILTERS)[number];

export const MIN_LENGTH_OPTIONS = [
  { value: 0, label: "Any length" },
  { value: 3, label: "Min 3 min" },
  { value: 5, label: "Min 5 min" },
  { value: 10, label: "Min 10 min" },
  { value: 30, label: "Min 30 min" },
] as const;

type Props = {
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  skipShorts: boolean;
  onSkipShortsChange: (v: boolean) => void;
  minDurationMin: number;
  onMinDurationChange: (n: number) => void;
  newCount?: number;
};

export function FilterBar({
  filter,
  onFilterChange,
  skipShorts,
  onSkipShortsChange,
  minDurationMin,
  onMinDurationChange,
  newCount = 0,
}: Props) {
  return (
    <div className="filter-bar">
      {FILTERS.map((f) => (
        <button
          key={f}
          className={`pill${filter === f ? " active" : ""}`}
          onClick={() => onFilterChange(f)}
        >
          {f}
          {f === "New" && newCount > 0 ? (
            <span className="pill-badge">{newCount}</span>
          ) : null}
        </button>
      ))}
      <span className="sep">·</span>
      <button
        className={`pill${skipShorts ? " checked" : ""}`}
        onClick={() => onSkipShortsChange(!skipShorts)}
      >
        Skip Shorts
      </button>
      <label className="pill pill-select">
        <select
          value={minDurationMin}
          onChange={(e) => onMinDurationChange(Number(e.target.value))}
        >
          {MIN_LENGTH_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
