import {
	createContext,
	createSignal,
	useContext,
	type Accessor,
	type Component,
	type ParentProps
} from 'solid-js';
import { formatConversationHistory, type ThreadMessage } from '@btca/shared';
import { Result } from 'better-result';

import type { Message, InputState, CancelState, BtcaChunk } from '../types.ts';
import { services, type ChunkUpdate } from '../services.ts';
import { copyToClipboard } from '../clipboard.ts';
import { formatError } from '../lib/format-error.ts';
import { createThread, loadThread, saveThread, type LocalThreadMessage } from '../thread-store.ts';

const formatUsd = (value: number) => {
	const abs = Math.abs(value);
	const decimals = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
	const fixed = value.toFixed(decimals);
	return `$${fixed.replace(/\.?0+$/, '')}`;
};

const formatStreamStats = (done: {
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		reasoningTokens?: number;
		totalTokens?: number;
	};
	metrics?: {
		timing?: { totalMs?: number; genMs?: number };
		throughput?: { outputTokensPerSecond?: number; totalTokensPerSecond?: number };
		pricing?: {
			source: 'models.dev';
			modelKey?: string;
			ratesUsdPerMTokens?: { input?: number; output?: number; reasoning?: number };
			costUsd?: { input?: number; output?: number; reasoning?: number; total?: number };
		};
	};
}) => {
	const parts: string[] = [];

	const pricing = done.metrics?.pricing;
	const costUsd =
		pricing?.costUsd?.total ??
		(() => {
			const pieces = pricing?.costUsd;
			if (!pieces) return undefined;
			const input = pieces.input ?? 0;
			const output = pieces.output ?? 0;
			const reasoning = pieces.reasoning ?? 0;
			const hasAny = pieces.input != null || pieces.output != null || pieces.reasoning != null;
			return hasAny ? input + output + reasoning : undefined;
		})();

	const inTok = done.usage?.inputTokens;
	const outTok = done.usage?.outputTokens;
	const rTok = done.usage?.reasoningTokens;
	const totalTok = done.usage?.totalTokens;
	if (inTok != null || outTok != null || rTok != null || totalTok != null) {
		parts.push(
			[
				`tokens in ${inTok?.toLocaleString() ?? '?'}`,
				`out ${outTok?.toLocaleString() ?? '?'}`,
				`reasoning ${rTok?.toLocaleString() ?? '?'}`,
				`tokens total ${totalTok?.toLocaleString() ?? '?'}`,
				costUsd == null ? undefined : `cost ${formatUsd(costUsd)}`
			]
				.filter(Boolean)
				.join(' | ')
		);
	} else if (costUsd != null) {
		parts.push(`cost ${formatUsd(costUsd)}`);
	}

	const genMs = done.metrics?.timing?.genMs;
	const totalMs = done.metrics?.timing?.totalMs;
	if (genMs != null || totalMs != null) {
		const genS = genMs == null ? '?' : (genMs / 1000).toFixed(2);
		const totalS = totalMs == null ? '?' : (totalMs / 1000).toFixed(2);
		parts.push(`time gen ${genS}s | time total ${totalS}s`);
	}

	const outTps = done.metrics?.throughput?.outputTokensPerSecond;
	if (outTps != null) {
		parts.push(`tps ${outTps.toFixed(1)}`);
	}

	return parts.length > 0 ? `Generation stats: ${parts.join(' || ')}` : null;
};

type MessagesState = {
	// Message history
	messages: Accessor<Message[]>;
	addSystemMessage: (content: string) => void;
	clearMessages: () => void;

	// Thread resources - accumulates @mentions across the conversation
	threadResources: Accessor<string[]>;

	// Streaming state
	isStreaming: Accessor<boolean>;
	cancelState: Accessor<CancelState>;

	// Actions
	send: (input: InputState, newResources: string[]) => Promise<void>;
	requestCancel: () => void;
	confirmCancel: () => Promise<void>;
	resumeThread: (threadId: string) => Promise<void>;
};

const MessagesContext = createContext<MessagesState>();

export const useMessagesContext = () => {
	const context = useContext(MessagesContext);
	if (!context) throw new Error('useMessagesContext must be used within MessagesProvider');
	return context;
};

const defaultMessageHistory: Message[] = [
	{
		role: 'system',
		content:
			"Welcome to btca! Ask anything about the library/framework you're interested in (make sure you @ it first)"
	}
];

