import type { AgentLoop } from './loop.ts';

export type AgentResult = {
	answer: string;
	model: { provider: string; model: string };
	events: AgentLoop.AgentEvent[];
};
