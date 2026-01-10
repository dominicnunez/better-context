import { Data } from 'effect';

export interface CollectionResult {
	path: string;
	agentInstructions: string;
}

export class CollectionError extends Data.TaggedError('CollectionError')<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export const getCollectionKey = (resourceNames: readonly string[]): string => {
	return [...resourceNames].sort().join("+");
};
