---
name: SvelteKit 3 setup
description: Configuration and TypeScript conventions for the SvelteKit 3 version used by this project.
---

SvelteKit 3 no longer loads `svelte.config.js`. Pass its options, including the adapter, directly to `sveltekit({...})` in `vite.config.ts`. TypeScript should extend `$app/tsconfig`; `.svelte-kit/tsconfig.json` is not generated in this version.

**Why:** The current packages reject the legacy config file and report a missing generated tsconfig when using older SvelteKit scaffolding.

**How to apply:** Check installed SvelteKit's current diagnostics and package API before copying a SvelteKit 2 setup into this project.

## Reactive selects need browser verification

Dynamic select options inside an `each` block that reference `form[field.key]`
can make the legacy-reactivity compiler hoist `field` outside its scope during
form invalidation. Both type checking and compilation passed, but opening the
form raised `ReferenceError` in the browser. A concrete form key avoided this.

**Why:** Static checks did not detect this runtime-only compiler interaction.

**How to apply:** Browser-test opening and changing dynamic selects after
refactoring forms; prefer explicit keys or an isolated select component rather
than assuming a successful build proves these bindings work.
