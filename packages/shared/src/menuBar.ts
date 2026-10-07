import type { MenuBarSettings, MenuBarUsageRow } from "@t3tools/contracts";

export const MENU_BAR_STALE_MS = 10 * 60_000;

/** Percentage-point deficit: expected remaining minus actual remaining. */
export function menuBarPace(row: MenuBarUsageRow, settings: MenuBarSettings, now: number) {
  const checked = Date.parse(row.checkedAt);
  const reset = Date.parse(row.resetsAt ?? "");
  if (
    !Number.isFinite(checked) ||
    now - checked >= MENU_BAR_STALE_MS ||
    !Number.isFinite(reset) ||
    reset <= now
  )
    return null;
  const expected = row.windowDurationMins
    ? Math.max(0, Math.min(100, (100 * (reset - now)) / (row.windowDurationMins * 60_000)))
    : row.expectedRemainingPercent;
  if (expected == null || !Number.isFinite(expected)) return null;
  const deficitPercent = expected - row.remainingPercent;
  const status =
    deficitPercent >= settings.paceCriticalPercent
      ? "critical"
      : deficitPercent >= settings.paceWarningPercent
        ? "warning"
        : "healthy";
  const color = status === "critical" ? "#ef4444" : status === "warning" ? "#f59e0b" : "#22c55e";
  return { row, expectedRemainingPercent: expected, deficitPercent, status, color };
}

/** An expired reading is unknown, never an invented zero or a refilled quota. */
export function menuBarReadings(
  rows: readonly MenuBarUsageRow[],
  settings: MenuBarSettings,
  now: number,
) {
  return rows.filter((row) => {
    const checked = Date.parse(row.checkedAt);
    return (
      !settings.excludedProviders.includes(row.provider) &&
      Number.isFinite(checked) &&
      now - checked < MENU_BAR_STALE_MS
    );
  });
}

/** Compare each provider's most constrained window; keep ties stable. */
export function menuBarSummary(
  rows: readonly MenuBarUsageRow[],
  settings: MenuBarSettings,
  now: number,
) {
  const readings = menuBarReadings(rows, settings, now);
  const byProvider = new Map<string, MenuBarUsageRow>();
  for (const row of readings) {
    const previous = byProvider.get(row.provider);
    if (!previous || row.remainingPercent < previous.remainingPercent)
      byProvider.set(row.provider, row);
  }
  const providers = [...byProvider.values()].sort(
    (a, b) => a.remainingPercent - b.remainingPercent || a.label.localeCompare(b.label),
  );
  const lowest = providers[0];
  const worstPace = readings
    .flatMap((row) => {
      const pace = menuBarPace(row, settings, now);
      return pace ? [pace] : [];
    })
    .sort((a, b) => b.deficitPercent - a.deficitPercent)[0];
  // Floor keeps a nearly exhausted allowance from being rounded up to 1%.
  const percentage = (row: MenuBarUsageRow) => `${Math.floor(row.remainingPercent)}%`;
  const title = !lowest
    ? "T3 —"
    : settings.detail === "percentage"
      ? percentage(lowest)
      : settings.detail === "all"
        ? providers.map((row) => `${row.label} ${percentage(row)}`).join(" · ")
        : `${lowest.label} ${percentage(lowest)}`;
  const color =
    settings.colorMode === "monochrome"
      ? "#000000"
      : settings.colorMode === "custom"
        ? settings.color
        : settings.colorMode === "pace"
          ? (worstPace?.color ?? "#8e8e93")
          : !lowest
            ? "#8e8e93"
            : lowest.remainingPercent <= settings.criticalPercent
              ? "#ef4444"
              : lowest.remainingPercent <= settings.warningPercent
                ? "#f59e0b"
                : "#22c55e";
  return { title, color, lowest, providers, readings, worstPace };
}
