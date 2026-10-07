import * as NodeEvents from "node:events";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  alerts: [] as Array<NodeEvents.EventEmitter & { close: () => void; show: () => void }>,
  showWindow: vi.fn(),
  focusWindow: vi.fn(),
  send: vi.fn(),
}));
vi.mock("electron", async () => {
  const NodeEvents = await import("node:events");
  return {
    Notification: class extends NodeEvents.EventEmitter {
      static isSupported = () => true;
      show = vi.fn();
      close = vi.fn(() => this.emit("close"));
      constructor() {
        super();
        state.alerts.push(this);
      }
    },
    app: { focus: vi.fn() },
    BrowserWindow: {
      getAllWindows: () => [
        {
          isDestroyed: () => false,
          show: state.showWindow,
          focus: state.focusWindow,
          webContents: { getURL: () => "t3code://app/", send: state.send },
        },
      ],
    },
  };
});
import { showNativeThreadNotification } from "./menuBar.ts";

const target = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
};
beforeEach(() => {
  vi.clearAllMocks();
  state.alerts.length = 0;
});
afterEach(() => {
  for (const alert of state.alerts) alert.close();
});
it("restores the main app and opens the exact session when a native alert is clicked", () => {
  showNativeThreadNotification({ title: "Input needed", body: "Test session", target });
  state.alerts[0]!.emit("click");
  expect(state.showWindow).toHaveBeenCalledOnce();
  expect(state.focusWindow).toHaveBeenCalledOnce();
  expect(state.send).toHaveBeenCalledWith("menubar:action", { type: "thread", ...target });
});
it("replaces a previous alert for the same session while keeping other sessions separate", () => {
  showNativeThreadNotification({ title: "Input needed", body: "First", target });
  showNativeThreadNotification({ title: "Approval needed", body: "Second", target });
  expect(state.alerts[0]!.close).toHaveBeenCalledOnce();
  showNativeThreadNotification({
    title: "Input needed",
    body: "Other",
    target: { ...target, threadId: ThreadId.make("thread-2") },
  });
  expect(state.alerts[1]!.close).not.toHaveBeenCalled();
});
