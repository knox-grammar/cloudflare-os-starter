// Vite+ per-package settings, mirroring packages/custom-gatekeeper/vite.config.ts.
//
// `build` and `test` are tasks rather than package.json scripts because each reads a path it also
// writes, and vp declines to cache such a task: `tsc` emits into `dist/`, which automatic tracking
// otherwise counts as an input of the same package. vp forbids a task and a script sharing a name,
// so there are no `build`/`test` scripts -- `vp run -F gatekeeper-microsoft <task>` replaces them.

// This package's own `tsc` output. Package-relative, not workspace-wide: a sibling's `dist/` may be
// a real input via its `exports`.
const ownDist = { pattern: '!dist/**', base: 'package' } as const

// `wrangler dev --dry-run` (run by `pnpm check`) regenerates this via capnweb-validate as a plain
// copy of src/, mixed with its own compiled output. Excluding it from `{ auto: true }` keeps it out
// of this task's cache fingerprint, but doesn't stop plain `tsc` from picking its files up as extra
// compile targets -- confirmed by reproducing the failure with `tsc` alone, no vp involved. tsc
// somehow treats `.wrangler/validate/src` as matching this tsconfig's `include: ["src"]`, despite
// `.wrangler` also being in `exclude`. Whatever the exact cause, deleting it before every build
// (harmless -- wrangler regenerates it whenever it's next needed) is the reliable fix.
const ownWranglerValidate = { pattern: '!.wrangler/**', base: 'package' } as const

// No `test` task yet: there are no test files under src/ (see plans/gatekeeper-microsoft.md).
// `vitest run` exits 1 on an empty suite, which would fail `vp run --filter '!cloudflare-os-starter'
// --cache test` for every package. Add the task back (see packages/custom-gatekeeper/vite.config.ts
// for the shape) once real tests exist.
export default {
  run: {
    tasks: {
      build: {
        command: 'rm -rf .wrangler/validate && tsc',
        input: [{ auto: true }, ownDist, ownWranglerValidate],
        output: ['dist/**'],
      },
    },
  },
}
