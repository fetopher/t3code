import { describe, it, expect } from "vite-plus/test";
import {
  DEFAULT_MENU_BAR_SETTINGS,
  MenuBarSettings,
  type MenuBarUsageRow,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { menuBarPace, menuBarSummary, MENU_BAR_STALE_MS } from "./menuBar.ts";

const settings = DEFAULT_MENU_BAR_SETTINGS;
const decodeMenuBarSettings = Schema.decodeUnknownSync(MenuBarSettings);
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
  it.each([
    [10, 5, "#22c55e"],
    [10, 9, "#22c55e"],
    [10, 9.01, "#ef4444"],
    [10, 10, "#ef4444"],
    [20, 19, "#22c55e"],
    [20, 20, "#f59e0b"],
    [0, 0, "#ef4444"],
  ])("colors %s%% remaining with %s%% expected as %s", (remaining, expected, color) => {
    const result = menuBarSummary([paced(remaining, expected)], settings, now);
    expect(result.color).toBe(color);
    expect(result.title).toBe(`Claude ${remaining}%`);
  });
  it("a comfortable window cannot hide another window's warning", () => {
    const comfortable = paced(10, 5);
    const limited = { ...paced(8, 8), window: "Session" };
    const overPace = paced(35, 65, "Codex");
    expect(menuBarSummary([comfortable, limited], settings, now).title).toBe("Claude 8%");
    const summary = menuBarSummary([comfortable, overPace], settings, now);
    expect(summary.title).toBe("Codex 30 Δ");
    expect(summary.color).toBe("#ef4444");
  });
  it("requires a fresh, valid clock to suppress quota warnings", () => {
    for (const resetsAt of [null, "unknown", new Date(now).toISOString()]) {
      expect(menuBarSummary([{ ...paced(10, 5), resetsAt }], settings, now).color).toBe("#ef4444");
    }
    const stale = { ...paced(10, 5), checkedAt: new Date(now - MENU_BAR_STALE_MS).toISOString() };
    expect(menuBarSummary([stale], settings, now).color).toBe("#8e8e93");
  });
  it("becomes healthy as the reset approaches without changing the reported quota", () => {
    const duration = 7 * 24 * 60;
    const weekly = {
      ...paced(10, 100),
      windowDurationMins: duration,
      resetsAt: new Date(now + duration * 60_000 * 0.0901).toISOString(),
    };
    expect(menuBarSummary([weekly], settings, now).color).toBe("#ef4444");
    expect(menuBarSummary([weekly], settings, now + duration * 60_000 * 0.0001 + 1).color).toBe(
      "#22c55e",
    );
  });
  it("uses critical quota ahead of an amber pace warning", () => {
    const summary = menuBarSummary([paced(35, 50), paced(5, 5, "Codex")], paceSettings, now);
    expect(summary.title).toBe("Codex 5%");
    expect(summary.headline?.reason).toBe("quota");
    expect(summary.color).toBe("#ef4444");
  });
  it("uses critical pace ahead of amber quota and keeps title and color aligned", () => {
    const rows = [paced(35, 65), paced(20, 4, "Codex")];
    const summary = menuBarSummary(rows, settings, now);
    expect(summary.title).toBe("Claude 30 Δ");
    expect(summary.headline?.row.provider).toBe("Claude");
    expect(summary.headline?.reason).toBe("pace");
    expect(summary.color).toBe("#ef4444");
    expect(menuBarSummary(rows, { ...settings, excludedProviders: ["Claude"] }, now).title).toBe(
      "Codex 20%",
    );
  });
  it("still warns on quota without a usable reset clock, and excludes stale warnings", () => {
    const stale = { ...paced(35, 80), checkedAt: new Date(now - MENU_BAR_STALE_MS).toISOString() };
    const expired = { ...paced(35, 80), resetsAt: new Date(now).toISOString() };
    expect(menuBarSummary([stale, expired, row("Codex", 5)], settings, now).title).toBe("Codex 5%");
    expect(menuBarSummary([stale], settings, now).color).toBe("#8e8e93");
  });
  it("compares equally severe warnings relative to their thresholds and switches dynamically", () => {
    const quota = paced(15, 15, "Codex"); // two thirds through the amber quota band
    expect(menuBarSummary([quota, paced(35, 55)], settings, now).title).toBe("Codex 15%");
    expect(menuBarSummary([quota, paced(35, 58)], settings, now).title).toBe("Claude 23 Δ");
    expect(menuBarSummary([quota, paced(35, 42)], settings, now).title).toBe("Codex 15%");
    expect(menuBarSummary([paced(0, 99), paced(35, 99, "Codex")], settings, now).title).toBe(
      "Claude 0%",
    );
  });
  it("checks all windows, including a pace warning outside the lowest-quota window", () => {
    const rows = [row("Claude", 26), { ...paced(50, 80), window: "Weekly" }];
    expect(menuBarSummary(rows, settings, now).title).toBe("Claude 30 Δ");
    expect(menuBarSummary(rows, { ...settings, detail: "percentage" }, now).title).toBe("30 Δ");
    expect(
      menuBarSummary([...rows, row("Codex", 20)], { ...settings, detail: "all" }, now).title,
    ).toBe("Claude 30 Δ · Codex 20%");
  });
  it("automatic selection also applies to legacy and appearance preferences", () => {
    for (const colorMode of ["threshold", "pace", "monochrome", "custom"] as const) {
      expect(
        menuBarSummary([paced(35, 70), row("Codex", 20)], { ...settings, colorMode }, now).title,
      ).toBe("Claude 35 Δ");
    }
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
    const {
      paceWarningPercent: _warning,
      paceCriticalPercent: _critical,
      ...legacy
    } = { ...settings, colorMode: "threshold" as const };
    const loaded = decodeMenuBarSettings(legacy);
    expect(loaded.colorMode).toBe("threshold");
    expect(loaded.paceWarningPercent).toBe(10);
    expect(loaded.paceCriticalPercent).toBe(25);
  });
});
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
