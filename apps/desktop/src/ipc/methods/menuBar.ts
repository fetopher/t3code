// @effect-diagnostics globalDate:off - Native tray callbacks format wall-clock readings synchronously for macOS menus.
import * as Electron from "electron";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_MENU_BAR_SETTINGS,
  MenuBarSnapshot,
  DesktopThreadNotification,
  MenuBarAction,
  type MenuBarSettings,
} from "@t3tools/contracts";
import { menuBarSummary, MENU_BAR_STALE_MS } from "@t3tools/shared/menuBar";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import { MENU_BAR_PANEL_DOCUMENT } from "../../menuBar/menuBarPanel.ts";
import {
  MENU_BAR_SNAPSHOT_CHANNEL,
  MENU_BAR_ACTION_CHANNEL,
  FOCUS_APP_WINDOW_CHANNEL,
  MENU_BAR_PANEL_SNAPSHOT_CHANNEL,
  MENU_BAR_PANEL_ACTION_CHANNEL,
  DESKTOP_THREAD_NOTIFICATION_CHANNEL,
} from "../channels.ts";

let tray: Electron.Tray | null = null;
let quitting = false;
let panel: Electron.BrowserWindow | null = null;
let panelPreload = "";
let contextMenu: Electron.Menu | undefined;
const nativeAlerts = new Map<string, Electron.Notification>();
let current: MenuBarSnapshot = {
  settings: DEFAULT_MENU_BAR_SETTINGS,
  rows: [],
  notices: [],
  image: null,
  attentionOnly: true,
  notifyWhileFocused: true,
  notificationsEnabled: true,
};

export function shouldKeepMenuBarRunning() {
  return tray !== null && current.settings.enabled && current.settings.keepRunning && !quitting;
}

/** Deliver actions to the app window, rather than any preview or permission window. */
function appWindow() {
  return (
    Electron.BrowserWindow.getAllWindows().find(
      (window) => !window.isDestroyed() && /^t3code(?:-dev)?:/.test(window.webContents.getURL()),
    ) ??
    Electron.BrowserWindow.getAllWindows().find(
      (window) => !window.isDestroyed() && window.webContents.getURL().includes("localhost"),
    )
  );
}

function send(action: MenuBarAction) {
  if (action.type === "test-notification") {
    showNativeThreadNotification({
      title: "T3 Code Menu Bar",
      body: "Test alert: session notifications are ready.",
      target: null,
    });
    return;
  }
  if (action.type === "dismiss") {
    panel?.hide();
    return;
  }
  const window = appWindow();
  if (!window) return;
  if (action.type === "usage" || action.type === "settings" || action.type === "thread") {
    panel?.hide();
    window.show();
    window.focus();
    Electron.app.focus({ steal: true });
  }
  window.webContents.send(MENU_BAR_ACTION_CHANNEL, action);
}

/** Use the macOS app's notification identity, independent of Chromium's origin permission. */
export function showNativeThreadNotification(input: DesktopThreadNotification) {
  if (!Electron.Notification.isSupported())
    throw new Error("System notifications are unavailable.");
  const key = input.target ? `${input.target.environmentId}:${input.target.threadId}` : "test";
  nativeAlerts.get(key)?.close();
  const notification = new Electron.Notification({
    title: input.title,
    body: input.body,
    silent: true,
  });
  nativeAlerts.set(key, notification);
  const release = () => {
    if (nativeAlerts.get(key) === notification) nativeAlerts.delete(key);
  };
  notification.once("close", release);
  notification.once("failed", (_event, error) => {
    release();
    Effect.runSync(Effect.logWarning("Could not deliver system notification", error));
  });
  notification.once("click", () => {
    notification.close();
    release();
    send(input.target ? { type: "thread", ...input.target } : { type: "settings" });
  });
  notification.show();
}

