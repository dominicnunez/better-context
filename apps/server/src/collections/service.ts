import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import { Config } from "../config/index.ts";
import { Resources } from "../resources/service.ts";
import { FS_RESOURCE_SYSTEM_NOTE, type BtcaFsResource } from "../resources/types.ts";
import { CollectionError, getCollectionKey, type CollectionResult } from "./types.ts";

export interface CollectionsService {
	readonly load: (
		args: {
			resourceNames: readonly string[];
			quiet?: boolean;
		}
	) => Effect.Effect<CollectionResult, CollectionError, FileSystem.FileSystem | Path.Path>;
}

export class Collections extends Context.Tag("btca/Collections")<Collections, CollectionsService>() {}

const createCollectionInstructionBlock = (resource: BtcaFsResource): string => {
	const lines = [
		`## Resource: ${resource.name}`,
		FS_RESOURCE_SYSTEM_NOTE,
		`Path: ./${resource.name}`,
		resource.repoSubPath ? `Focus: ./${resource.name}/${resource.repoSubPath}` : "",
		resource.specialAgentInstructions ? `Notes: ${resource.specialAgentInstructions}` : ""
	].filter(Boolean);

	return lines.join("\n");
};

export const CollectionsLive = Layer.effect(
	Collections,
	Effect.gen(function* () {
		const config = yield* Config;
		const resources = yield* Resources;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		return {
			load: ({ resourceNames, quiet = false }) =>
				Effect.gen(function* () {
					const uniqueNames = Array.from(new Set(resourceNames));
					if (uniqueNames.length === 0) {
						return yield* Effect.fail(
							new CollectionError({ message: "Cannot create collection with no resources" })
						);
					}

					const sortedNames = [...uniqueNames].sort((a, b) => a.localeCompare(b));
					const key = getCollectionKey(sortedNames);
					const collectionPath = path.join(config.collectionsDirectory, key);

					yield* fs
						.makeDirectory(collectionPath, { recursive: true })
						.pipe(
							Effect.mapError(
								(cause) =>
									new CollectionError({
										message: "Failed to create collection directory",
										cause
									})
							)
						);

					const loadedResources: BtcaFsResource[] = [];
					for (const name of sortedNames) {
						const resource = yield* resources
							.load(name, { quiet })
							.pipe(
								Effect.mapError(
									(cause) =>
										new CollectionError({
											message: `Failed to load resource ${name}`,
											cause
										})
								)
							);
						loadedResources.push(resource);
					}

					for (const resource of loadedResources) {
						const resourcePath = yield* resource.getAbsoluteDirectoryPath.pipe(
							Effect.mapError(
								(cause) =>
									new CollectionError({
										message: `Failed to get path for ${resource.name}`,
										cause
									})
							)
						);

						const linkPath = path.join(collectionPath, resource.name);
						const linkExists = yield* fs
							.exists(linkPath)
							.pipe(Effect.orElseSucceed(() => false));

						if (linkExists) {
							yield* fs
								.remove(linkPath, { recursive: true, force: true })
								.pipe(
									Effect.mapError(
										(cause) =>
											new CollectionError({
												message: `Failed to remove existing entry for ${resource.name}`,
												cause
											})
									)
								);
						}

						yield* fs.symlink(resourcePath, linkPath).pipe(
							Effect.mapError(
								(cause) =>
									new CollectionError({
										message: `Failed to create symlink for ${resource.name}`,
										cause
									})
							)
						);
					}

					const headerBlock = [
						"## Collection",
						"You are running inside the collection directory.",
						"Only use relative paths within '.' and never use '..' or absolute paths.",
						"Do not leave the collection directory."
					].join("\n");

					const instructionBlocks = loadedResources.map(createCollectionInstructionBlock);

					return {
						path: collectionPath,
						agentInstructions: [headerBlock, ...instructionBlocks].join("\n\n")
					};
				})
		};
	})
);
