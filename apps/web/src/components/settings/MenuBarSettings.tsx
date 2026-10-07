import type { MenuBarSettings as Preferences } from "@t3tools/contracts";
import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function MenuBarSettings() {
  const settings = useClientSettings((value) => value.menuBar);
  const update = useUpdateClientSettings();
  if (window.desktopBridge?.getClientPlatform?.() !== "darwin") return null;
  const patch = (value: Partial<Preferences>) => {
    void update({ menuBar: { ...settings, ...value } });
  };
  return (
    <>
      <SettingsRow
        {...searchableSetting("menu-bar")}
        description="Automatically show the strongest quota or pace warning. Click the menu bar for all providers, reset times, and provider selection."
        control={
          <Switch
            aria-label="Menu bar usage"
            checked={settings.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
          />
        }
      />
      <SettingsRow
        title="Menu bar detail"
        description="The value and provider follow whichever included window has the strongest warning."
        control={
          <Select
            value={settings.detail}
            onValueChange={(detail) => {
              if (detail === "percentage" || detail === "provider" || detail === "all")
                patch({ detail });
            }}
          >
            <SelectTrigger size="sm" aria-label="Menu bar detail">
              <SelectValue>
                {
                  {
                    percentage: "Value only",
                    provider: "Provider + value",
                    all: "All providers",
                  }[settings.detail]
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="percentage">Value only</SelectItem>
              <SelectItem value="provider">Provider + value</SelectItem>
              <SelectItem value="all">All providers</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Menu bar color"
        description="Automatically color the strongest warning, use monochrome, or choose a custom color."
        control={
          <div className="flex items-center gap-3">
            <Select
              value={
                settings.colorMode === "pace" || settings.colorMode === "threshold"
                  ? "automatic"
                  : settings.colorMode
              }
              onValueChange={(colorMode) => {
                if (
                  colorMode === "monochrome" ||
                  colorMode === "automatic" ||
                  colorMode === "custom"
                )
                  patch({ colorMode });
              }}
            >
              <SelectTrigger size="sm" aria-label="Menu bar color">
                <SelectValue>
                  {
                    {
                      monochrome: "Monochrome",
                      automatic: "Automatic warnings",
                      threshold: "Automatic warnings",
                      pace: "Automatic warnings",
                      custom: "Custom color",
                    }[settings.colorMode]
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="monochrome">Monochrome</SelectItem>
                <SelectItem value="automatic">Automatic warnings</SelectItem>
                <SelectItem value="custom">Custom color</SelectItem>
              </SelectPopup>
            </Select>
            {settings.colorMode === "custom" ? (
              <input
                aria-label="Custom menu bar color"
                type="color"
                value={settings.color}
                onChange={(event) => patch({ color: event.target.value })}
              />
            ) : null}
          </div>
        }
      />
      <SettingsRow
        title="Quota warning thresholds"
        description="Green above warning; amber at warning; red at critical. Values are percentage remaining."
        control={
          <div className="flex items-center gap-2">
            <label htmlFor="menu-warning">Warning</label>
            <div className="w-20">
              <Input
                id="menu-warning"
                type="number"
                min={settings.criticalPercent}
                max={100}
                value={settings.warningPercent}
                onChange={(event) => {
                  const n = event.target.valueAsNumber;
                  if (Number.isFinite(n))
                    patch({
                      warningPercent: Math.max(settings.criticalPercent, Math.min(100, n)),
                    });
                }}
              />
            </div>
            <label htmlFor="menu-critical">Critical</label>
            <div className="w-20">
              <Input
                id="menu-critical"
                type="number"
                min={0}
                max={settings.warningPercent}
                value={settings.criticalPercent}
                onChange={(event) => {
                  const n = event.target.valueAsNumber;
                  if (Number.isFinite(n))
                    patch({ criticalPercent: Math.max(0, Math.min(settings.warningPercent, n)) });
                }}
              />
            </div>
          </div>
        }
      />
      <SettingsRow
        title="Pace warning thresholds"
        description="Expected remaining minus actual remaining, in percentage points. Amber at warning; red at critical. Competes with low quota warnings automatically."
        control={
          <div className="flex items-center gap-2">
            <label htmlFor="menu-pace-warning">Amber</label>
            <div className="w-20">
              <Input
                id="menu-pace-warning"
                type="number"
                min={0}
                max={settings.paceCriticalPercent}
                value={settings.paceWarningPercent}
                onChange={(event) => {
                  const n = event.target.valueAsNumber;
                  if (Number.isFinite(n))
                    patch({
                      paceWarningPercent: Math.max(0, Math.min(settings.paceCriticalPercent, n)),
                    });
                }}
              />
            </div>
            <label htmlFor="menu-pace-critical">Red</label>
            <div className="w-20">
              <Input
                id="menu-pace-critical"
                type="number"
                min={settings.paceWarningPercent}
                max={100}
                value={settings.paceCriticalPercent}
                onChange={(event) => {
                  const n = event.target.valueAsNumber;
                  if (Number.isFinite(n))
                    patch({
                      paceCriticalPercent: Math.max(settings.paceWarningPercent, Math.min(100, n)),
                    });
                }}
              />
            </div>
          </div>
        }
      />
      <SettingsRow
        title="Keep running in menu bar"
        description="Closing the window hides it while usage checks and session notifications continue. Use Quit to stop the app."
        control={
          <Switch
            aria-label="Keep running in menu bar"
            checked={settings.keepRunning}
            onCheckedChange={(keepRunning) => patch({ keepRunning })}
          />
        }
      />
    </>
  );
}
