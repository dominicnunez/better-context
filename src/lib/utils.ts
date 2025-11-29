import * as path from "node:path";
import * as os from "node:os";

// these will be configurable in the future
export const CONFIG_DIRECTORY = "~/.config/btca";
export const REPOS_DIRECTORY = `${CONFIG_DIRECTORY}/repos`;
export const PROMPTS_DIRECTORY = `${CONFIG_DIRECTORY}/prompts`;
export const DOCS_PROMPT_FILENAME = "docs-agent.md";

export const expandHome = (filePath: string): string =>
  filePath.startsWith("~/")
    ? path.join(os.homedir(), filePath.slice(2))
    : filePath;
