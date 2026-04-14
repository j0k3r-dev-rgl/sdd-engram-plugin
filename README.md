# Model Selection Plugin 🚀

Interactive SDD model selection and profile management for [opencode](https://opencode.ai).

## Features

### 1. SDD Profile Management
This plugin allows you to manage [SDD (Spec-Driven Development)](https://github.com/Gentleman-Programming/gentle-ai) profiles from [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) efficiently.

- **Create, Edit, & Delete:** Manage profiles linked to specific models for quick switching.
- **Real-time Activation:** Activate profiles instantly. Changes are applied to `opencode.json` and the active runtime in real-time without needing to restart opencode, ensuring an uninterrupted workflow.

### 2. Engram Project Memories
Full integration with the Engram memory system.

- **List & Read:** Easily browse and read through your project's stored memories.
- **Logical Deletion:** Remove memories (logically) to prevent them from affecting your current project context.

---

## Installation

To install the plugin, add it to your `tui.json` configuration file.

### Configuration Path
If the file doesn't exist, create it at:
`~/.config/opencode/tui.json`

### Content
Add `"model-selection-plugin"` to the `plugin` array:

```json
{
   "$schema": "https://opencode.ai/tui.json",
   "plugin": ["model-selection-plugin"]
}
```

---

## Technical Details

- **Name:** `model-selection-plugin`
- **Engines:** Requires `opencode >= 1.3.13`
- **Peer Dependencies:** `@opencode-ai/plugin`, `@opentui/core`, `@opentui/solid`, `solid-js`.

Developed by [j0k3r-dev-rgl](https://github.com/j0k3r-dev-rgl).
