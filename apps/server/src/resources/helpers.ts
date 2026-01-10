import { Data } from "effect";

export class ResourceError extends Data.TaggedError("ResourceError")<{
	readonly message: string;
	readonly cause?: unknown;
	readonly stack?: string;
}> {}
