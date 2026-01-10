import { FileSystem } from "@effect/platform";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { ResourceDefinitionSchema, type ResourceDefinition } from "../resources/schema.ts";

export const GLOBAL_CONFIG_DIR = '~/.config/btca';
export const GLOBAL_CONFIG_FILENAME = 'btca.config.jsonc';
export const GLOBAL_DATA_DIR = '~/.local/share/btca';
export const PROJECT_CONFIG_FILENAME = 'btca.config.jsonc';
export const PROJECT_DATA_DIR = '.btca';
export const CONFIG_SCHEMA_URL = 'https://btca.dev/btca.schema.json';

export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const DEFAULT_PROVIDER = 'opencode';

export const DEFAULT_RESOURCES: ResourceDefinition[] = [
	{
		name: 'svelte',
		specialNotes:
			'This is the svelte docs website repo, not the actual svelte repo. Focus on the content directory, it has all the markdown files for the docs.',
		type: 'git',
		url: 'https://github.com/sveltejs/svelte.dev',
		branch: 'main',
		searchPath: 'apps/svelte.dev'
	},
	{
		name: 'tailwindcss',
		specialNotes:
			'This is the tailwindcss docs website repo, not the actual tailwindcss repo. Use the docs to answer questions about tailwindcss.',
		type: 'git',
		url: 'https://github.com/tailwindlabs/tailwindcss.com',
		searchPath: 'src/docs',
		branch: 'main'
	},
	{
		type: 'git',
		name: 'nextjs',
		url: 'https://github.com/vercel/next.js',
		branch: 'canary',
		searchPath: 'docs',
		specialNotes:
			'These are the docs for the next.js framework, not the actual next.js repo. Use the docs to answer questions about next.js.'
	}
];

export const StoredConfigSchema = Schema.Struct({
	$schema: Schema.optional(Schema.String),
	resources: Schema.Array(ResourceDefinitionSchema),
	model: Schema.String,
	provider: Schema.String
});

export type StoredConfig = typeof StoredConfigSchema.Type;

export class ConfigError extends Data.TaggedError("ConfigError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface ConfigService {
	readonly resourcesDirectory: string;
	readonly collectionsDirectory: string;
	readonly resources: readonly ResourceDefinition[];
	readonly model: string;
	readonly provider: string;
	readonly getResource: (name: string) => Option.Option<ResourceDefinition>;
}

export class Config extends Context.Tag('btca/Config')<Config, ConfigService>() {}

const expandHome = (path: string): string => {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
	if (path.startsWith('~/')) {
		return home + path.slice(1);
	}
	return path;
};

const stripJsonc = (content: string): string => {
	// Remove // and /* */ comments without touching strings.
	let out = "";
	let i = 0;
	let inString = false;
	let stringQuote: '"' | "'" | null = null;
	let escaped = false;

	while (i < content.length) {
		const ch = content[i] ?? "";
		const next = content[i + 1] ?? "";

		if (inString) {
			out += ch;
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (stringQuote !== null && ch === stringQuote) {
				inString = false;
				stringQuote = null;
			}
			i += 1;
			continue;
		}

		// Line comment
		if (ch === "/" && next === "/") {
			i += 2;
			while (i < content.length && content[i] !== "\n") i += 1;
			continue;
		}

		// Block comment
		if (ch === "/" && next === "*") {
			i += 2;
			while (i < content.length) {
				if (content[i] === "*" && content[i + 1] === "/") {
					i += 2;
					break;
				}
				i += 1;
			}
			continue;
		}

		if (ch === '"' || ch === "'") {
			inString = true;
			stringQuote = ch;
			out += ch;
			i += 1;
			continue;
		}

		out += ch;
		i += 1;
	}

	// Remove trailing commas (outside strings) so JSON.parse can handle JSONC-ish input.
	let normalized = "";
	inString = false;
	stringQuote = null;
	escaped = false;
	i = 0;

	while (i < out.length) {
		const ch = out[i] ?? "";

		if (inString) {
			normalized += ch;
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (stringQuote !== null && ch === stringQuote) {
				inString = false;
				stringQuote = null;
			}
			i += 1;
			continue;
		}

		if (ch === '"' || ch === "'") {
			inString = true;
			stringQuote = ch;
			normalized += ch;
			i += 1;
			continue;
		}

		if (ch === ",") {
			let j = i + 1;
			while (j < out.length && /\s/.test(out[j] ?? "")) j += 1;
			const nextNonWs = out[j] ?? "";
			if (nextNonWs === "]" || nextNonWs === "}") {
				i += 1;
				continue;
			}
		}

		normalized += ch;
		i += 1;
	}

	return normalized.trim();
};

