import * as Schema from "effect/Schema";
import { EnvironmentId, ThreadId } from "./baseSchemas.ts";

const percent = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const color = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/i));
export const MenuBarSettings = Schema.Struct({
  enabled: Schema.Boolean,
  detail: Schema.Literals(["percentage", "provider", "all"]),
  colorMode: Schema.Literals(["monochrome", "threshold", "custom"]),
  color,
  warningPercent: percent,
  criticalPercent: percent,
  excludedProviders: Schema.Array(Schema.String),
  keepRunning: Schema.Boolean,
});
export type MenuBarSettings = typeof MenuBarSettings.Type;
export const DEFAULT_MENU_BAR_SETTINGS: MenuBarSettings = {
  enabled: true,
  detail: "provider",
  colorMode: "threshold",
  color: "#8b5cf6",
  warningPercent: 25,
  criticalPercent: 10,
  excludedProviders: [],
  keepRunning: true,
};
export const MenuBarUsageRow = Schema.Struct({
  provider: Schema.String,
  label: Schema.String,
  window: Schema.String,
  remainingPercent: percent,
  checkedAt: Schema.String,
  resetsAt: Schema.NullOr(Schema.String),
  expectedRemainingPercent: Schema.optionalKey(Schema.NullOr(percent)),
});
export type MenuBarUsageRow = typeof MenuBarUsageRow.Type;
export const MenuBarSnapshot = Schema.Struct({
  settings: MenuBarSettings,
  rows: Schema.Array(MenuBarUsageRow),
  notices: Schema.Array(Schema.String),
  image: Schema.NullOr(
    Schema.String.check(
      Schema.isMaxLength(16384),
      Schema.isPattern(/^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i),
    ),
  ),
  attentionOnly: Schema.Boolean,
  notifyWhileFocused: Schema.Boolean,
  notificationsEnabled: Schema.Boolean,
});
export type MenuBarSnapshot = typeof MenuBarSnapshot.Type;
export const DesktopThreadNotification = Schema.Struct({
  title: Schema.String.check(Schema.isMaxLength(180)),
  body: Schema.String.check(Schema.isMaxLength(500)),
  target: Schema.NullOr(Schema.Struct({ environmentId: EnvironmentId, threadId: ThreadId })),
});
export type DesktopThreadNotification = typeof DesktopThreadNotification.Type;
export const MenuBarAction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("thread"),
    environmentId: EnvironmentId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literals(["usage", "settings", "refresh", "dismiss", "test-notification"]),
  }),
  Schema.Struct({
    type: Schema.Literal("patch"),
    patch: Schema.Struct({
      enabled: Schema.optionalKey(MenuBarSettings.fields.enabled),
      detail: Schema.optionalKey(MenuBarSettings.fields.detail),
      colorMode: Schema.optionalKey(MenuBarSettings.fields.colorMode),
      color: Schema.optionalKey(color),
      warningPercent: Schema.optionalKey(percent),
      criticalPercent: Schema.optionalKey(percent),
      excludedProviders: Schema.optionalKey(MenuBarSettings.fields.excludedProviders),
      keepRunning: Schema.optionalKey(MenuBarSettings.fields.keepRunning),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("notifications"),
    enabled: Schema.optionalKey(Schema.Boolean),
    attentionOnly: Schema.optionalKey(Schema.Boolean),
    notifyWhileFocused: Schema.optionalKey(Schema.Boolean),
  }),
]);
export type MenuBarAction = typeof MenuBarAction.Type;
