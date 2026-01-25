'use node';

import { v } from 'convex/values';

import { api } from './_generated/api';
import { action } from './_generated/server';
import { instances } from './apiHelpers';

const instanceActions = instances.actions;
const instanceMutations = instances.mutations;

type AskResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * MCP ask action - called from the SvelteKit MCP endpoint.
 * Authentication is done via API key - the caller must provide a valid API key
 * which is validated here to get the instanceId.
 */
export const ask = action({
	args: {
		apiKey: v.string(),
		question: v.string(),
		resources: v.array(v.string())
	},
	handler: async (ctx, args): Promise<AskResult> => {
		const { apiKey, question, resources } = args;

		// Validate API key and get instanceId
		const validation = await ctx.runQuery(api.apiKeys.validate, { apiKey });
		if (!validation.valid) {
			return { ok: false as const, error: validation.error };
		}

		const instanceId = validation.userId;

		// Get instance
		const instance = await ctx.runQuery(instances.internalQueries.getInternal, { id: instanceId });
		if (!instance) {
			return { ok: false as const, error: 'Instance not found' };
		}

		// Touch API key usage
		await ctx.runMutation(api.apiKeys.touchLastUsed, { keyId: validation.keyId });

		const availableResources: {
			global: { name: string }[];
			custom: { name: string }[];
		} = await ctx.runQuery(api.resources.listAvailableInternal, { instanceId });
		const allResourceNames: string[] = [
			...availableResources.global.map((r: { name: string }) => r.name),
			...availableResources.custom.map((r: { name: string }) => r.name)
		];

		const invalidResources: string[] = resources.filter(
			(r: string) => !allResourceNames.includes(r)
		);
		if (invalidResources.length > 0) {
			return {
				ok: false as const,
				error: `Invalid resources: ${invalidResources.join(', ')}. Use listResources to see available resources.`
			};
		}

		if (instance.state === 'error') {
			return { ok: false as const, error: 'Instance is in an error state' };
		}

		if (instance.state === 'provisioning' || instance.state === 'unprovisioned') {
			return { ok: false as const, error: 'Instance is still provisioning' };
		}

		let serverUrl = instance.serverUrl;
		if (instance.state !== 'running' || !serverUrl) {
			if (!instance.sandboxId) {
				return { ok: false as const, error: 'Instance does not have a sandbox' };
			}
			const wakeResult = await ctx.runAction(instanceActions.wake, { instanceId });
			serverUrl = wakeResult.serverUrl;
			if (!serverUrl) {
				return { ok: false as const, error: 'Failed to wake instance' };
			}
		}

		const response = await fetch(`${serverUrl}/question`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				question,
				resources,
				quiet: true
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			return { ok: false as const, error: errorText || `Server error: ${response.status}` };
		}

		const result = (await response.json()) as { text?: string };

		await ctx.runMutation(instanceMutations.touchActivity, { instanceId });

		return {
			ok: true as const,
			text: result.text ?? JSON.stringify(result)
		};
	}
});

type ListResourcesResult =
	| { ok: false; error: string }
	| {
			ok: true;
			resources: {
				name: string;
				displayName: string;
				type: string;
				url: string;
				branch: string;
				searchPath: string | undefined;
				specialNotes: string | undefined;
				isGlobal: false;
			}[];
	  };

/**
 * List available resources for MCP - authenticated via API key
 */
export const listResources = action({
	args: {
		apiKey: v.string()
	},
	handler: async (ctx, args): Promise<ListResourcesResult> => {
		const { apiKey } = args;

		// Validate API key and get instanceId
		const validation = await ctx.runQuery(api.apiKeys.validate, { apiKey });
		if (!validation.valid) {
			return { ok: false as const, error: validation.error };
		}

		const instanceId = validation.userId;

		const { custom } = await ctx.runQuery(api.resources.listAvailableInternal, { instanceId });

		return { ok: true as const, resources: custom };
	}
});
