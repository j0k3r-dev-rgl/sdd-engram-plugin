# Profile reasoning effort for primary models

This document captures what we verified in opencode runtime metadata and what we want to add to the plugin: per-agent reasoning effort configuration for **primary SDD agents only**.

## Quick path

1. Keep profile model assignment as-is for primary and fallback agents.
2. Add a new `configs` section for primary-agent runtime options.
3. Add UI to edit reasoning effort only when the current model supports it.

## What we verified

| Topic | Finding |
|---|---|
| Model source | The plugin reads provider/model metadata from `api.state.provider[].models`. |
| Capability signal | Models expose `capabilities.reasoning`. |
| Effort source | Valid effort values come from `model.variants[*].reasoningEffort`, not from a flat `effort` field. |
| Variability | Not all models expose the same effort set; some include `none`, others start at `low`. |
| Fallback scope | The requested feature should apply only to primary agents, not fallback agents. |

## Desired profile shape

```json
{
  "models": {
    "sdd-apply": "openai/gpt-5.5"
  },
  "configs": {
    "sdd-apply": {
      "reasoningEffort": "high"
    }
  },
  "fallback": {
    "sdd-apply": "openai/gpt-5.4"
  }
}
```

## Desired behavior

### Profile editing

- Keep the current primary model picker.
- Add a new action such as `Edit reasoning effort` for primary agents.
- Resolve the currently assigned `provider/model`.
- Read runtime metadata from `api.state.provider`.
- If the model supports reasoning and exposes variants with `reasoningEffort`, show only those valid options.
- If the model does not support reasoning effort, show a notification and do not persist invalid config.

### Activation

- Apply `model` exactly as today.
- Apply `configs[agent].reasoningEffort` only for primary agents.
- Do not apply reasoning effort to generated fallback agents unless explicitly designed later.

## Proposed runtime decision rules

| Condition | Behavior |
|---|---|
| No model assigned | Do not show the effort picker; explain that a primary model must be selected first. |
| `capabilities.reasoning !== true` | Show a warning that the selected model does not support reasoning effort. |
| No variants with `reasoningEffort` | Show a warning that no effort variants are available for that model. |
| Variants available | Derive selectable options dynamically from runtime metadata. |

## Risks and constraints

- We must not hardcode a global effort list because model support varies.
- We must preserve backward compatibility for profiles that only contain `models` and `fallback`.
- We must validate `configs` keys so unsupported runtime options are not silently stored forever.
- We need to decide whether changing the model should preserve or clear an incompatible `reasoningEffort` value.

## Implementation direction

1. Extend profile types with `configs` for primary agents.
2. Read/write `configs` from profile files without breaking existing profiles.
3. Add helper logic to resolve available reasoning efforts from model metadata.
4. Add profile detail UI for editing reasoning effort.
5. Apply the chosen `reasoningEffort` during profile activation.
6. Add tests for persistence, capability detection, UI gating, and activation behavior.

## Open questions

- Should incompatible saved `reasoningEffort` values be cleared automatically when the model changes?
- Should the UI expose the raw variant key, the `reasoningEffort` value, or a friendlier label?
- Should `none` be shown as a first-class option when available?
