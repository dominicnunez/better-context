import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import { AnalyticsEvents } from './analyticsEvents';
import { getAuthenticatedInstance, requireApiKeyOwnership } from './authHelpers';

/**
 * List API keys for the authenticated user's instance
 */
export const list = query({
	args: {},
	handler: async (ctx) => {
		const instance = await getAuthenticatedInstance(ctx);

		const keys = await ctx.db
			.query('apiKeys')
			.withIndex('by_instance', (q) => q.eq('instanceId', instance._id))
			.collect();

		return keys.map((k) => ({
			_id: k._id,
			name: k.name,
			keyPrefix: k.keyPrefix,
			createdAt: k.createdAt,
			lastUsedAt: k.lastUsedAt,
			revokedAt: k.revokedAt,
			usageCount: k.usageCount ?? 0
		}));
	}
});

/**
 * Create an API key for the authenticated user's instance
 */
export const create = mutation({
	args: {
		name: v.string()
	},
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);

		const key = generateApiKey();
		const keyHash = await hashApiKey(key);
		const keyPrefix = key.slice(0, 8);

		const id = await ctx.db.insert('apiKeys', {
			instanceId: instance._id,
			name: args.name,
			keyHash,
			keyPrefix,
			createdAt: Date.now()
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.API_KEY_CREATED,
			properties: {
				instanceId: instance._id,
				keyId: id,
				keyName: args.name
			}
		});

		return { id, key };
	}
});

function generateApiKey(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = 'btca_';
	for (let i = 0; i < 32; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

/**
 * Revoke an API key owned by the authenticated user
 */
export const revoke = mutation({
	args: { keyId: v.id('apiKeys') },
	handler: async (ctx, args) => {
		const { apiKey, instance } = await requireApiKeyOwnership(ctx, args.keyId);

		await ctx.db.patch(args.keyId, {
			revokedAt: Date.now()
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.API_KEY_REVOKED,
			properties: {
				instanceId: apiKey.instanceId,
				keyId: args.keyId
			}
		});
	}
});

/**
 * Validate an API key (internal use - no auth required as this validates the key itself)
 */
export const validate = query({
	args: { apiKey: v.string() },
	handler: async (ctx, args) => {
		const keyHash = await hashApiKey(args.apiKey);

		const key = await ctx.db
			.query('apiKeys')
			.withIndex('by_key_hash', (q) => q.eq('keyHash', keyHash))
			.first();

		if (!key) {
			return { valid: false as const, error: 'Invalid API key' };
		}

		if (key.revokedAt) {
			return { valid: false as const, error: 'API key has been revoked' };
		}

		const instance = await ctx.db.get(key.instanceId);
		if (!instance) {
			return { valid: false as const, error: 'User not found' };
		}

		return {
			valid: true as const,
			keyId: key._id,
			userId: key.instanceId,
			clerkId: instance.clerkId
		};
	}
});

/**
 * Touch last used timestamp for an API key (internal use for tracking)
 */
export const touchLastUsed = mutation({
	args: { keyId: v.id('apiKeys') },
	handler: async (ctx, args) => {
		const apiKey = await ctx.db.get(args.keyId);
		const instance = apiKey ? await ctx.db.get(apiKey.instanceId) : null;

		const currentCount = apiKey?.usageCount ?? 0;

		await ctx.db.patch(args.keyId, {
			lastUsedAt: Date.now(),
			usageCount: currentCount + 1
		});

		if (instance && apiKey) {
			await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: instance.clerkId,
				event: AnalyticsEvents.API_KEY_USED,
				properties: {
					instanceId: apiKey.instanceId,
					keyId: args.keyId,
					usageCount: currentCount + 1
				}
			});
		}
	}
});

async function hashApiKey(apiKey: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(apiKey);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
