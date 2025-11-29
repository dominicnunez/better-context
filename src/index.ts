import { BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { OcService } from "./services/oc";
import { ContextService } from "./services/context";

const programLayer = Layer.mergeAll(OcService.Default, ContextService.Default);

const program = Effect.gen(function* () {
  yield* Effect.log("STARTING UP...");

  const context = yield* ContextService;
  const oc = yield* OcService;

  yield* context.cloneOrUpdateReposLocally();

  yield* oc.testPrompting(
    "How do I use the new query remote function to fetch data in sveltekit?"
  );
}).pipe(
  Effect.provide(programLayer),
  Effect.catchAll((error) => {
    console.error("Error:", error);
    return Effect.void;
  })
);

BunRuntime.runMain(program);
