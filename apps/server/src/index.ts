import {
	HttpRouter,
	HttpServer,
	HttpServerRequest,
	HttpServerResponse
} from "@effect/platform";
import { BunContext, BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer, Schema } from "effect";
import { Agent, AgentLive } from "./agent/index.ts";
import { CollectionError, Collections, CollectionsLive, getCollectionKey } from "./collections/index.ts";
import { Config, ConfigLive } from "./config/index.ts";
import { ResourcesLive } from "./resources/index.ts";

const ServerLayer = BunHttpServer.layer({ port: 8080 });

const QuestionRequestSchema = Schema.Struct({
	question: Schema.String,
	resources: Schema.optional(Schema.Array(Schema.String)),
	quiet: Schema.optional(Schema.Boolean)
});

type QuestionRequest = typeof QuestionRequestSchema.Type;

const jsonResponse = (body: unknown, status = 200) =>
	HttpServerResponse.json(body, { status }).pipe(
		Effect.mapError((cause) => new Error(String(cause))),
		Effect.orDie
	);

const decodeQuestionRequest = (input: unknown): Effect.Effect<QuestionRequest, CollectionError> =>
	Schema.decodeUnknown(QuestionRequestSchema)(input).pipe(
		Effect.mapError(
			(cause) =>
				new CollectionError({
					message: "Invalid request body",
					cause
				})
		)
	);

const errorToResponse = (error: unknown) => {
	const tag =
		error && typeof error === "object" && "_tag" in error
			? String((error as any)._tag)
			: "UnknownError";
	const message =
		error && typeof error === "object" && "message" in error
			? String((error as any).message)
			: String(error);

	const status = tag === "CollectionError" || tag === "ResourceError" ? 400 : 500;
	return jsonResponse({ error: message, tag }, status);
};

const questionHandler = Effect.gen(function* () {
	const req = yield* HttpServerRequest.HttpServerRequest;
	const config = yield* Config;
	const collections = yield* Collections;
	const agent = yield* Agent;

	const body = yield* req.json.pipe(
		Effect.mapError((cause) => new CollectionError({ message: "Failed to parse request JSON", cause }))
	);

	const decoded = yield* decodeQuestionRequest(body);

	const resourceNames =
		decoded.resources && decoded.resources.length > 0
			? decoded.resources
			: config.resources.map((r) => r.name);

	const collection = yield* collections.load({
		resourceNames,
		quiet: decoded.quiet
	});

	const result = yield* agent.ask({
		collection,
		question: decoded.question
	});

	return yield* jsonResponse({
		answer: result.answer,
		model: result.model,
		resources: resourceNames,
		collection: {
			key: getCollectionKey(resourceNames),
			path: collection.path
		}
	});
}).pipe(Effect.catchAll(errorToResponse));

const PlatformLayer = BunContext.layer;

const ConfigLayer = ConfigLive.pipe(Layer.provide(PlatformLayer));
const ResourcesLayer = ResourcesLive.pipe(Layer.provide(ConfigLayer), Layer.provide(PlatformLayer));
const CollectionsLayer = CollectionsLive.pipe(
	Layer.provide(ResourcesLayer),
	Layer.provide(ConfigLayer),
	Layer.provide(PlatformLayer)
);
const AgentLayer = AgentLive.pipe(Layer.provide(ConfigLayer), Layer.provide(PlatformLayer));

const ServicesLayer = Layer.mergeAll(ConfigLayer, ResourcesLayer, CollectionsLayer, AgentLayer);
const MainLayer = Layer.mergeAll(ServerLayer, ServicesLayer);

const httpLive = HttpRouter.empty.pipe(
	HttpRouter.get("/", jsonResponse({ ok: true, service: "btca-server" })),
	HttpRouter.post("/question", questionHandler),
	HttpServer.serve(),
	HttpServer.withLogAddress
);

BunRuntime.runMain(Effect.provide(Layer.launch(httpLive), MainLayer));
