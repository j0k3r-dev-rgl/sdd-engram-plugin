## Description
`@opentui/core@0.2.0` currently publishes vulnerable transitive runtime dependencies that show up in `npm audit` for downstream consumers.

Confirmed dependency chain from a real consumer project:

- `@opentui/core@0.2.0 -> diff@8.0.2`
- `@opentui/core@0.2.0 -> jimp@1.6.0 -> @jimp/core@1.6.0 -> file-type@16.5.4`

Relevant advisories:

- `diff` DoS in `parsePatch` / `applyPatch`: `GHSA-73rr-hh4g-fpgx`
- `file-type` malformed ASF infinite loop: `GHSA-5v7r-6r5c-r473`

## Why this matters
These are runtime dependencies of `@opentui/core`, not only dev tooling, so downstream packages inherit the audit findings even when their own code does not use `diff` or image parsing directly.

## Current published versions verified on npm
- `@opentui/core`: `0.2.0`
- `diff`: latest is `9.0.0`
- `jimp`: latest is `1.6.1`
- `@jimp/core`: latest is `1.6.1`, and it now depends on `file-type: ^21.3.3`
- `file-type`: latest is `22.0.1`

## Steps to reproduce
1. Install `@opentui/core@0.2.0` in a clean Node project.
2. Run `npm audit`.
3. Observe advisories reported through `diff` and `jimp/file-type`.

## Expected behavior
Published `@opentui/core` versions should avoid known vulnerable runtime dependency chains when fixed upstream versions already exist.

## Actual behavior
`@opentui/core@0.2.0` still depends on `diff@8.0.2` and `jimp@1.6.0`, which keeps the vulnerable chain in downstream installs.

## Suggested fix
- Upgrade `diff` to a non-vulnerable version.
- Upgrade `jimp` / `@jimp/core` to a version that pulls a fixed `file-type`.

If helpful, I can provide the exact `npm audit` output and dependency tree from the downstream repro project.
