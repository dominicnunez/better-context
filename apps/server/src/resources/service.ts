import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer, Option } from "effect";
import { Config } from "../config/index.ts";
import { ResourceError } from "./helpers.ts";
import { loadGitResource } from "./impls/git.ts";
import type { ResourceDefinition } from "./schema.ts";
import type { BtcaFsResource, BtcaGitResourceArgs } from "./types.ts";

export interface ResourcesService {
	readonly load: (
		name: string,
		options?: {
			quiet?: boolean;
		}
	) => Effect.Effect<BtcaFsResource, ResourceError, FileSystem.FileSystem>;
}

export class Resources extends Context.Tag("btca/Resources")<Resources, ResourcesService>() {}

const definitionToGitArgs = (
	definition: ResourceDefinition,
	resourcesDirectory: string,
	quiet: boolean
): BtcaGitResourceArgs => ({
	type: "git",
	name: definition.name,
	url: definition.url,
	branch: definition.branch,
	repoSubPath: definition.searchPath ?? "",
	resourcesDirectoryPath: resourcesDirectory,
	specialAgentInstructions: definition.specialNotes ?? "",
	quiet
});

export const ResourcesLive = Layer.effect(
	Resources,
	Effect.gen(function* () {
		const config = yield* Config;

		const getDefinition = (name: string) =>
			Option.match(config.getResource(name), {
				onNone: () =>
					Effect.fail(new ResourceError({ message: `Resource \"${name}\" not found in config` })),
				onSome: (definition) => Effect.succeed(definition)
			});

		return {
			load: (name, options) =>
				Effect.gen(function* () {
					const quiet = options?.quiet ?? false;
					const definition = yield* getDefinition(name);

					switch (definition.type) {
						case "git": {
							const args = definitionToGitArgs(definition, config.resourcesDirectory, quiet);
							return yield* loadGitResource(args);
						}
						default: {
							return yield* Effect.fail(
								new ResourceError({
									message: `Unsupported resource type: ${(definition as any).type}`
								})
							);
						}
					}
				})
		};
	})
);
