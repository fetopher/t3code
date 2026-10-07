// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off globalTimers:off -- Standalone Electron lifecycle and local adapter callbacks.
import { app, Menu, Notification } from "electron";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeChildProcess from "node:child_process";
import * as Schema from "effect/Schema";
import {
  DEFAULT_MENU_BAR_SETTINGS,
  MenuBarSettings,
  type MenuBarAction,
  type MenuBarSnapshot,
} from "@t3tools/contracts";
import { menuBarSummary } from "@t3tools/shared/menuBar";
import { readSessionStates, sessionTransitions, type SessionState } from "./sessionState.ts";
import { readCompanionUsage } from "./usage.ts";
import { statusIconPng } from "./statusIcon.ts";
import {
  applyMenuBarSnapshot,
  initializeCompanionMenuBar,
  openMenuBarSettings,
  toggleMenuBarPanel,
} from "../ipc/methods/menuBar.ts";

const stateDir = NodePath.join(NodeOS.homedir(), ".t3", "userdata");
app.setPath("userData", NodePath.join(app.getPath("appData"), "t3code-menubar"));
const preferencesPath = NodePath.join(app.getPath("userData"), "companion-settings.json");
let snapshot: MenuBarSnapshot = {
  settings: DEFAULT_MENU_BAR_SETTINGS,
  rows: [],
  notices: [],
  image: null,
  attentionOnly: true,
  notifyWhileFocused: true,
  notificationsEnabled: true,
};
let launchAtLogin = true;
let hideDockIcon = true;
try {
  const saved = JSON.parse(NodeFS.readFileSync(preferencesPath, "utf8")) as {
    settings?: unknown;
    attentionOnly?: boolean;
    notifyWhileFocused?: boolean;
    notificationsEnabled?: boolean;
    launchAtLogin?: boolean;
    hideDockIcon?: boolean;
  };
  snapshot = {
    ...snapshot,
    settings: Schema.decodeUnknownSync(MenuBarSettings)(saved.settings),
    attentionOnly: saved.attentionOnly !== false,
    notifyWhileFocused: saved.notifyWhileFocused !== false,
    notificationsEnabled: saved.notificationsEnabled !== false,
  };
  launchAtLogin = saved.launchAtLogin !== false;
  hideDockIcon = saved.hideDockIcon !== false;
} catch {
  /* First launch uses the standalone companion defaults. */
}

// Legacy quota-only and pace-only preferences now both use automatic warnings.
if (snapshot.settings.colorMode === "pace" || snapshot.settings.colorMode === "threshold")
  snapshot = { ...snapshot, settings: { ...snapshot.settings, colorMode: "automatic" } };

const save = () => {
  NodeFS.mkdirSync(app.getPath("userData"), { recursive: true });
  NodeFS.writeFileSync(
    preferencesPath,
    JSON.stringify(
      {
        settings: snapshot.settings,
        attentionOnly: snapshot.attentionOnly,
        notifyWhileFocused: snapshot.notifyWhileFocused,
        notificationsEnabled: snapshot.notificationsEnabled,
        launchAtLogin,
        hideDockIcon,
      },
      null,
      2,
    ),
  );
};
const openStandard = () =>
  NodeChildProcess.execFile("/usr/bin/open", ["-b", "com.t3tools.t3code"], (error) => {
    if (error) {
      snapshot = {
        ...snapshot,
        notices: [...snapshot.notices, "Install standard T3 Code to open your sessions."],
      };
      publish();
    }
  });