export function toggleMenuBarPanel() {
  if (!tray || !panelPreload) return;
  if (panel?.isVisible()) {
    panel.hide();
    return;
  }
  const anchor = tray.getBounds();
  const workArea = Electron.screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }).workArea;
  const providerCount = new Set(current.rows.map((row) => row.provider)).size;
  const height = Math.min(
    workArea.height - 16,
    Math.max(400, Math.min(640, 225 + providerCount * 205 + current.notices.length * 22)),
  );
  const width = Math.min(420, workArea.width - 16);
  const x = Math.round(
    Math.max(
      workArea.x + 8,
      Math.min(anchor.x + anchor.width / 2 - width / 2, workArea.x + workArea.width - width - 8),
    ),
  );
  const y = Math.round(
    Math.max(
      workArea.y + 6,
      Math.min(anchor.y + anchor.height + 6, workArea.y + workArea.height - height - 8),
    ),
  );
  if (!panel) {
    panel = new Electron.BrowserWindow({
      width,
      height,
      x,
      y,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: true,
      roundedCorners: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: "T3 Code usage",
      webPreferences: {
        preload: panelPreload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const window = panel;
    window.on("blur", () => window.hide());
    window.on("closed", () => {
      panel = null;
    });
    window.once("ready-to-show", () => {
      if (!window.isDestroyed() && current.settings.enabled) {
        window.show();
        window.focus();
      }
    });
    void window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(MENU_BAR_PANEL_DOCUMENT)}`,
    );
  } else {
    panel.setBounds({ x, y, width, height });
    panel.webContents.send(MENU_BAR_PANEL_SNAPSHOT_CHANNEL, current);
    panel.show();
    panel.focus();
  }
}

export function applyMenuBarSnapshot(snapshot: MenuBarSnapshot) {
  current = snapshot;
  if (!snapshot.settings.enabled) {
    tray?.destroy();
    tray = null;
    panel?.destroy();
    panel = null;
    return;
  }
  if (!tray) {
    tray = new Electron.Tray(Electron.nativeImage.createEmpty());
    tray.on("click", toggleMenuBarPanel);
    tray.on("right-click", () => {
      panel?.hide();
      if (contextMenu) tray?.popUpContextMenu(contextMenu);
    });
  }
  if (panel && !panel.isDestroyed())
    panel.webContents.send(MENU_BAR_PANEL_SNAPSHOT_CHANNEL, snapshot);
  const summary = menuBarSummary(snapshot.rows, snapshot.settings, Date.now());
  if (snapshot.image) {
    const icon = Electron.nativeImage.createEmpty();
    icon.addRepresentation({ scaleFactor: 2, dataURL: snapshot.image });
    icon.setTemplateImage(snapshot.settings.colorMode === "monochrome");
    tray.setImage(icon);
  }
  tray.setTitle(summary.title, { fontType: "monospacedDigit" });
  tray.setToolTip(
    summary.lowest
      ? `${summary.lowest.label}: ${summary.lowest.remainingPercent.toFixed(1)}% left (${summary.lowest.window})`
      : "No fresh subscription limits available",
  );
  const patch = (value: Partial<MenuBarSettings>) => send({ type: "patch", patch: value });
  const menu: Electron.MenuItemConstructorOptions[] = [
    { label: "Subscription usage remaining", enabled: false },
  ];
  for (const row of snapshot.rows) {
    const stale = Date.now() - Date.parse(row.checkedAt) >= MENU_BAR_STALE_MS;
    const reset = row.resetsAt
      ? ` · resets ${new Date(row.resetsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`
      : "";
    menu.push({
      label: `${row.label} · ${row.window}: ${stale ? "stale" : `${Math.floor(row.remainingPercent)}% left`}${reset}`,
      enabled: false,
    });
  }
  if (!snapshot.rows.length) menu.push({ label: "No reported limits yet", enabled: false });
  for (const notice of snapshot.notices) menu.push({ label: notice.slice(0, 180), enabled: false });
  const newest = Math.max(...snapshot.rows.map((row) => Date.parse(row.checkedAt)));
  if (Number.isFinite(newest))
    menu.push({
      label: `Last checked ${new Date(newest).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
      enabled: false,
    });
  menu.push(
    { type: "separator" },
    { label: "Refresh usage", click: () => send({ type: "refresh" }) },
    { label: "Open Usage", click: () => send({ type: "usage" }) },
    {
      label: "Display detail",
      submenu: (
        [
          ["percentage", "Percentage only"],
          ["provider", "Lowest provider + percentage"],
          ["all", "All providers"],
        ] as const
      ).map(([detail, label]) => ({
        label,
        type: "radio",
        checked: snapshot.settings.detail === detail,
        click: () => patch({ detail }),
      })),
    },
    {
      label: "Color",
      submenu: [
        {
          label: "Monochrome",
          type: "radio",
          checked: snapshot.settings.colorMode === "monochrome",
          click: () => patch({ colorMode: "monochrome" }),
        },
        {
          label: "Usage thresholds",
          type: "radio",
          checked: snapshot.settings.colorMode === "threshold",
          click: () => patch({ colorMode: "threshold" }),
        },
        { label: "Custom color…", click: () => send({ type: "settings" }) },
      ],
    },
    {
      label: "Providers in menu bar",
      submenu: [...new Map(snapshot.rows.map((row) => [row.provider, row.label])).entries()].map(
        ([provider, label]) => ({
          label,
          type: "checkbox",
          checked: !snapshot.settings.excludedProviders.includes(provider),
          click: () =>
            patch({
              excludedProviders: snapshot.settings.excludedProviders.includes(provider)
                ? snapshot.settings.excludedProviders.filter((id) => id !== provider)
                : [...snapshot.settings.excludedProviders, provider],
            }),
        }),
      ),
    },
    {
      label: "Keep running when window closes",
      type: "checkbox",
      checked: snapshot.settings.keepRunning,
      click: () => patch({ keepRunning: !snapshot.settings.keepRunning }),
    },
    {
      label: "System notifications",
      type: "checkbox",
      checked: snapshot.notificationsEnabled,
      click: () => send({ type: "notifications", enabled: !snapshot.notificationsEnabled }),
    },
    {
      label: "Only when a session needs me",
      type: "checkbox",
      checked: snapshot.attentionOnly,
      click: () => send({ type: "notifications", attentionOnly: !snapshot.attentionOnly }),
    },
    {
      label: "Notify even while T3 is focused",
      type: "checkbox",
      checked: snapshot.notifyWhileFocused,
      click: () =>
        send({ type: "notifications", notifyWhileFocused: !snapshot.notifyWhileFocused }),
    },
    { label: "Send test notification", click: () => send({ type: "test-notification" }) },
    { label: "Settings…", click: () => send({ type: "settings" }) },
    { type: "separator" },
    {
      label: "Show T3 Code Menu Bar",
      click: () => {
        const window = appWindow();
        window?.show();
        window?.focus();
      },
    },
    { label: "Quit T3 Code Menu Bar", click: () => Electron.app.quit() },
  );
  contextMenu = Electron.Menu.buildFromTemplate(menu);
}

export const installMenuBar = Effect.fn("desktop.ipc.installMenuBar")(function* () {
  const platform = yield* HostProcessPlatform;
  if (platform !== "darwin") return;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  panelPreload = environment.path.join(environment.dirname, "menu-bar-preload.cjs");
  const ipc = yield* DesktopIpc.DesktopIpc;
  const store = yield* DesktopClientSettings.DesktopClientSettings;
  const settings = Option.getOrElse(yield* store.get, () => DEFAULT_CLIENT_SETTINGS);
  yield* Effect.sync(() => {
    applyMenuBarSnapshot({
      ...current,
      settings: settings.menuBar,
      attentionOnly: settings.notificationAttentionOnly,
      notifyWhileFocused: settings.notificationWhileFocused,
      notificationsEnabled:
        settings.notificationMode === "notifications" ||
        settings.notificationMode === "notifications-and-sound",
    });
  });
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: MENU_BAR_SNAPSHOT_CHANNEL,
      payload: MenuBarSnapshot,
      result: Schema.Void,
      handler: (snapshot) => Effect.sync(() => applyMenuBarSnapshot(snapshot)),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: DESKTOP_THREAD_NOTIFICATION_CHANNEL,
      payload: DesktopThreadNotification,
      result: Schema.Void,
      handler: (notification) => Effect.sync(() => showNativeThreadNotification(notification)),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: MENU_BAR_PANEL_SNAPSHOT_CHANNEL,
      payload: Schema.Void,
      result: MenuBarSnapshot,
      handler: () => Effect.sync(() => current),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: MENU_BAR_PANEL_ACTION_CHANNEL,
      payload: MenuBarAction,
      result: Schema.Void,
      handler: (action) => Effect.sync(() => send(action)),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: FOCUS_APP_WINDOW_CHANNEL,
      payload: Schema.Void,
      result: Schema.Void,
      handler: () =>
        Effect.sync(() => {
          const window = appWindow();
          window?.show();
          window?.focus();
        }),
    }),
  );
  const beforeQuit = () => {
    quitting = true;
  };
  Electron.app.on("before-quit", beforeQuit);
  yield* Effect.sync(() => applyMenuBarSnapshot(current)).pipe(
    Effect.repeat({ schedule: Schedule.spaced("1 minute") }),
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      Electron.app.removeListener("before-quit", beforeQuit);
      tray?.destroy();
      tray = null;
      panel?.destroy();
      panel = null;
      contextMenu = undefined;
      for (const notification of nativeAlerts.values()) notification.close();
      nativeAlerts.clear();
    }),
  );
});
