import type { Event as OcEvent, OpencodeClient } from "@opencode-ai/sdk";

export interface AgentResult {
	answer: string;
	model: { provider: string; model: string };
	events: OcEvent[];
}

export interface SessionState {
	client: OpencodeClient;
	server: { close: () => void; url: string };
	sessionID: string;
	collectionPath: string;
}

export { type OcEvent };