const parseJsonc = (content: string): unknown => {
	return JSON.parse(stripJsonc(content));
};

const createDefaultConfig = (configPath: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		const configDir = configPath.slice(0, configPath.lastIndexOf("/"));
		yield* fs
			.makeDirectory(configDir, { recursive: true })
			.pipe(Effect.mapError((cause) => new ConfigError({ message: "Failed to create config directory", cause })));

		const defaultStored: StoredConfig = {
			$schema: CONFIG_SCHEMA_URL,
			resources: DEFAULT_RESOURCES,
			model: DEFAULT_MODEL,
			provider: DEFAULT_PROVIDER
		};

		yield* fs
			.writeFileString(configPath, JSON.stringify(defaultStored, null, 2))
			.pipe(Effect.mapError((cause) => new ConfigError({ message: "Failed to write default config", cause })));

		return defaultStored;
	});

const loadConfigFromPath = (configPath: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const content = yield* fs
			.readFileString(configPath)
			.pipe(Effect.mapError((cause) => new ConfigError({ message: "Failed to read config", cause })));

		const parsed = yield* Effect.try({
			try: () => parseJsonc(content),
			catch: (cause) => new ConfigError({ message: "Failed to parse config JSONC", cause })
		});

		return yield* Schema.decodeUnknown(StoredConfigSchema)(parsed).pipe(
			Effect.mapError((cause) => new ConfigError({ message: "Invalid config", cause }))
		);
	});

const makeConfigService = (
	stored: StoredConfig,
	resourcesDirectory: string,
	collectionsDirectory: string
): ConfigService => ({
	resourcesDirectory,
	collectionsDirectory,
	resources: stored.resources,
	model: stored.model,
	provider: stored.provider,
	getResource: (name: string) => Option.fromNullable(stored.resources.find((r) => r.name === name))
});

export const ConfigLive = Layer.effect(
	Config,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const cwd = process.cwd();

		const projectConfigPath = `${cwd}/${PROJECT_CONFIG_FILENAME}`;
		const projectConfigExists = yield* fs
			.exists(projectConfigPath)
			.pipe(Effect.mapError((cause) => new ConfigError({ message: "Failed to check project config", cause })));

		if (projectConfigExists) {
			const stored = yield* loadConfigFromPath(projectConfigPath);
			const resourcesDirectory = `${cwd}/${PROJECT_DATA_DIR}/resources`;
			const collectionsDirectory = `${cwd}/${PROJECT_DATA_DIR}/collections`;
			return makeConfigService(stored, resourcesDirectory, collectionsDirectory);
		}

		const globalConfigPath = `${expandHome(GLOBAL_CONFIG_DIR)}/${GLOBAL_CONFIG_FILENAME}`;
		const globalConfigExists = yield* fs
			.exists(globalConfigPath)
			.pipe(Effect.mapError((cause) => new ConfigError({ message: "Failed to check global config", cause })));

		const stored = globalConfigExists
			? yield* loadConfigFromPath(globalConfigPath)
			: yield* createDefaultConfig(globalConfigPath);

		const resourcesDirectory = `${expandHome(GLOBAL_DATA_DIR)}/resources`;
		const collectionsDirectory = `${expandHome(GLOBAL_DATA_DIR)}/collections`;

		return makeConfigService(stored, resourcesDirectory, collectionsDirectory);
	})
);
