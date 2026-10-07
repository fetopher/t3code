import { describe, it, expect } from "vite-plus/test";
import { DEFAULT_MENU_BAR_SETTINGS, type MenuBarUsageRow } from "@t3tools/contracts";
import { menuBarSummary, MENU_BAR_STALE_MS } from "./menuBar.ts";

const now = Date.parse("2026-10-07T18:00:00Z");
const row = (provider: string, remainingPercent: number, window = "Session"): MenuBarUsageRow => ({
  provider,
  label: provider,
  remainingPercent,
  window,
  checkedAt: new Date(now).toISOString(),
  resetsAt: null,
});
const settings = DEFAULT_MENU_BAR_SETTINGS;
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
