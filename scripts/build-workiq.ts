import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = "packages/gatekeeper-workiq/.wrangler/validate";
execFileSync(process.execPath, [resolve(root, "scripts/prepare-workiq.ts")], { cwd: root, stdio: "inherit" });
execFileSync("pnpm", ["--filter", "@gadgets/mcp-gatekeeper", "exec", "gadgets-build-configurator", "."], {
  cwd: root, stdio: "inherit",
});
// The wrapper inherits decorated native classes. A package-scoped build skips those imports.
execFileSync("pnpm", ["--filter", "@knox/gatekeeper-workiq", "exec", "capnweb-validate", "build", "--cwd", root,
  "--tsconfig", resolve(root, "packages/gatekeeper-workiq/tsconfig.json"), "--out", resolve(root, output)], {
  cwd: root, stdio: "inherit",
});
const native = "cloudflare-os/packages/gatekeeper-mcp/src";
for (const asset of ["mcp-logo.svg", "generated/server-configurator-ui.txt"]) {
  const destination = resolve(root, output, native, asset);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(root, native, asset), destination);
}

copyFileSync(resolve(root, "packages/gatekeeper-workiq/skill.md"),
  resolve(root, output, "packages/gatekeeper-workiq/skill.md"));
