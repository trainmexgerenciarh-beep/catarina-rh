---
name: SvelteKit 3 setup
description: Configuration and TypeScript conventions for the SvelteKit 3 version used by this project.
---

SvelteKit 3 no longer loads `svelte.config.js`. Pass its options, including the adapter, directly to `sveltekit({...})` in `vite.config.ts`. TypeScript should extend `$app/tsconfig`; `.svelte-kit/tsconfig.json` is not generated in this version.

**Why:** The current packages reject the legacy config file and report a missing generated tsconfig when using older SvelteKit scaffolding.

**How to apply:** Check installed SvelteKit's current diagnostics and package API before copying a SvelteKit 2 setup into this project.
