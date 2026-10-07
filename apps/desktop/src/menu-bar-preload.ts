// @effect-diagnostics globalDate:off - This sandboxed preload renders wall-clock countdown labels without an Effect runtime.
import { ipcRenderer } from "electron";
import type { MenuBarAction, MenuBarSnapshot } from "@t3tools/contracts";
import { renderMenuBarPanel } from "./menuBar/menuBarPanel.ts";
import { MENU_BAR_PANEL_SNAPSHOT_CHANNEL, MENU_BAR_PANEL_ACTION_CHANNEL } from "./ipc/channels.ts";

// This isolated surface exposes no general desktop bridge and executes no page scripts.
window.addEventListener("DOMContentLoaded", () => {
  let snapshot: MenuBarSnapshot | undefined;
  const panel = document.getElementById("panel")!;
  const render = () => {
    if (!snapshot) return;
    const expanded = document.getElementById("display-options")?.hasAttribute("open");
    const scroll = document.querySelector("main")?.scrollTop ?? 0;
    const focus = document.activeElement;
    const focusKey =
      focus instanceof HTMLElement
        ? [...focus.attributes].find((attr) => attr.name.startsWith("data-"))
        : undefined;
    panel.innerHTML = renderMenuBarPanel(snapshot, Date.now());
    if (expanded) document.getElementById("display-options")?.setAttribute("open", "");
    const main = document.querySelector("main");
    if (main) main.scrollTop = scroll;
    if (focusKey)
      document
        .querySelector<HTMLElement>(`[${focusKey.name}="${CSS.escape(focusKey.value)}"]`)
        ?.focus({ preventScroll: true });
  };
  const action = (value: MenuBarAction) => {
    void ipcRenderer
      .invoke(MENU_BAR_PANEL_ACTION_CHANNEL, value)
      .then(() => {
        if (value.type === "refresh")
          document.getElementById("action-status")!.textContent = "Refresh requested";
        if (value.type === "test-notification")
          document.getElementById("action-status")!.textContent = "Test alert requested";
      })
      .catch(() => {
        document.getElementById("action-status")!.textContent =
          "Could not apply change. Try again.";
      });
  };
  panel.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || !snapshot) return;
    const provider = button.dataset.provider;
    if (provider !== undefined) {
      const excluded = snapshot.settings.excludedProviders;
      action({
        type: "patch",
        patch: {
          excludedProviders: excluded.includes(provider)
            ? excluded.filter((id) => id !== provider)
            : [...excluded, provider],
        },
      });
    } else {
      switch (button.dataset.action) {
        case "refresh":
          action({ type: "refresh" });
          break;
        case "usage":
          action({ type: "usage" });
          break;
        case "settings":
          action({ type: "settings" });
          break;
        case "test-notification":
          action({ type: "test-notification" });
          break;
        case "notifications":
          action({ type: "notifications", enabled: !snapshot.notificationsEnabled });
          break;
      }
    }
  });
  panel.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLSelectElement || input instanceof HTMLInputElement)) return;
    const value = input.value;
    if (
      input.dataset.setting === "detail" &&
      (value === "percentage" || value === "provider" || value === "all")
    )
      action({ type: "patch", patch: { detail: value } });
    if (
      input.dataset.setting === "colorMode" &&
      (value === "automatic" || value === "monochrome" || value === "custom")
    )
      action({ type: "patch", patch: { colorMode: value } });
    if (input.dataset.setting === "color") action({ type: "patch", patch: { color: value } });
    if (input.dataset.setting === "warningPercent" || input.dataset.setting === "criticalPercent")
      action({ type: "patch", patch: { [input.dataset.setting]: Number(value) } });
    if (
      input.dataset.setting === "paceWarningPercent" ||
      input.dataset.setting === "paceCriticalPercent"
    )
      action({ type: "patch", patch: { [input.dataset.setting]: Number(value) } });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") action({ type: "dismiss" });
  });
  ipcRenderer.on(MENU_BAR_PANEL_SNAPSHOT_CHANNEL, (_event, value: MenuBarSnapshot) => {
    snapshot = value;
    render();
  });
  ipcRenderer.on("menu-bar:open-settings", () => {
    const options = document.getElementById("display-options");
    options?.setAttribute("open", "");
    options?.scrollIntoView({ block: "nearest" });
  });
  ipcRenderer.on("menu-bar:notification-status", (_event, message: string) => {
    const status = document.getElementById("action-status");
    if (status) status.textContent = message;
  });
  void ipcRenderer.invoke(MENU_BAR_PANEL_SNAPSHOT_CHANNEL).then((value: MenuBarSnapshot) => {
    snapshot = value;
    render();
  });
});
