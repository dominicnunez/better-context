import { mutation } from './_generated/server';
import { create as createInstance } from './instances/mutations';
import { getByClerkId as getInstance } from './instances/queries';
import { getAuthenticatedInstance } from './authHelpers';

export const get = getInstance;

export const getOrCreate = createInstance;

/**
 * Update sandbox activity for the authenticated user's instance
 */
export const updateSandboxActivity = mutation({
	args: {},
	handler: async (ctx) => {
		const instance = await getAuthenticatedInstance(ctx);

		await ctx.db.patch(instance._id, {
			lastActiveAt: Date.now()
		});
	}
});

/**
 * Touch MCP usage for the authenticated user's instance
 */
export const touchMcpUsage = mutation({
	args: {},
	handler: async (ctx) => {
		const instance = await getAuthenticatedInstance(ctx);

		await ctx.db.patch(instance._id, {
			lastActiveAt: Date.now()
		});
	}
});

/**
 * Set MCP sandbox ID for the authenticated user's instance
 */
export const setMcpSandboxId = mutation({
	args: {},
	handler: async (ctx) => {
		const instance = await getAuthenticatedInstance(ctx);

		await ctx.db.patch(instance._id, {
			lastActiveAt: Date.now()
		});
	}
});
