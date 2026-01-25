import { v } from 'convex/values';

import { internal } from './_generated/api';
import { mutation, query } from './_generated/server';
import { requireMessageOwnership, requireThreadOwnership } from './authHelpers';

// BtcaChunk validator (same as in schema)
const btcaChunkValidator = v.union(
	v.object({
		type: v.literal('text'),
		id: v.string(),
		text: v.string()
	}),
	v.object({
		type: v.literal('reasoning'),
		id: v.string(),
		text: v.string()
	}),
	v.object({
		type: v.literal('tool'),
		id: v.string(),
		toolName: v.string(),
		state: v.union(v.literal('pending'), v.literal('running'), v.literal('completed'))
	}),
	v.object({
		type: v.literal('file'),
		id: v.string(),
		filePath: v.string()
	})
);

// Message content validator
const messageContentValidator = v.union(
	v.string(),
	v.object({
		type: v.literal('chunks'),
		chunks: v.array(btcaChunkValidator)
	})
);

/**
 * Add a user message to a thread (requires ownership)
 */
export const addUserMessage = mutation({
	args: {
		threadId: v.id('threads'),
		content: v.string(),
		resources: v.array(v.string())
	},
	handler: async (ctx, args) => {
		const { thread } = await requireThreadOwnership(ctx, args.threadId);

		// Check if thread needs a title generated (first message)
		const shouldGenerateTitle = !thread.title;

		// Add the message
		const messageId = await ctx.db.insert('messages', {
			threadId: args.threadId,
			role: 'user',
			content: args.content,
			resources: args.resources,
			createdAt: Date.now()
		});

		// Update thread resources (add new ones)
		const existingResources = await ctx.db
			.query('threadResources')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		const existingNames = new Set(existingResources.map((r) => r.resourceName));

		for (const resourceName of args.resources) {
			if (!existingNames.has(resourceName)) {
				await ctx.db.insert('threadResources', {
					threadId: args.threadId,
					resourceName
				});
			}
		}

		// Touch the thread
		await ctx.db.patch(args.threadId, { lastActivityAt: Date.now() });

		// Schedule title generation for first message
		if (shouldGenerateTitle) {
			await ctx.scheduler.runAfter(0, internal.threadTitle.generateAndUpdateTitle, {
				threadId: args.threadId,
				firstMessage: args.content
			});
		}

		return messageId;
	}
});

/**
 * Add an assistant message to a thread (requires ownership)
 */
export const addAssistantMessage = mutation({
	args: {
		threadId: v.id('threads'),
		content: messageContentValidator,
		canceled: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		await requireThreadOwnership(ctx, args.threadId);

		const messageId = await ctx.db.insert('messages', {
			threadId: args.threadId,
			role: 'assistant',
			content: args.content,
			canceled: args.canceled,
			createdAt: Date.now()
		});

		// Touch the thread
		await ctx.db.patch(args.threadId, { lastActivityAt: Date.now() });

		return messageId;
	}
});

/**
 * Add a system message to a thread (requires ownership)
 */
export const addSystemMessage = mutation({
	args: {
		threadId: v.id('threads'),
		content: v.string()
	},
	handler: async (ctx, args) => {
		await requireThreadOwnership(ctx, args.threadId);

		return await ctx.db.insert('messages', {
			threadId: args.threadId,
			role: 'system',
			content: args.content,
			createdAt: Date.now()
		});
	}
});

/**
 * Get all messages for a thread (requires ownership)
 */
export const getByThread = query({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
		await requireThreadOwnership(ctx, args.threadId);

		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		return messages.sort((a, b) => a.createdAt - b.createdAt);
	}
});

/**
 * Update an assistant message (requires ownership)
 */
export const updateAssistantMessage = mutation({
	args: {
		messageId: v.id('messages'),
		content: messageContentValidator
	},
	handler: async (ctx, args) => {
		await requireMessageOwnership(ctx, args.messageId);
		await ctx.db.patch(args.messageId, { content: args.content });
	}
});

/**
 * Mark an assistant message as canceled (requires ownership)
 */
export const markCanceled = mutation({
	args: { messageId: v.id('messages') },
	handler: async (ctx, args) => {
		await requireMessageOwnership(ctx, args.messageId);
		await ctx.db.patch(args.messageId, { canceled: true });
	}
});

/**
 * Delete a message and all messages after it in the thread (requires ownership)
 */
export const deleteMessageAndAfter = mutation({
	args: {
		threadId: v.id('threads'),
		messageId: v.id('messages')
	},
	handler: async (ctx, args) => {
		await requireThreadOwnership(ctx, args.threadId);

		const targetMessage = await ctx.db.get(args.messageId);
		if (!targetMessage || targetMessage.threadId !== args.threadId) {
			throw new Error('Message not found in thread');
		}

		const allMessages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		const messagesToDelete = allMessages.filter((m) => m.createdAt >= targetMessage.createdAt);

		for (const message of messagesToDelete) {
			await ctx.db.delete(message._id);
		}

		return { deletedCount: messagesToDelete.length };
	}
});
