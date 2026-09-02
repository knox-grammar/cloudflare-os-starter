// Vite+ per-package settings, mirroring packages/custom-gatekeeper/vite.config.ts.
//
// `build` and `build:configurator` are tasks rather than package.json scripts because each reads a
// path it also writes, and vp declines to cache such a task. The configurator build mirrors the
// pinned OS convention, but points at its shared scripts through this wrapper's submodule path.

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

// The Microsoft OAuth scope regression test lives beside its pure mapping module. Keeping it in
// this package prevents the root scripts typecheck from following Worker-only API types.
export default {
  run: {
    tasks: {
      // Generated iframe HTML may embed error-reporting configuration. Always clear stale source
      // map artifacts first, exactly as the shared OS configurator task does.
      'clean:error-reporting-artifacts': {
        command: 'node ../../cloudflare-os/scripts/clean-error-reporting-artifacts.ts .',
        cache: false,
      },
      'build:configurator': {
        command: 'node ../../cloudflare-os/scripts/build-gatekeeper-configurator.ts .',
        dependsOn: ['clean:error-reporting-artifacts'],
        input: [
          { auto: true },
          { pattern: '!**/src/generated/**', base: 'workspace' },
        ],
        output: ['src/generated/**'],
        env: ['VITE_FRONTEND_ERROR_REPORTING'],
      },
      build: {
        command: 'rm -rf .wrangler/validate && tsc',
        dependsOn: ['build:configurator'],
        input: [{ auto: true }, ownDist, ownWranglerValidate],
        output: ['dist/**'],
      },
      test: {
        command: 'vitest run && vitest run -c vitest.worker.config.ts',
        input: [{ auto: true }, ownDist, ownWranglerValidate],
        output: [{ auto: true }, ownDist, ownWranglerValidate],
      },
    },
  },
}
