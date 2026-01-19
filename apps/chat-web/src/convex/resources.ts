import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import { AnalyticsEvents } from './analyticsEvents';

export const listGlobal = query({
	args: {},
	handler: async (ctx) => {
		const resources = await ctx.db.query('globalResources').collect();
		return resources.filter((r) => r.isActive);
	}
});

export const listUserResources = query({
	args: { instanceId: v.id('instances') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();
	}
});

export const listAvailable = query({
	args: { instanceId: v.id('instances') },
	handler: async (ctx, args) => {
		const globalResources = await ctx.db.query('globalResources').collect();
		const userResources = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();

		const global = globalResources
			.filter((r) => r.isActive)
			.map((r) => ({
				name: r.name,
				displayName: r.displayName,
				type: r.type,
				url: r.url,
				branch: r.branch,
				searchPath: r.searchPath,
				specialNotes: r.specialNotes,
				isGlobal: true as const
			}));

		const custom = userResources.map((r) => ({
			name: r.name,
			displayName: r.name,
			type: r.type,
			url: r.url,
			branch: r.branch,
			searchPath: r.searchPath,
			specialNotes: r.specialNotes,
			isGlobal: false as const
		}));

		return { global, custom };
	}
});

export const addCustomResource = mutation({
	args: {
		instanceId: v.id('instances'),
		name: v.string(),
		url: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const instance = await ctx.db.get(args.instanceId);

		const resourceId = await ctx.db.insert('userResources', {
			instanceId: args.instanceId,
			name: args.name,
			type: 'git',
			url: args.url,
			branch: args.branch,
			searchPath: args.searchPath,
			specialNotes: args.specialNotes,
			createdAt: Date.now()
		});

		if (instance) {
			await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: instance.clerkId,
				event: AnalyticsEvents.RESOURCE_ADDED,
				properties: {
					instanceId: args.instanceId,
					resourceId,
					resourceName: args.name,
					resourceUrl: args.url,
					hasBranch: args.branch !== 'main',
					hasSearchPath: !!args.searchPath,
					hasNotes: !!args.specialNotes
				}
			});
		}

		return resourceId;
	}
});

export const removeCustomResource = mutation({
	args: { resourceId: v.id('userResources') },
	handler: async (ctx, args) => {
		const resource = await ctx.db.get(args.resourceId);
		const instance = resource ? await ctx.db.get(resource.instanceId) : null;

		await ctx.db.delete(args.resourceId);

		if (instance && resource) {
			await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: instance.clerkId,
				event: AnalyticsEvents.RESOURCE_REMOVED,
				properties: {
					instanceId: resource.instanceId,
					resourceId: args.resourceId,
					resourceName: resource.name
				}
			});
		}
	}
});
