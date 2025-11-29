import { createOpencode } from "@opencode-ai/sdk";
import { Duration, Effect } from "effect";
import { TaggedError } from "effect/Data";
import { ConfigService } from "./config";

class OcError extends TaggedError("OcError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const ocService = Effect.gen(function* () {
  const config = yield* ConfigService;
  const agentPromptPath = yield* config.getDocsAgentPromptPath();
  const configObject = yield* config.getOpenCodeConfig({ agentPromptPath });

  const { client, server } = yield* Effect.tryPromise({
    try: () =>
      createOpencode({
        port: 3420,
        config: configObject,
      }),
    catch: (err) =>
      new OcError({ message: "FAILED TO CREATE OPENCODE CLIENT", cause: err }),
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      console.log("CLOSING OPENCODE SERVER");
      server.close();
    })
  );

  return {
    testPrompting: (prompt: string) =>
      Effect.gen(function* () {
        const session = yield* Effect.promise(() => client.session.create());

        if (session.error) {
          return yield* Effect.fail(
            new OcError({
              message: "FAILED TO START OPENCODE SESSION",
              cause: session.error,
            })
          );
        }

        yield* Effect.log(`PROMPTING WITH: ${prompt}`);

        const resp = yield* Effect.promise(() =>
          client.session.prompt({
            path: { id: session.data.id },
            body: {
              agent: "docs",
              model: {
                providerID: "opencode",
                modelID: "claude-haiku-4-5",
              },
              parts: [{ type: "text", text: prompt }],
            },
          })
        );

        if (resp.error) {
          return yield* Effect.fail(
            new OcError({
              message: "FAILED TO TEST PROMPTING",
              cause: resp.error,
            })
          );
        }

        resp.data.parts.forEach((part) => {
          if (part.type === "text") {
            console.log(part.text);
          }
        });

        console.log("\n--- PROMPT COMPLETE ---");

        return null;
      }),
  };
});

export class OcService extends Effect.Service<OcService>()("OcService", {
  scoped: ocService,
  dependencies: [ConfigService.Default],
}) {}
