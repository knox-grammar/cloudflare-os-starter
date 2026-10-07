import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patch = resolve(root, "patches/workiq-native-mcp.patch");
const pin = "32ce152654e8a205b54e094e31be932c620dbc52";

test("the WorkIQ extension applies to the exact pinned source and preserves unrelated edits", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "knox-workiq-patch-"));
  try {
    for (const file of ["packages/mcp-shared/src/account.ts", "packages/mcp-shared/src/tools.ts"]) {
      const original = execFileSync("git", ["-C", resolve(root, "cloudflare-os"), "show", `${pin}:${file}`]);
      const destination = resolve(fixture, file);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, `${original}\n// Unrelated fixture edit, preserve it.\n`);
    }
    const apply = (args: string[]) => execFileSync("git", ["apply", ...args, patch], { cwd: fixture, stdio: "pipe" });
    apply(["--check"]);
    apply([]);
    apply(["--reverse", "--check"]);
    const account = readFileSync(resolve(fixture, "packages/mcp-shared/src/account.ts"), "utf8");
    assert.ok(account.includes("protected oauthProvider("));
    assert.ok(account.includes("provider.validateResourceURL"));
    assert.ok(account.includes("Unrelated fixture edit, preserve it."));
    assert.throws(() => apply(["--check"]));
    const tools = readFileSync(resolve(fixture, "packages/mcp-shared/src/tools.ts"), "utf8");
    assert.ok(tools.includes("Requires approval under this deployment's tool policy."));
    assert.ok(tools.includes("Unrelated fixture edit, preserve it."));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
