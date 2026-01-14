import { z } from 'zod';

// Chunk types for streaming responses (matching CLI types)
export interface TextChunk {
	type: 'text';
	id: string;
	text: string;
}

export interface ReasoningChunk {
	type: 'reasoning';
	id: string;
	text: string;
}

export interface ToolChunk {
	type: 'tool';
	id: string;
	toolName: string;
	state: 'pending' | 'running' | 'completed';
}

export interface FileChunk {
	type: 'file';
	id: string;
	filePath: string;
}

export type BtcaChunk = TextChunk | ReasoningChunk | ToolChunk | FileChunk;

// Resource types
export interface Resource {
	name: string;
	type: 'git' | 'local';
	url?: string;
	branch?: string;
	path?: string;
	searchPath?: string;
	specialNotes?: string;
}

// Message types
export type AssistantContent =
	| { type: 'text'; content: string }
	| { type: 'chunks'; chunks: BtcaChunk[] };

export type Message =
	| {
			id: string;
			role: 'user';
			content: string;
			resources: string[];
	  }
	| {
			id: string;
			role: 'assistant';
			content: AssistantContent;
			canceled?: boolean;
	  }
	| {
			id: string;
			role: 'system';
			content: string;
	  };

// Session types
export interface ChatSession {
	id: string;
	sandboxId: string;
	serverUrl: string;
	messages: Message[];
	threadResources: string[];
	createdAt: Date;
	lastActivityAt: Date;
	status: 'pending' | 'creating' | 'cloning' | 'starting' | 'active' | 'error' | 'destroyed';
	error?: string;
}

// Stream event types (from btca server - matching apps/server/src/stream/types.ts)
const BtcaModelSchema = z.object({
	provider: z.string(),
	model: z.string()
});

const BtcaCollectionInfoSchema = z.object({
	key: z.string(),
	path: z.string()
});

const BtcaToolStateSchema = z.object({
	status: z.enum(['pending', 'running', 'completed', 'error']),
	input: z.record(z.unknown()).optional(),
	output: z.string().optional(),
	title: z.string().optional(),
	metadata: z.record(z.unknown()).optional(),
	error: z.string().optional(),
	raw: z.string().optional(),
	time: z
		.object({
			start: z.number(),
			end: z.number().optional(),
			compacted: z.number().optional()
		})
		.optional()
});

export const BtcaStreamEventSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('meta'),
		model: BtcaModelSchema,
		resources: z.array(z.string()),
		collection: BtcaCollectionInfoSchema
	}),
	z.object({
		type: z.literal('text.delta'),
		delta: z.string()
	}),
	z.object({
		type: z.literal('reasoning.delta'),
		delta: z.string()
	}),
	z.object({
		type: z.literal('tool.updated'),
		callID: z.string(),
		tool: z.string(),
		state: BtcaToolStateSchema
	}),
	z.object({
		type: z.literal('done'),
		text: z.string(),
		reasoning: z.string(),
		tools: z.array(
			z.object({
				callID: z.string(),
				tool: z.string(),
				state: BtcaToolStateSchema
			})
		)
	}),
	z.object({
		type: z.literal('error'),
		tag: z.string(),
		message: z.string()
	})
]);

export type BtcaStreamEvent = z.infer<typeof BtcaStreamEventSchema>;

// Command palette types
export type CommandMode = 'add-resource' | 'switch-session' | 'clear' | 'destroy-sandbox';

export interface Command {
	name: string;
	description: string;
	mode: CommandMode;
	shortcut?: string;
}

export const COMMANDS: Command[] = [
	{
		name: 'Clear Chat',
		description: 'Clear the current chat messages',
		mode: 'clear',
		shortcut: 'Ctrl+L'
	},
	{
		name: 'Switch Session',
		description: 'Switch to a different chat session',
		mode: 'switch-session',
		shortcut: 'Ctrl+K'
	},
	{
		name: 'Destroy Sandbox',
		description: 'Destroy the current sandbox and end the session',
		mode: 'destroy-sandbox'
	}
];

// Cancel state
export type CancelState = 'none' | 'pending';
