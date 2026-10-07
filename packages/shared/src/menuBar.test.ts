import { describe, it, expect } from "vite-plus/test";
import {
  DEFAULT_MENU_BAR_SETTINGS,
  MenuBarSettings,
  type MenuBarUsageRow,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { menuBarPace, menuBarSummary, MENU_BAR_STALE_MS } from "./menuBar.ts";

const now = Date.parse("2026-10-07T18:00:00Z");
const row = (provider: string, remainingPercent: number, window = "Session"): MenuBarUsageRow => ({
  provider,
  label: provider,
  remainingPercent,
  window,
  checkedAt: new Date(now).toISOString(),
  resetsAt: null,
});

describe("usage pace colors", () => {
  const paceSettings = { ...settings, colorMode: "pace" as const };
  const paced = (remaining: number, expected: number, provider = "Claude") => ({
    ...row(provider, remaining, "Weekly"),
    expectedRemainingPercent: expected,
    resetsAt: new Date(now + 3 * 24 * 60 * 60_000).toISOString(),
  });
  it.each([
    [44.9, "#22c55e"],
    [45, "#f59e0b"],
    [59.9, "#f59e0b"],
    [60, "#ef4444"],
    [20, "#22c55e"],
  ])("colors 35%% remaining against %s%% expected as %s", (expected, color) => {
    expect(menuBarSummary([paced(35, expected)], paceSettings, now).color).toBe(color);
  });
  it("uses the worst included window while preserving the lowest-remaining headline", () => {
    const rows = [paced(35, 60), paced(5, 4, "Codex")];
    const summary = menuBarSummary(rows, paceSettings, now);
    expect(summary.title).toBe("Codex 5%");
    expect(summary.worstPace?.row.provider).toBe("Claude");
    expect(summary.color).toBe("#ef4444");
    expect(
      menuBarSummary(rows, { ...paceSettings, excludedProviders: ["Claude"] }, now).color,
    ).toBe("#22c55e");
  });
  it("never invents pace for stale readings, missing clocks, or reset windows that have ended", () => {
    const stale = { ...paced(35, 80), checkedAt: new Date(now - MENU_BAR_STALE_MS).toISOString() };
    const expired = { ...paced(35, 80), resetsAt: new Date(now).toISOString() };
    expect(menuBarSummary([stale, expired, row("Codex", 5)], paceSettings, now).color).toBe(
      "#8e8e93",
    );
  });
  it("uses elapsed reset time and honors customized pace thresholds", () => {
    const weekly = {
      ...paced(35, 100),
      windowDurationMins: 7 * 24 * 60,
      resetsAt: new Date(now + 3.5 * 24 * 60 * 60_000).toISOString(),
    };
    expect(menuBarPace(weekly, paceSettings, now)?.deficitPercent).toBe(15);
    expect(
      menuBarSummary(
        [weekly],
        { ...paceSettings, paceWarningPercent: 5, paceCriticalPercent: 15 },
        now,
      ).color,
    ).toBe("#ef4444");
  });
  it("loads existing preferences with the new defaults without resetting their display choice", () => {
    const { paceWarningPercent: _warning, paceCriticalPercent: _critical, ...legacy } = settings;
    const loaded = decodeMenuBarSettings(legacy);
    expect(loaded.colorMode).toBe("threshold");
    expect(loaded.paceWarningPercent).toBe(10);
    expect(loaded.paceCriticalPercent).toBe(25);
  });
});
const settings = DEFAULT_MENU_BAR_SETTINGS;
const decodeMenuBarSettings = Schema.decodeUnknownSync(MenuBarSettings);
describe("menu bar usage", () => {
  it("compares the tightest window across providers and preserves real zero", () => {
    const result = menuBarSummary(
      [row("Codex", 62), row("Codex", 3, "Weekly"), row("Claude", 18)],
      settings,
      now,
    );
    expect(result.title).toBe("Codex 3%");
    expect(result.lowest?.window).toBe("Weekly");
    expect(result.providers).toHaveLength(2);
    expect(menuBarSummary([row("Claude", 0)], settings, now).title).toBe("Claude 0%");
  });
  it("excludes stale and invalid readings without replacing them with zero", () => {
    const stale = {
      ...row("Codex", 0),
      checkedAt: new Date(now - MENU_BAR_STALE_MS).toISOString(),
    };
    const invalid = { ...row("Grok", 0), checkedAt: "unknown" };
    expect(menuBarSummary([stale, invalid, row("Claude", 20)], settings, now).title).toBe(
      "Claude 20%",
    );
    expect(menuBarSummary([stale], settings, now).title).toBe("T3 —");
  });
  it("honors provider exclusions and all display modes", () => {
    const rows = [row("Codex", 8.9), row("Claude", 42)];
    expect(menuBarSummary(rows, { ...settings, detail: "percentage" }, now).title).toBe("8%");
    expect(menuBarSummary(rows, { ...settings, detail: "all" }, now).title).toBe(
      "Codex 8% · Claude 42%",
    );
    expect(menuBarSummary(rows, { ...settings, excludedProviders: ["Codex"] }, now).title).toBe(
      "Claude 42%",
    );
  });
  it("applies custom colors and exact warning thresholds", () => {
    expect(menuBarSummary([row("Codex", 10)], settings, now).color).toBe("#ef4444");
    expect(menuBarSummary([row("Codex", 25)], settings, now).color).toBe("#f59e0b");
    expect(menuBarSummary([row("Codex", 26)], settings, now).color).toBe("#22c55e");
    expect(
      menuBarSummary([], { ...settings, colorMode: "custom", color: "#336699" }, now).color,
    ).toBe("#336699");
    expect(menuBarSummary([], settings, now).color).toBe("#8e8e93");
  });
});
