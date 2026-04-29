### Description
`@opencode-ai/plugin@1.14.29` currently pulls a vulnerable runtime dependency chain through `effect`:

- `@opencode-ai/plugin@1.14.29 -> effect@4.0.0-beta.57 -> uuid@13.0.0`

This shows up in downstream `npm audit` results even when the consumer plugin does not use `uuid` directly.

Advisory:

- `uuid` missing buffer bounds check in certain v3/v5/v6 code paths: `GHSA-w5hq-g745-h8pq`

### Plugins
`opencode-sdd-engram-manage`

### OpenCode version
Package-level issue confirmed against `@opencode-ai/plugin@1.14.29`

### Steps to reproduce
1. Install a plugin project that depends on `@opencode-ai/plugin@1.14.29`.
2. Run `npm audit`.
3. Observe the `uuid <14.0.0` advisory via `effect@4.0.0-beta.57`.

### Screenshot and/or share link
Dependency chain verified from a real downstream plugin project:

```text
@opencode-ai/plugin@1.14.29
└─ effect@4.0.0-beta.57
   └─ uuid@13.0.0
```

Additional npm verification:

- latest `uuid` on npm: `14.0.0`
- latest `effect` on npm: `3.21.2`

### Operating System
Ubuntu 24.04

### Terminal
Ghostty
