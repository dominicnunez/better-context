import { ensureServer, type ServerManager } from '../server/manager.ts';
import { createClient, getConfig } from '../client/index.ts';
import { setTelemetryContext, trackTelemetryEvent } from '../lib/telemetry.ts';

// Store server reference globally so TUI can access it
declare global {
	// eslint-disable-next-line no-var
	var __BTCA_SERVER__: ServerManager | undefined;
	// eslint-disable-next-line no-var
	var __BTCA_STREAM_OPTIONS__:
		| {
				showThinking: boolean;
				showTools: boolean;
		  }
		| undefined;
}

export interface TuiOptions {
	server?: string;
	port?: number;
	thinking?: boolean;
	tools?: boolean;
	subAgent?: boolean;
}

/**
 * Launch the interactive TUI
 */
export async function launchTui(options: TuiOptions): Promise<void> {
	const server = await ensureServer({
		serverUrl: options.server,
		port: options.port
	});

	try {
		const client = createClient(server.url);
		const config = await getConfig(client);
		setTelemetryContext({ provider: config.provider, model: config.model });
	} catch {
		// Ignore config failures for telemetry
	}

	await trackTelemetryEvent({
		event: 'cli_started',
		properties: { command: 'btca', mode: 'tui' }
	});
	await trackTelemetryEvent({
		event: 'cli_tui_started',
		properties: { command: 'btca', mode: 'tui' }
	});

	// Store server reference for TUI to use
	globalThis.__BTCA_SERVER__ = server;
	globalThis.__BTCA_STREAM_OPTIONS__ = {
		showThinking: options.subAgent ? false : (options.thinking ?? true),
		showTools: options.subAgent ? false : (options.tools ?? true)
	};

	// Import and run TUI (dynamic import to avoid loading TUI deps when not needed)
	await import('../tui/App.tsx');
}
