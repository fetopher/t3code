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

const warningColor = { healthy: "#22c55e", warning: "#f59e0b", critical: "#ef4444" };

/** A one-point pace cushion makes low quota healthy; otherwise the strongest risk wins. */
export function menuBarWindowWarning(row: MenuBarUsageRow, settings: MenuBarSettings, now: number) {
  const pace = menuBarPace(row, settings, now);
  const paceProtected = row.remainingPercent > 0 && pace !== null && pace.deficitPercent <= -1;
  const status = paceProtected
    ? "healthy"
    : row.remainingPercent <= settings.criticalPercent
      ? "critical"
      : row.remainingPercent <= settings.warningPercent
        ? "warning"
        : "healthy";
  const quota = {
    row,
    reason: "quota" as const,
    paceProtected,
    status,
    severity: status === "critical" ? 2 : status === "warning" ? 1 : 0,
    strength:
      status === "critical"
        ? row.remainingPercent === 0
          ? Infinity
          : settings.criticalPercent / row.remainingPercent
        : status === "warning"
          ? (settings.warningPercent - row.remainingPercent) /
            Math.max(1, settings.warningPercent - settings.criticalPercent)
          : 0,
    color: warningColor[status],
    deficitPercent: 0,
  };
  if (!pace || pace.status === "healthy") return quota;
  const paceWarning = {
    row,
    reason: "pace" as const,
    paceProtected: false,
    status: pace.status,
    severity: pace.status === "critical" ? 2 : 1,
    strength:
      pace.status === "critical"
        ? pace.deficitPercent / Math.max(1, settings.paceCriticalPercent)
        : (pace.deficitPercent - settings.paceWarningPercent) /
          Math.max(1, settings.paceCriticalPercent - settings.paceWarningPercent),
    color: pace.color,
    deficitPercent: pace.deficitPercent,
  };
  return paceWarning.severity > quota.severity ||
    (paceWarning.severity === quota.severity && paceWarning.strength > quota.strength)
    ? paceWarning
    : quota;
}

/** The title and color always refer to the same strongest warning. */
export function menuBarSummary(
  rows: readonly MenuBarUsageRow[],
  settings: MenuBarSettings,
  now: number,
) {
  const readings = menuBarReadings(rows, settings, now);
  const warnings = readings
    .map((row) => menuBarWindowWarning(row, settings, now))
    .sort(
      (a, b) =>
        b.severity - a.severity ||
        b.strength - a.strength ||
        a.row.remainingPercent - b.row.remainingPercent ||
        a.row.label.localeCompare(b.row.label),
    );
  const byProvider = new Map<string, (typeof warnings)[number]>();
  for (const warning of warnings) {
    if (!byProvider.has(warning.row.provider)) byProvider.set(warning.row.provider, warning);
  }
  const providerWarnings = [...byProvider.values()];
  const providers = providerWarnings.map((warning) => warning.row);
  const lowest = [...readings].sort((a, b) => a.remainingPercent - b.remainingPercent)[0];
  const headline = warnings[0];
  const metric = (warning: (typeof warnings)[number]) =>
    warning.reason === "pace"
      ? `${warning.deficitPercent.toFixed(1).replace(/\.0$/, "")} Δ`
      : `${Math.floor(warning.row.remainingPercent)}%`;
  const title = !headline
    ? "T3 —"
    : settings.detail === "percentage"
      ? metric(headline)
      : settings.detail === "all"
        ? providerWarnings.map((warning) => `${warning.row.label} ${metric(warning)}`).join(" · ")
        : `${headline.row.label} ${metric(headline)}`;
  const color =
    settings.colorMode === "monochrome"
      ? "#000000"
      : settings.colorMode === "custom"
        ? settings.color
        : (headline?.color ?? "#8e8e93");
  return { title, color, lowest, providers, readings, headline };
}
