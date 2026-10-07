import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState } from "react";
import type { MenuBarAction, MenuBarUsageRow } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitNotices,
  collectLimitPools,
  displayLimitWindows,
  evenPaceRemainingPercent,
} from "@t3tools/shared/usageLimits";
import { menuBarSummary } from "@t3tools/shared/menuBar";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import {
  getClientSettings,
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
} from "../hooks/useSettings";
import { environmentPresentations } from "../state/presentation";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { getDriverOption } from "./settings/providerDriverMeta";
import { hasDesktopNotifications } from "../threadNotifications";

export function MenuBarCoordinator() {
  return window.desktopBridge?.getClientPlatform?.() === "darwin" ? (
    <NativeMenuBarCoordinator />
  ) : null;
}

function NativeMenuBarCoordinator() {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const settings = useClientSettings();
  const hydrated = useClientSettingsHydrated();
  const updateSettings = useUpdateClientSettings();
  const navigate = useNavigate();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [now, setNow] = useState(Date.now);
  const enabled = hydrated && settings.menuBar.enabled;
  const connectedKey = [...presentations]
    .filter(([, value]) => value.connection.phase === "connected")
    .map(([id]) => id)
    .sort()
    .join(",");
  const refresh = useEffectEvent(async (automatic: boolean) => {
    await Promise.all(
      [...presentations].map(([environmentId, presentation]) =>
        presentation.connection.phase === "connected" && presentation.serverConfig
          ? refreshUsageLimits(
              environmentId,
              () => refreshProviders({ environmentId, input: {} }),
              automatic,
            )
          : undefined,
      ),
    );
  });
  useEffect(() => {
    if (!enabled || connectedKey.length === 0) return;
    void refresh(true);
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refresh(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, connectedKey]);

  const onAction = useEffectEvent((action: MenuBarAction) => {
    if (action.type === "thread") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: action.environmentId, threadId: action.threadId },
      });
      return;
    }
    if (action.type === "refresh") {
      void refresh(false);
      return;
    }
    if (action.type === "usage") {
      void navigate({ to: "/usage" });
      return;
    }
    if (action.type === "settings") {
      void navigate({ to: "/settings/general" });
      return;
    }
    if (action.type === "patch") {
      void updateSettings({ menuBar: { ...getClientSettings().menuBar, ...action.patch } });
    } else if (action.type === "notifications") {
      const apply = () =>
        updateSettings({
          ...(action.enabled !== undefined
            ? { notificationMode: action.enabled ? "notifications" : "off" }
            : {}),
          ...(action.attentionOnly !== undefined
            ? { notificationAttentionOnly: action.attentionOnly }
            : {}),
          ...(action.notifyWhileFocused !== undefined
            ? { notificationWhileFocused: action.notifyWhileFocused }
            : {}),
        });
      if (
        action.enabled &&
        !window.desktopBridge?.showThreadNotification &&
        typeof Notification !== "undefined"
      ) {
        void Notification.requestPermission().then((permission) => {
          if (permission === "granted") void apply();
        });
      } else void apply();
    }
  });
  useEffect(() => window.desktopBridge?.onMenuBarAction?.((action) => onAction(action)), []);

  useEffect(() => {
    if (!hydrated || !window.desktopBridge?.setMenuBarSnapshot) return;
    const connected = new Map(
      [...presentations].filter(([, value]) => value.connection.phase === "connected"),
    );
    const rows: MenuBarUsageRow[] = collectLimitPools(collectLimitAccounts(connected), now).flatMap(
      (pool) =>
        displayLimitWindows(pool).map((window) => ({
          provider: String(pool.driver),
          label: getDriverOption(pool.driver)?.label ?? String(pool.driver),
          window: window.label,
          remainingPercent: Math.max(0, Math.min(100, window.remainingPercent)),
          checkedAt: new Date(
            Math.min(...window.members.map(({ account }) => Date.parse(account.limits.checkedAt))),
          ).toISOString(),
          resetsAt: window.resets[0] ? new Date(window.resets[0].at).toISOString() : null,
          expectedRemainingPercent: evenPaceRemainingPercent(
            window.members.map((member) => member.window),
            now,
          ),
        })),
    );
    const summary = menuBarSummary(rows, settings.menuBar, now);
    const canvas = document.createElement("canvas");
    canvas.width = 36;
    canvas.height = 36;
    const context = canvas.getContext("2d");
    if (context) {
      context.scale(2, 2);
      context.strokeStyle = summary.color;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(9, 9, 6, 0, 2 * Math.PI);
      context.stroke();
      context.fillStyle = summary.color;
      context.beginPath();
      context.arc(9, 9, 3.5, 0, 2 * Math.PI);
      context.fill();
    }
    const notices = [...collectLimitNotices(connected)];
    if ([...presentations.values()].some((value) => value.connection.phase !== "connected"))
      notices.push("Disconnected environments are excluded.");
    void window.desktopBridge
      .setMenuBarSnapshot({
        settings: settings.menuBar,
        rows,
        notices,
        image: context ? canvas.toDataURL("image/png") : null,
        attentionOnly: settings.notificationAttentionOnly,
        notifyWhileFocused: settings.notificationWhileFocused,
        notificationsEnabled: hasDesktopNotifications(settings.notificationMode),
      })
      .catch((error: unknown) => console.error("Could not update menu bar", error));
  }, [hydrated, now, presentations, settings]);
  return null;
}