export const MessagesProvider: Component<ParentProps> = (props) => {
	const [messages, setMessages] = createSignal<Message[]>(defaultMessageHistory);
	const [threadResources, setThreadResources] = createSignal<string[]>([]);
	const [isStreaming, setIsStreaming] = createSignal(false);
	const [cancelState, setCancelState] = createSignal<CancelState>('none');
	const initialThread = createThread();
	const [threadId, setThreadId] = createSignal<string>(initialThread.id);
	const [threadCreatedAt, setThreadCreatedAt] = createSignal(initialThread.createdAt);

	// Internal helpers for message updates
	const addMessage = (message: Message) => setMessages((prev) => [...prev, message]);

	const addChunkToLastAssistant = (chunk: BtcaChunk) => {
		setMessages((prev) => {
			const newHistory = [...prev];
			for (let i = newHistory.length - 1; i >= 0; i--) {
				const msg = newHistory[i];
				if (
					msg?.role === 'assistant' &&
					typeof msg.content === 'object' &&
					msg.content.type === 'chunks'
				) {
					newHistory[i] = {
						role: 'assistant',
						content: { type: 'chunks', chunks: [...msg.content.chunks, chunk] }
					};
					break;
				}
			}
			return newHistory;
		});
	};

	const updateChunkInLastAssistant = (id: string, updates: Partial<BtcaChunk>) => {
		setMessages((prev) => {
			const newHistory = [...prev];
			for (let i = newHistory.length - 1; i >= 0; i--) {
				const msg = newHistory[i];
				if (
					msg?.role === 'assistant' &&
					typeof msg.content === 'object' &&
					msg.content.type === 'chunks'
				) {
					const updatedChunks = msg.content.chunks.map((c: BtcaChunk): BtcaChunk => {
						if (c.id !== id) return c;
						if (c.type === 'text' && 'text' in updates) {
							return { ...c, text: updates.text as string };
						}
						if (c.type === 'reasoning' && 'text' in updates) {
							return { ...c, text: updates.text as string };
						}
						if (c.type === 'tool' && 'state' in updates) {
							return { ...c, state: updates.state as 'pending' | 'running' | 'completed' };
						}
						return c;
					});
					newHistory[i] = {
						role: 'assistant',
						content: { type: 'chunks', chunks: updatedChunks }
					};
					break;
				}
			}
			return newHistory;
		});
	};

	const markLastAssistantMessageCanceled = () => {
		setMessages((prev) => {
			const newHistory = [...prev];
			for (let i = newHistory.length - 1; i >= 0; i--) {
				const msg = newHistory[i];
				if (msg?.role === 'assistant') {
					newHistory[i] = { ...msg, canceled: true };
					break;
				}
			}
			return newHistory;
		});
	};

	const toStoredMessages = (items: Message[]): LocalThreadMessage[] => {
		const now = Date.now();
		return items.map((message) => {
			if (message.role === 'user') {
				return {
					role: 'user',
					content: message.content.map((s) => s.content).join(''),
					createdAt: now
				};
			}
			if (message.role === 'assistant') {
				return {
					role: 'assistant',
					content: message.content,
					canceled: message.canceled,
					createdAt: now
				};
			}
			return {
				role: 'system',
				content: message.content,
				createdAt: now
			};
		});
	};

	const toUiMessages = (items: LocalThreadMessage[]): Message[] => {
		return items.map((message) => {
			if (message.role === 'user') {
				return {
					role: 'user',
					content: [{ type: 'text', content: String(message.content) }]
				};
			}
			if (message.role === 'assistant') {
				return {
					role: 'assistant',
					content: message.content,
					canceled: message.canceled
				};
			}
			return { role: 'system', content: message.content };
		});
	};

	const buildThreadSnapshot = () => ({
		id: threadId(),
		createdAt: threadCreatedAt(),
		lastActivityAt: Date.now(),
		resources: threadResources(),
		messages: toStoredMessages(messages())
	});

	const persistCurrentThread = async () => {
		const snapshot = buildThreadSnapshot();
		await saveThread(snapshot);
	};

	const startNewThread = async () => {
		const next = createThread();
		setThreadId(next.id);
		setThreadCreatedAt(next.createdAt);
		setMessages(defaultMessageHistory);
		setThreadResources([]);
		await persistCurrentThread();
	};

	const handleChunkUpdate = (update: ChunkUpdate) => {
		if (update.type === 'add') {
			addChunkToLastAssistant(update.chunk);
		} else {
			updateChunkInLastAssistant(update.id, update.chunk);
		}
	};

	/**
	 * Convert local TUI messages to ThreadMessage format for history building.
	 * The TUI uses InputState for user messages, which needs to be flattened to string.
	 */
	const convertToThreadMessages = (): ThreadMessage[] => {
		return messages()
			.filter(
				(m): m is Exclude<Message, { role: 'system' }> =>
					m.role === 'user' || m.role === 'assistant'
			)
			.map((m): ThreadMessage => {
				if (m.role === 'user') {
					// Flatten InputState segments to plain string
					return {
						role: 'user',
						content: m.content.map((s) => s.content).join('')
					};
				}
				// Assistant messages - content is already compatible with ThreadMessage
				return {
					role: 'assistant',
					content: m.content,
					canceled: m.canceled
				};
			});
	};

	// Main send method
	const send = async (input: InputState, newResources: string[]) => {
		// Keep @mentions in the question - they provide context about what the user is asking about
		const question = input
			.map((s) => s.content)
			.join('')
			.trim()
			.replace(/\s+/g, ' ');

		// Accumulate new resources into thread resources
		const currentResources = threadResources();
		const updatedResources = [...new Set([...currentResources, ...newResources])];
		setThreadResources(updatedResources);

		// Convert messages to thread format for history building (before adding new message)
		const threadMessages = convertToThreadMessages();

		// Add user message
		addMessage({ role: 'user', content: input });

		// Add placeholder assistant message
		addMessage({ role: 'assistant', content: { type: 'chunks', chunks: [] } });

		setIsStreaming(true);
		setCancelState('none');

		// Build the full question with history using shared formatting
		const questionWithHistory = formatConversationHistory(threadMessages, question);

		const result = await Result.tryPromise(async () => {
			const result = await services.askQuestion(
				updatedResources,
				questionWithHistory,
				handleChunkUpdate
			);
			const finalChunks = result.chunks;

			// Check if canceled during streaming
			if (cancelState() === 'pending') return;

			if (result.doneEvent) {
				const stats = formatStreamStats(result.doneEvent);
				if (stats) addMessage({ role: 'system', content: stats });
			}

			const textChunks = finalChunks.filter((c) => c.type === 'text');
			const fullResponse = textChunks.map((c) => c.text).join('\n\n');

			if (fullResponse) {
				await copyToClipboard(fullResponse);
				addMessage({ role: 'system', content: 'Answer copied to clipboard!' });
			}
		});
		if (result.isErr() && cancelState() !== 'pending') {
			addMessage({ role: 'system', content: `Error: ${formatError(result.error)}` });
		}
		setIsStreaming(false);
		setCancelState('none');
		const persistResult = await Result.tryPromise(persistCurrentThread);
		if (persistResult.isErr()) {
			addMessage({ role: 'system', content: `Error: ${formatError(persistResult.error)}` });
		}
	};

	const requestCancel = () => {
		if (cancelState() === 'none') {
			setCancelState('pending');
		}
	};

	const confirmCancel = async () => {
		await services.cancelCurrentRequest();
		markLastAssistantMessageCanceled();
		addMessage({ role: 'system', content: 'Request canceled.' });
		setIsStreaming(false);
		setCancelState('none');
		const persistResult = await Result.tryPromise(persistCurrentThread);
		if (persistResult.isErr()) {
			addMessage({ role: 'system', content: `Error: ${formatError(persistResult.error)}` });
		}
	};

	const clearMessages = () => {
		void (async () => {
			const persistResult = await Result.tryPromise(persistCurrentThread);
			if (persistResult.isErr()) {
				addMessage({ role: 'system', content: `Error: ${formatError(persistResult.error)}` });
				return;
			}
			const resetResult = await Result.tryPromise(startNewThread);
			if (resetResult.isErr()) {
				addMessage({ role: 'system', content: `Error: ${formatError(resetResult.error)}` });
			}
		})();
	};

	const resumeThread = async (nextThreadId: string) => {
		if (nextThreadId === threadId()) return;
		const persistResult = await Result.tryPromise(persistCurrentThread);
		if (persistResult.isErr()) {
			addMessage({ role: 'system', content: `Error: ${formatError(persistResult.error)}` });
			return;
		}
		const threadResult = await Result.tryPromise(() => loadThread(nextThreadId));
		if (threadResult.isErr()) {
			addMessage({ role: 'system', content: `Error: ${formatError(threadResult.error)}` });
			return;
		}
		const thread = threadResult.value;
		if (!thread) {
			addMessage({ role: 'system', content: 'Thread not found.' });
			return;
		}
		setThreadId(thread.id);
		setThreadCreatedAt(thread.createdAt);
		setMessages(toUiMessages(thread.messages));
		setThreadResources(thread.resources);
	};

	const state: MessagesState = {
		messages,
		addSystemMessage: (content) => addMessage({ role: 'system', content }),
		clearMessages,
		threadResources,
		isStreaming,
		cancelState,
		send,
		requestCancel,
		confirmCancel,
		resumeThread
	};

	queueMicrotask(() => {
		void Result.tryPromise(persistCurrentThread);
	});

	return <MessagesContext.Provider value={state}>{props.children}</MessagesContext.Provider>;
};
