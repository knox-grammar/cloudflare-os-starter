// Text modules, matched by the "Text" rule in wrangler.jsonc. `types.txt` is a symlink to
// `types.d.ts`, so the agent-facing API docs ship as a runtime string without being duplicated.
declare module "*.txt" {
  const content: string;
  export default content;
}

declare module "*.svg" {
  const content: string;
  export default content;
}
