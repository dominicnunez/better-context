import { startServer } from 'btca-server';
import { Effect } from 'effect';
import { createClient, getConfigEffect } from '../client/index.ts';
import { setTelemetryContext, trackTelemetryEvent } from '../lib/telemetry.ts';

const DEFAULT_PORT = 8080;

export const runServeCommand = (options: { port?: number } = {}) =>
	Effect.gen(function* () {
		const commandName = 'serve';
		const startedAt = Date.now();
		const port = options.port ?? DEFAULT_PORT;

		try {
			yield* Effect.sync(() => console.log(`Starting btca server on port ${port}...`));
			const server = yield* Effect.tryPromise(() => startServer({ port }));

			try {
				const client = createClient(server.url);
				const config = yield* getConfigEffect(client);
				yield* Effect.sync(() =>
					setTelemetryContext({ provider: config.provider, model: config.model })
				);
			} catch {
				// Ignore config failures for telemetry
			}

			yield* Effect.tryPromise(() =>
				trackTelemetryEvent({
					event: 'cli_started',
					properties: { command: commandName, mode: 'serve' }
				})
			);
			yield* Effect.tryPromise(() =>
				trackTelemetryEvent({
					event: 'cli_server_started',
					properties: { command: commandName, mode: 'serve' }
				})
			);
			yield* Effect.sync(() => {
				console.log(`btca server running at ${server.url}`);
				console.log('Press Ctrl+C to stop');
			});

			yield* Effect.tryPromise(
				() =>
					new Promise<void>((resolve) => {
						const shutdown = () => {
							console.log('\nShutting down server...');
							process.off('SIGINT', shutdown);
							process.off('SIGTERM', shutdown);
							server.stop();
							resolve();
						};

						process.on('SIGINT', shutdown);
						process.on('SIGTERM', shutdown);
					})
			);
			yield* Effect.tryPromise(() =>
				trackTelemetryEvent({
					event: 'cli_server_completed',
					properties: {
						command: commandName,
						mode: 'serve',
						durationMs: Date.now() - startedAt,
						exitCode: 0
					}
				})
			);
		} catch (error) {
			yield* Effect.tryPromise(() =>
				trackTelemetryEvent({
					event: 'cli_server_failed',
					properties: {
						command: commandName,
						mode: 'serve',
						durationMs: Date.now() - startedAt,
						errorName: error instanceof Error ? error.name : 'UnknownError',
						exitCode: 1
					}
				})
			);
			return yield* Effect.fail(error);
		}
	});
