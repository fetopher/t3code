import type { MenuBarSnapshot, MenuBarUsageRow } from "@t3tools/contracts";
import { menuBarSummary, menuBarPace, MENU_BAR_STALE_MS } from "@t3tools/shared/menuBar";

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

export function menuBarResetLabel(resetsAt: string | null, now: number) {
  if (!resetsAt || !Number.isFinite(Date.parse(resetsAt))) return "Reset time unavailable";
  const minutes = Math.ceil((Date.parse(resetsAt) - now) / 60_000);
  if (minutes <= 0) return "Reset due · refresh to check";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  return `Resets in ${[days && `${days}d`, hours && `${hours}h`, remainder && `${remainder}m`].filter(Boolean).slice(0, 2).join(" ")}`;
}

function updatedLabel(checkedAt: number, now: number) {
  if (!Number.isFinite(checkedAt)) return "Waiting for usage";
  const minutes = Math.max(0, Math.floor((now - checkedAt) / 60_000));
  return minutes === 0 ? "Updated just now" : `Updated ${minutes}m ago`;
}

function windowCard(row: MenuBarUsageRow, snapshot: MenuBarSnapshot, now: number) {
  const checked = Date.parse(row.checkedAt);
  const stale = !Number.isFinite(checked) || now - checked >= MENU_BAR_STALE_MS;
  const paceReading = menuBarPace(row, snapshot.settings, now);
  const paceMode = snapshot.settings.colorMode === "pace";
  const status = stale
    ? "unknown"
    : paceMode
      ? (paceReading?.status ?? "unknown")
      : row.remainingPercent <= snapshot.settings.criticalPercent
        ? "critical"
        : row.remainingPercent <= snapshot.settings.warningPercent
          ? "warning"
          : "healthy";
  const label = stale
    ? "Stale"
    : paceMode
      ? {
          unknown: "No pace data",
          critical: "Over pace",
          warning: "Watch pace",
          healthy: "On pace",
        }[status]
      : { unknown: "Stale", critical: "Low", warning: "Watch", healthy: "Healthy" }[status];
  const percentage = Math.floor(row.remainingPercent);
  const expected = paceReading?.expectedRemainingPercent ?? null;
  const gap = expected == null ? 0 : row.remainingPercent - expected;
  const pace = gap < -5 ? "faster" : gap > 5 ? "slower" : "even";
  const paceLabel =
    expected == null
      ? ""
      : `Even pace: ${Math.round(expected)}% remaining, with ${Math.round(100 - expected)}% of the window elapsed. ${pace === "faster" ? "Using allowance faster than an even pace." : pace === "slower" ? "Using allowance slower than an even pace." : "Usage is near an even pace."}`;
  const deficit = paceReading?.deficitPercent ?? 0;
  const paceDetail =
    paceReading && paceMode
      ? `${Math.abs(deficit).toFixed(1).replace(/\.0$/, "")} pts ${deficit > 0 ? "over" : "under"} pace · expected ${Math.round(expected!)}% left`
      : "";
  return `<article class="allowance ${status}" ${paceMode && paceReading ? `style="--bar:${paceReading.color}"` : ""} aria-label="${escape(row.window)}: ${stale ? "stale reading" : `${percentage}% remaining`}">
    <div class="card-heading"><h3>${escape(row.window)}</h3><span class="status">${label}</span></div>
    <div class="reading"><span class="number">${stale ? "—" : percentage}<small>${stale ? "" : "%"}</small></span><span class="remaining">remaining</span></div>
    <div class="bar-container"><div class="track" role="${stale ? "presentation" : "meter"}" ${stale ? "" : `aria-label="${escape(row.window)} remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${row.remainingPercent}"`}><span style="width:${stale ? 0 : row.remainingPercent}%"></span></div>${expected == null ? "" : `<span class="pace-marker ${pace}" style="left:${expected}%;${paceMode && paceReading ? `border-bottom-color:${paceReading.color}` : ""}" role="img" tabindex="0" aria-label="${escape(paceLabel)}" title="${escape(paceLabel)}"></span>`}</div>
    ${paceDetail ? `<p class="pace-detail">${paceDetail}</p>` : ""}
    <p class="reset">${stale ? "Refresh to update" : escape(menuBarResetLabel(row.resetsAt, now))}</p>
  </article>`;
}

