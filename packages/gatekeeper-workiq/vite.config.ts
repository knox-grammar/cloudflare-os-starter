import { withVitestTask } from "@gadgets/scripts/vitest-task";

const config = withVitestTask({ run: { tasks: {
  "prepare:mcp-ui": { command: "pnpm run prepare:shared && pnpm run build:ui", cache: false },
} } }, ["vitest run", "vitest run -c vitest.worker.config.ts", "pnpm run test:bundle"]);
export default {
  ...config,
  run: { tasks: { ...config.run!.tasks,
    test: { ...config.run!.tasks!.test as object, dependsOn: ["prepare:mcp-ui"] },
  } },
};
