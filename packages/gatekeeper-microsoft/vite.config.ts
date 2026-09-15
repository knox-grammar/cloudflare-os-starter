import gatekeeperConfiguratorConfig from "@gadgets/scripts/gatekeeper-configurator";
import { withVitestTask } from "@gadgets/scripts/vitest-task";

/**
 * Shared configurator tasks from the pinned OS, plus this package's two vitest projects.
 *
 * `build` still deletes `.wrangler/validate` before `tsc`. wrangler dry-run leaves a generated
 * tree that tsc otherwise treats as matching `include: ["src"]` despite `.wrangler` being excluded.
 */
export default withVitestTask({
  run: {
    tasks: {
      ...gatekeeperConfiguratorConfig.run.tasks,
      build: {
        command: "rm -rf .wrangler/validate && tsc",
        dependsOn: ["build:configurator"],
      },
    },
  },
}, [
  "vitest run",
  "vitest run -c vitest.worker.config.ts",
]);