/** Small, isolated tray surface. All provider strings enter as escaped text. */
export function renderMenuBarPanel(snapshot: MenuBarSnapshot, now: number) {
  const summary = menuBarSummary(snapshot.rows, snapshot.settings, now);
  const groups = new Map<string, MenuBarUsageRow[]>();
  for (const row of snapshot.rows) {
    const rows = groups.get(row.provider) ?? [];
    rows.push(row);
    groups.set(row.provider, rows);
  }
  const providers = [...groups.entries()].sort(
    ([, a], [, b]) =>
      Math.min(...a.map((row) => row.remainingPercent)) -
        Math.min(...b.map((row) => row.remainingPercent)) || a[0]!.label.localeCompare(b[0]!.label),
  );
  const cards = providers
    .map(([provider, rows]) => {
      const included = !snapshot.settings.excludedProviders.includes(provider);
      const checked = Math.min(...rows.map((row) => Date.parse(row.checkedAt)));
      return `<section class="provider"><div class="provider-heading"><span class="avatar">${escape(rows[0]!.label.slice(0, 1))}</span><div class="provider-name"><h2>${escape(rows[0]!.label)}</h2><p>${updatedLabel(checked, now)}</p></div><button class="include ${included ? "included" : ""}" data-provider="${escape(provider)}" aria-pressed="${included}" aria-label="Include ${escape(rows[0]!.label)} in menu bar">${included ? "In menu bar" : "Hidden"}</button></div><div class="windows">${rows.map((row) => windowCard(row, snapshot, now)).join("")}</div></section>`;
    })
    .join("");
  const options = (items: readonly (readonly [string, string])[], value: string) =>
    items
      .map(
        ([key, label]) =>
          `<option value="${key}" ${key === value ? "selected" : ""}>${label}</option>`,
      )
      .join("");
  return `<header><div class="brand"><span class="brand-mark">T3</span><div><h1>Usage remaining</h1><p>${summary.lowest ? `${escape(summary.lowest.label)} is closest to its limit` : "Your subscription allowances"}</p></div></div><button class="icon-button" data-action="refresh" aria-label="Refresh usage" title="Refresh usage">↻</button></header>
    <main>${cards || `<div class="empty"><span class="empty-mark">◷</span><h2>Waiting for usage</h2><p>Connect a provider that reports subscription limits. Its allowances will appear here.</p><button class="text-button" data-action="usage">Open Usage →</button></div>`}
    ${snapshot.rows.some((row) => row.expectedRemainingPercent != null) ? '<p class="pace-legend"><span>▲</span> Even pace for time remaining</p>' : ""}
    ${snapshot.notices.length ? `<aside class="notices">${snapshot.notices.map((notice) => `<p>${escape(notice)}</p>`).join("")}</aside>` : ""}
    <details id="display-options"><summary>Menu bar display <span>⌄</span></summary><div class="display-options"><label>Detail<select data-setting="detail">${options(
      [
        ["percentage", "Percentage only"],
        ["provider", "Lowest provider + %"],
        ["all", "All providers"],
      ],
      snapshot.settings.detail,
    )}</select></label><label>Color<select data-setting="colorMode">${options(
      [
        ["threshold", "Usage thresholds"],
        ["pace", "Usage pace"],
        ["monochrome", "Monochrome"],
        ["custom", "Custom color"],
      ],
      snapshot.settings.colorMode,
    )}</select></label>${snapshot.settings.colorMode === "custom" ? `<label class="custom-color">Custom color<input type="color" data-setting="color" value="${snapshot.settings.color}" /></label>` : ""}${snapshot.settings.colorMode === "pace" ? `<label>Amber deficit (pts)<input type="number" min="0" max="${snapshot.settings.paceCriticalPercent}" data-setting="paceWarningPercent" value="${snapshot.settings.paceWarningPercent}" /></label><label>Red deficit (pts)<input type="number" min="${snapshot.settings.paceWarningPercent}" max="100" data-setting="paceCriticalPercent" value="${snapshot.settings.paceCriticalPercent}" /></label><p class="pace-help">Expected remaining minus actual remaining. The worst included window colors the menu bar.</p>` : snapshot.settings.colorMode === "threshold" ? `<label>Warning below %<input type="number" min="0" max="100" data-setting="warningPercent" value="${snapshot.settings.warningPercent}" /></label><label>Critical below %<input type="number" min="0" max="100" data-setting="criticalPercent" value="${snapshot.settings.criticalPercent}" /></label>` : ""}</div></details>
    </main><footer><div class="footer-row"><button class="notification-toggle" data-action="notifications" aria-pressed="${snapshot.notificationsEnabled}" title="Toggle system notifications"><span class="notification-dot ${snapshot.notificationsEnabled ? "on" : ""}"></span>Notifications ${snapshot.notificationsEnabled ? "on" : "off"}</button><div class="footer-actions"><button class="text-button" data-action="test-notification">Test alert</button><button class="text-button" data-action="settings">Settings</button></div></div><button class="open-button" data-action="usage">Open T3 Code <span>↗</span></button><p id="action-status" role="status" aria-live="polite"></p></footer>`;
}

