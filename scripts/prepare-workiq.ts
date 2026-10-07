import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(root, "cloudflare-os");
const patch = resolve(root, "patches/workiq-native-mcp.patch");
const git = (args: string[]) => execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });
if (git(["rev-parse", "HEAD"]).toString().trim() !== "32ce152654e8a205b54e094e31be932c620dbc52") {
  throw new Error("WorkIQ's native extension requires the reviewed Cloudflare OS pin.");
}
try {
  git(["apply", "--reverse", "--check", patch]);
} catch {
  // Only apply a complete clean patch. Never reset, revert or overwrite unrelated local changes.
  git(["apply", "--check", patch]);
  git(["apply", patch]);
}
