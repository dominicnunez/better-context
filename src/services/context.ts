import { Effect } from "effect";
import { TaggedError } from "effect/Data";
import { ConfigService } from "./config.ts";
import { expandHome } from "../lib/utils.ts";
import * as fs from "node:fs";
import * as path from "node:path";

class ContextError extends TaggedError("ContextError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const cloneRepo = (repoDir: string, url: string, branch: string) =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(
        ["git", "clone", "--branch", branch, url, repoDir],
        {
          stdout: "inherit",
          stderr: "inherit",
        }
      );
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`git clone failed with exit code ${exitCode}`);
      }
    },
    catch: (error) =>
      new ContextError({ message: "Failed to clone repo", cause: error }),
  });

const pullRepo = (repoDir: string, branch: string) =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["git", "pull", "origin", branch], {
        cwd: repoDir,
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`git pull failed with exit code ${exitCode}`);
      }
    },
    catch: (error) =>
      new ContextError({ message: "Failed to pull repo", cause: error }),
  });

const directoryExists = (dir: string) =>
  Effect.try({
    try: () => fs.existsSync(dir) && fs.statSync(dir).isDirectory(),
    catch: (error) =>
      new ContextError({ message: "Failed to check directory", cause: error }),
  });

const ensureDirectory = (dir: string) =>
  Effect.try({
    try: () => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    },
    catch: (error) =>
      new ContextError({ message: "Failed to create directory", cause: error }),
  });

const contextService = Effect.gen(function* () {
  const config = yield* ConfigService;
  return {
    cloneOrUpdateReposLocally: () =>
      Effect.gen(function* () {
        const configDirectory = yield* config.getConfigDirectory();
        const reposDirectory = expandHome(`${configDirectory}/repos`);

        yield* ensureDirectory(reposDirectory);

        const repos = yield* config.getAllRepos();

        const operations = repos.map((repo) => {
          const repoDir = path.join(reposDirectory, repo.name);
          const branch = repo.branch ?? "main";

          return Effect.gen(function* () {
            const exists = yield* directoryExists(repoDir);
            if (exists) {
              yield* Effect.log(`Pulling latest changes for ${repo.name}...`);
              yield* pullRepo(repoDir, branch);
            } else {
              yield* Effect.log(`Cloning ${repo.name}...`);
              yield* cloneRepo(repoDir, repo.url, branch);
            }
            yield* Effect.log(`Done with ${repo.name}`);
          });
        });

        yield* Effect.all(operations, { concurrency: "unbounded" });
      }),
  };
});

export class ContextService extends Effect.Service<ContextService>()(
  "ContextService",
  {
    scoped: contextService,
    dependencies: [ConfigService.Default],
  }
) {}
