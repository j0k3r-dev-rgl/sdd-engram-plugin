# opencode-sdd-engram-manage 🚀

Interactive SDD model selection and profile management for [opencode](https://opencode.ai).

## Features

### 1. SDD Profile Management

Manage [SDD (Spec-Driven Development)](https://github.com/Gentleman-Programming/gentle-ai) profiles from [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) directly from the opencode TUI.

- **Create:** Snapshot the current `opencode.json` SDD agent configuration as a named profile.
- **Activate:** Apply a saved profile to the global runtime config instantly — no restart required. Changes are live immediately.
- **Edit Models:** Pick a different provider/model for any agent or fallback directly from the UI.
- **Rename & Delete:** Full lifecycle management for your profiles.
- **Per-Agent Fallbacks:** Configure a fallback model per `sdd-*` base agent (except `sdd-orchestrator`). On activation, the plugin ensures `sdd-*-fallback` agents exist and stay in sync with their base agent config. Primary models are applied first, so you can define new agents and their fallbacks in a single profile activation.
- **Active Profile Detection:** The plugin automatically detects and highlights which profile matches the current config.

#### Profile Format

Profiles are stored as JSON files under `~/.config/opencode/profiles/`:

```json
{
  "models": {
    "sdd-init": "openai/gpt-4o",
    "sdd-spec": "anthropic/claude-sonnet-4-6",
    "sdd-apply": "anthropic/claude-sonnet-4-6"
  },
  "fallback": {
    "sdd-init": "google/gemini-flash-2.0",
    "sdd-apply": "openai/gpt-4o-mini"
  }
}
```

- `models`: primary model per base `sdd-*` agent.
- `fallback`: optional fallback model override per base agent name. If omitted, the fallback agent inherits the base model.

Legacy flat format is also supported for backwards compatibility:

```json
{
  "sdd-init": "openai/gpt-4o",
  "sdd-apply": "anthropic/claude-sonnet-4-6"
}
```

---

### 2. Engram Project Memories

Full integration with the [Engram](https://github.com/Gentleman-Programming/gentle-ai) memory system.

- **List:** Browse all stored observations for the current project (resolved across git remote, git root, and cwd aliases).
- **Read:** View full memory content, type, scope, and timestamp.
- **Delete:** Logically remove a memory to prevent it from affecting the current session context.

---

## Installation

Add the plugin to your `tui.json`:

```
~/.config/opencode/tui.json
```

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-sdd-engram-manage"]
}
```

---

## Usage

Open the plugin with:

- **Shortcut:** `Alt + K`
- **Slash command:** `/sdd-model`

### Workflow

1. Open the plugin (`Alt+K` or `/sdd-model`).
2. **Create a profile** from the current config, or **Manage Profiles** to activate one.
3. From the profile detail, click any agent to change its model (provider → model picker).
4. Click any fallback entry to override its model.
5. **Activate** to apply the profile to the live runtime.

---

## Screenshots

This is what users will see after installing the plugin:

### Main entry and profile management

<p align="center">
  <img src="docs/images/captura1.png" alt="Main plugin menu" width="720" />
</p>

<p align="center">
  <img src="docs/images/captura2.png" alt="Profile management screen" width="720" />
</p>

<p align="center">
  <img src="docs/images/captura3.png" alt="Profile detail screen" width="720" />
</p>

<p align="center">
  <img src="docs/images/captura4.png" alt="Agent model selection" width="720" />
</p>

<p align="center">
  <img src="docs/images/captura5.png" alt="Fallback model configuration" width="720" />
</p>

### Engram memory browser

<p align="center">
  <img src="docs/images/captura6.png" alt="Project memories access" width="720" />
</p>

<p align="center">
  <img src="docs/images/captura6-memory.png" alt="Project memories list" width="720" />
</p>

<p align="center">
  <img src="docs/images/captura6-memory-detail.png" alt="Memory detail view" width="720" />
</p>

### Profile JSON preview

<p align="center">
  <img src="docs/images/captura7-json.png" alt="Profile JSON preview" width="720" />
</p>

---

## Orchestrator Fallback Policy Script

This repo includes a script to ensure the `sdd-orchestrator` prompt contains the fallback policy block required for `sdd-*-fallback` agents to work correctly when a primary sub-agent fails.

- **Script:** `scripts/ensure-orchestrator-fallback-policy.ts`
- **Supports:** Inline prompt text in `opencode.json` and external `{file:...}` references.

```bash
# Check mode (no changes)
npm run orchestrator:fallback:check

# Apply changes
npm run orchestrator:fallback:apply

# Custom config path
node ./scripts/ensure-orchestrator-fallback-policy.ts --config /path/to/opencode.json
```

---

## Example Fixtures & Smoke Validation

Under `examples/`:

- `opencode-inline.json` — inline orchestrator prompt config
- `opencode-external.json` + `sdd-orchestrator-example.md` — external prompt file config
- `profiles/*.json` — profile payloads in new and legacy formats

Run smoke validation:

```bash
npm run examples
```

Validates:
1. Fallback policy injection for inline and external prompt configs.
2. Profile fixture readability for new (`models` + `fallback`) and legacy formats.

---

## Development

### Running Tests

```bash
npm test
```

**Test coverage:**
- `src/profiles.test.ts` — profile read/write, fallback sync, validation, activation logic
- `src/memories.test.ts` — memory listing, deletion, normalization, sqlite query escaping
- `src/utils.test.ts` — formatting helpers, agent naming predicates, model resolution
- `src/config.test.ts` — path resolution, XDG support, project name detection
- `scripts/ensure-orchestrator-fallback-policy.test.ts` — fallback policy injection logic

### Automated Releases

Uses `semantic-release` on pushes to `main`. See [docs/publish.md](docs/publish.md) for the full publish workflow and commit conventions.

---

## Technical Details

- **Package:** `opencode-sdd-engram-manage`
- **Current version:** see [CHANGELOG.md](CHANGELOG.md) or [npm](https://www.npmjs.com/package/opencode-sdd-engram-manage)
- **Requires:** `opencode >= 1.3.13`
- **Peer dependencies:** `@opencode-ai/plugin ^1.4.9`, `@opentui/core ^0.1.100`, `@opentui/solid ^0.1.100`, `solid-js`

Developed by [j0k3r-dev-rgl](https://github.com/j0k3r-dev-rgl).
