/** @jsxImportSource @opentui/solid */
// @ts-nocheck

import { createMemo } from "solid-js";
import { formatContext } from "./src/utils";

export function formatActiveModelBadgeText(profile: any): string {
  if (!profile) return "No SDD model active";
  const effortLabel = typeof profile.reasoningEffort === "string" && profile.reasoningEffort.trim()
    ? ` · effort: ${profile.reasoningEffort.trim()}`
    : "";
  return `${profile.modelName} · ${formatContext(profile.contextLimit)}${effortLabel}`;
}

/**
 * UI Badge component that displays information about the active SDD model
 * 
 * @param props.profile - The currently active profile state
 * @param props.theme - The current UI theme configuration
 */
export function ActiveModelBadge(props: { profile: any; theme: any }) {
  const text = createMemo(() => formatActiveModelBadgeText(props.profile));

  const color = createMemo(() => props.profile 
    ? (props.theme?.primary || "#00ff00") 
    : (props.theme?.textMuted || "#888"));

  const icon = createMemo(() => props.profile ? "󰚩 " : "󱚧 ");

  return (
    <box flexDirection="row" alignItems="center" padding={{ left: 1, right: 1 }}>
      <text fg={color()} bold={props.profile ? true : false}>
        {icon()}
      </text>
      <text fg={props.theme?.text || "inherit"}>
        {text()}
      </text>
    </box>
  );
}
