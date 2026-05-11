/** @jsxImportSource @opentui/solid */
import type { ActiveProfileState, BadgeDisplayMode } from "./src/types";
import { formatContext } from "./src/utils";

export function formatActiveModelBadgeText(
  profile: ActiveProfileState | null | undefined,
  displayMode: BadgeDisplayMode = "model",
): string {
  if (!profile) return "No SDD model active";
  const profileName =
    typeof profile.profileName === "string" ? profile.profileName.trim() : "";
  const useProfileLabel = displayMode === "profile" && profileName.length > 0;
  const label = useProfileLabel ? profileName : profile.modelName;
  const effortLabel = typeof profile.reasoningEffort === "string" && profile.reasoningEffort.trim()
    ? ` · effort: ${profile.reasoningEffort.trim()}`
    : "";
  return `${label} · ${formatContext(profile.contextLimit)}${effortLabel}`;
}

/**
 * UI Badge component that displays information about the active SDD model
 *
 * @param props.profile - The currently active profile state
 * @param props.theme - The current UI theme configuration
 * @param props.displayMode - "model" (default) shows model info; "profile" shows profile name
 */
export function ActiveModelBadge(props: {
  profile: ActiveProfileState | null | undefined;
  theme: any;
  displayMode?: BadgeDisplayMode;
}) {
  return (
    <box flexDirection="row" alignItems="center" paddingLeft={1} paddingRight={1}>
      <text
        fg={
          props.profile
            ? props.theme?.primary || "#00ff00"
            : props.theme?.textMuted || "#888"
        }
        attributes={props.profile ? 1 : 0}
      >
        {props.profile ? "󰚩 " : "󱚧 "}
      </text>
      <text fg={props.theme?.text || "inherit"}>
        {formatActiveModelBadgeText(props.profile, props.displayMode)}
      </text>
    </box>
  );
}