const publish = () => {
  const summary = menuBarSummary(snapshot.rows, snapshot.settings, Date.now());
  snapshot = {
    ...snapshot,
    image: `data:image/png;base64,${statusIconPng(summary.color).toString("base64")}`,
    rows: snapshot.rows.map((row) => ({
      ...row,
      expectedRemainingPercent:
        row.windowDurationMins && row.resetsAt
          ? Math.max(
              0,
              Math.min(
                100,
                (100 * (Date.parse(row.resetsAt) - Date.now())) / (row.windowDurationMins * 60_000),
              ),
            )
          : (row.expectedRemainingPercent ?? null),
    })),
  };
  applyMenuBarSnapshot(snapshot);
};
let refreshing = false;
let usageNotices: readonly string[] = [];
let sessionNotice: string | null = null;
const refreshNotices = () => {
  snapshot = {
    ...snapshot,
    notices: [
      "Companion to standard T3 Code",
      ...usageNotices,
      ...(sessionNotice ? [sessionNotice] : []),
    ],
  };
};
const refreshUsage = async () => {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await readCompanionUsage(stateDir);
    // Keep failed readings visible, then let the shared stale policy expire them.
    const updated = new Set(next.rows.map((row) => row.provider));
    snapshot = {
      ...snapshot,
      rows: [...next.rows, ...snapshot.rows.filter((row) => !updated.has(row.provider))],
    };
    usageNotices = next.notices;
    refreshNotices();
    publish();
  } finally {
    refreshing = false;
  }
};
let previous = new Map<string, SessionState>();
let hasBaseline = false;
const alerts = new Map<string, Notification>();
const alert = (id: string, title: string, body: string) => {
  if (!Notification.isSupported()) return;
  alerts.get(id)?.close();
  const notification = new Notification({ title, body: body.slice(0, 500), silent: true });
  alerts.set(id, notification);
  const release = () => {
    if (alerts.get(id) === notification) alerts.delete(id);
  };
  notification.once("close", release);
  notification.once("failed", () => {
    release();
    sessionNotice = "macOS could not deliver an alert. Check System Settings → Notifications.";
    refreshNotices();
    publish();
  });
  notification.once("click", () => {
    notification.close();
    release();
    openStandard();
  });
  notification.show();
};
const scanSessions = () => {
  try {
    const sessions = readSessionStates(stateDir);
    if (snapshot.notificationsEnabled) {
      for (const event of sessionTransitions(
        previous,
        sessions,
        snapshot.attentionOnly,
        hasBaseline,
      ))
        alert(event.session.id, event.title, event.session.title);
    }
    previous = new Map(sessions.map((session) => [session.id, session]));
    hasBaseline = true;
    if (sessionNotice) {
      sessionNotice = null;
      refreshNotices();
      publish();
    }
  } catch {
    // Rebaseline after an official update or a schema change, avoiding duplicate alerts.
    previous.clear();
    hasBaseline = false;
    sessionNotice = "Session monitoring unavailable. Standard T3 Code may be updating.";
    refreshNotices();
    publish();
  }
};
const onAction = (action: MenuBarAction) => {
  if (action.type === "patch") {
    snapshot = { ...snapshot, settings: { ...snapshot.settings, ...action.patch } };
    save();
    publish();
  } else if (action.type === "notifications") {
    snapshot = {
      ...snapshot,
      ...(action.enabled === undefined ? {} : { notificationsEnabled: action.enabled }),
      ...(action.attentionOnly === undefined ? {} : { attentionOnly: action.attentionOnly }),
      ...(action.notifyWhileFocused === undefined
        ? {}
        : { notifyWhileFocused: action.notifyWhileFocused }),
    };
    save();
    publish();
  } else if (action.type === "refresh") void refreshUsage();
  else if (action.type === "settings") openMenuBarSettings();
  else if (action.type === "usage" || action.type === "thread") openStandard();
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", openMenuBarSettings);
  app.on("activate", openMenuBarSettings);
  app.on("window-all-closed", () => {
    /* Menu bar companion stays running. */
  });
  void app.whenReady().then(() => {
    if (hideDockIcon) app.dock?.hide();
    else void app.dock?.show();
    // CLI probes need the same usual installation directories as a terminal.
    process.env.PATH = [
      NodePath.join(NodeOS.homedir(), ".local/bin"),
      NodePath.join(NodeOS.homedir(), ".bun/bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      process.env.PATH,
    ]
      .filter(Boolean)
      .join(":");
    app.setLoginItemSettings({ openAtLogin: launchAtLogin });
    initializeCompanionMenuBar({
      preload: NodePath.join(__dirname, "menu-bar-preload.cjs"),
      snapshot,
      onAction,
      extraMenu: () => [
        {
          label: "Hide Dock icon",
          type: "checkbox",
          checked: hideDockIcon,
          click: () => {
            hideDockIcon = !hideDockIcon;
            if (hideDockIcon) app.dock?.hide();
            else void app.dock?.show();
            save();
            publish();
          },
        },
        {
          label: "Launch companion at login",
          type: "checkbox",
          checked: launchAtLogin,
          click: () => {
            launchAtLogin = !launchAtLogin;
            app.setLoginItemSettings({ openAtLogin: launchAtLogin });
            save();
            publish();
          },
        },
        {
          label: "macOS notification settings…",
          click: () =>
            NodeChildProcess.execFile("/usr/bin/open", [
              "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
            ]),
        },
      ],
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { label: "Usage drawer", click: toggleMenuBarPanel },
            { label: "Settings…", click: openMenuBarSettings },
            { label: "Open standard T3 Code", click: openStandard },
            { role: "quit" },
          ],
        },
      ]),
    );
    scanSessions();
    void refreshUsage();
    if (!app.getLoginItemSettings().wasOpenedAtLogin) toggleMenuBarPanel();
    const scanTimer = setInterval(scanSessions, 2000);
    const usageTimer = setInterval(() => void refreshUsage(), 300_000);
    const displayTimer = setInterval(publish, 60_000);
    app.on("before-quit", () => {
      clearInterval(scanTimer);
      clearInterval(usageTimer);
      clearInterval(displayTimer);
      for (const notification of alerts.values()) notification.close();
    });
  });
}