export const MENU_BAR_PANEL_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'"><title>T3 Code usage</title><style>
:root{color-scheme:light dark;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#252333;background:#f6f5fa;--surface:#fff;--border:#e6e3ef;--muted:#888293;--purple:#7757c7;--hover:#f0edf7;--track:#eeeaf5}
*{box-sizing:border-box}body{margin:0;height:100vh;overflow:hidden;user-select:none}#panel{height:100%;display:flex;flex-direction:column;border:1px solid var(--border);border-radius:16px;overflow:hidden}button,select,input{font:inherit}button{cursor:pointer;border:0}button:focus-visible,summary:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--purple);outline-offset:3px}button:disabled{opacity:.5;cursor:wait}
header{display:flex;align-items:center;justify-content:space-between;padding:20px 20px 17px;gap:12px}.brand{display:flex;align-items:center;gap:11px;min-width:0}.brand-mark{display:grid;place-items:center;width:37px;height:37px;border-radius:11px;background:#e9e2f6;color:#7554b3;font-weight:750;font-size:14px;letter-spacing:-.5px;flex:none}h1,h2,h3,p{margin:0}h1{font-size:16px;font-weight:680;letter-spacing:-.3px}.brand p{color:var(--muted);font-size:11px;margin-top:5px;line-height:1.35}.icon-button{display:grid;place-items:center;flex:none;color:var(--muted);background:transparent;border-radius:8px;width:30px;height:30px;font-size:23px}.icon-button:hover{background:var(--hover);color:var(--purple)}
main{overflow:auto;overscroll-behavior:contain;flex:1;min-height:0;padding:0 20px 5px}main::-webkit-scrollbar{width:4px}main::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}.provider{margin-bottom:20px}.provider-heading{display:flex;gap:9px;align-items:center;margin:1px 0 12px}.avatar{width:28px;height:28px;border:1px solid var(--border);border-radius:9px;background:var(--surface);display:grid;place-items:center;font-weight:650;color:var(--purple);flex:none}.provider-name{flex:1;min-width:0}.provider-name h2{font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.provider-name p{font-size:10px;color:var(--muted);margin-top:3px}.include{white-space:nowrap;background:transparent;border:1px solid var(--border);border-radius:20px;padding:4px 8px;font-size:9px;font-weight:600;color:var(--muted)}.include.included{color:var(--purple);background:#eee8f8;border-color:#e6dbf7}.include:hover{border-color:var(--purple)}
.windows{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.allowance{padding:14px 13px 12px;background:var(--surface);border:1px solid var(--border);border-radius:13px;min-width:0;--bar:#9470d2;--badge-bg:#edf8f1;--badge-color:#388265}.card-heading{display:flex;justify-content:space-between;align-items:center;gap:4px;margin-bottom:16px}.card-heading h3{font-size:10px;color:var(--muted);font-weight:600;letter-spacing:.45px;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{font-size:8px;font-weight:650;color:var(--badge-color);background:var(--badge-bg);padding:3px 5px;border-radius:4px;flex:none}.warning{--bar:#d49a4f;--badge-bg:#fff3df;--badge-color:#b47b24}.critical{--bar:#d77486;--badge-bg:#fcebf0;--badge-color:#bd536b}.unknown{--bar:#aaa;--badge-bg:var(--hover);--badge-color:var(--muted)}.reading{display:flex;align-items:baseline;justify-content:space-between;gap:4px;margin-bottom:12px}.number{font-size:34px;line-height:1;font-weight:720;letter-spacing:-1.4px;font-variant-numeric:tabular-nums}.number small{font-size:17px;color:var(--muted);letter-spacing:0;font-weight:550;margin-left:2px}.remaining{font-size:10px;color:var(--muted)}.bar-container{position:relative;padding-bottom:8px}.pace-marker{position:absolute;top:8px;transform:translateX(-50%);width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:5px solid var(--purple);cursor:help}.pace-marker.faster{border-bottom-color:#d77486}.pace-marker.slower{border-bottom-color:#59a78b}.pace-marker:focus-visible{outline:2px solid var(--purple);outline-offset:4px}.pace-detail{font-size:9px;color:var(--muted);line-height:1.5;margin-top:7px}.pace-help{grid-column:1/-1;font-size:10px;color:var(--muted);line-height:1.5}.pace-legend{font-size:10px;color:var(--muted);margin:-3px 0 16px}.pace-legend span{color:var(--purple);font-size:8px;margin-right:4px}.track{height:5px;border-radius:9px;background:var(--track);overflow:hidden}.track span{display:block;height:100%;border-radius:inherit;background:var(--bar)}.reset{font-size:10px;color:var(--muted);margin-top:10px;line-height:1.3}
.empty{text-align:center;border:1px dashed var(--border);border-radius:13px;padding:25px 20px;background:var(--surface);margin:0 0 16px}.empty-mark{font-size:27px;color:var(--purple);display:block;margin-bottom:10px}.empty h2{font-size:14px;font-weight:650}.empty p{color:var(--muted);line-height:1.6;font-size:12px;max-width:260px;margin:7px auto 15px}.notices{color:var(--muted);font-size:11px;line-height:1.5;margin:0 1px 16px}.notices p+p{margin-top:5px}
details{border-top:1px solid var(--border)}summary{display:flex;justify-content:space-between;align-items:center;padding:12px 1px;cursor:pointer;list-style:none;font-size:11px;color:var(--muted)}summary::-webkit-details-marker{display:none}.display-options{display:grid;grid-template-columns:1.2fr 1fr;gap:10px;padding-bottom:13px}.display-options label{font-size:10px;color:var(--muted);display:flex;flex-direction:column;gap:6px}.display-options select,.display-options input[type=number]{max-width:100%;min-width:0;font-size:11px;padding:6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:inherit}.custom-color{grid-column:1/-1;flex-direction:row!important;align-items:center}.custom-color input{width:35px;height:25px;border:1px solid var(--border);border-radius:5px;padding:2px;background:var(--surface)}
footer{padding:11px 20px 15px;border-top:1px solid var(--border);background:var(--surface)}.footer-actions{display:flex;gap:14px}.footer-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}.notification-toggle{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted);background:transparent;border-radius:5px;padding:3px 0}.notification-toggle:hover{color:var(--purple)}.notification-dot{width:5px;height:5px;border-radius:50%;background:#b5afbd}.notification-dot.on{background:#59a78b}.text-button{padding:3px 0;color:var(--purple);background:transparent;font-size:11px;font-weight:550}.text-button:hover{color:#9b77e3}.open-button{display:flex;justify-content:center;gap:7px;align-items:center;width:100%;border:1px solid var(--border);background:var(--hover);padding:9px;border-radius:8px;font-size:12px;font-weight:550;color:inherit}.open-button:hover{border-color:var(--purple)}#action-status:empty{display:none}#action-status{font-size:10px;color:var(--muted);margin-top:8px;text-align:center}
@media(prefers-color-scheme:dark){:root{background:#24222c;color:#eeeaf5;--surface:#2c2935;--border:#3e394c;--muted:#a69eb5;--purple:#b298e8;--hover:#383141;--track:#41394e}.brand-mark{background:#3b304e;color:#c3a6ef}.include.included{color:#bda0ed;background:#382e49;border-color:#4d3d64}.healthy{--badge-bg:#293f36;--badge-color:#89c4a6}.warning{--badge-bg:#4b3b26;--badge-color:#e1b66e}.critical{--badge-bg:#492f3b;--badge-color:#e3a0b3}}
</style></head><body><div id="panel" aria-label="Subscription usage"></div></body></html>`;
