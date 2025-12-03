import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { CliService } from "./services/cli.ts";

Effect.gen(function* () {
  const cli = yield* CliService;
  yield* cli.run(process.argv);
}).pipe(
  Effect.provide(CliService.Default),
  Effect.provide(BunContext.layer),
  BunRuntime.runMain
);
