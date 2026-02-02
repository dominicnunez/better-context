import { Command } from 'commander';
import { getTelemetryStatus, setTelemetryEnabled } from '../lib/telemetry.ts';

const formatStatus = (status: {
	envDisabled: boolean;
	enabled: boolean;
	distinctId: string | null;
}) => {
	if (status.envDisabled) {
		return 'Telemetry is disabled via BTCA_TELEMETRY=0.';
	}
	if (!status.enabled) {
		return 'Telemetry is disabled.';
	}
	return `Telemetry is enabled.\nAnonymous ID: ${status.distinctId ?? 'pending'}`;
};

export const telemetryCommand = new Command('telemetry').description(
	'Manage anonymous CLI telemetry'
);

const telemetryOn = new Command('on').description('Enable anonymous telemetry').action(async () => {
	const config = await setTelemetryEnabled(true);
	console.log('Telemetry enabled.');
	console.log(`Anonymous ID: ${config.distinctId}`);
});

const telemetryOff = new Command('off')
	.description('Disable anonymous telemetry')
	.action(async () => {
		await setTelemetryEnabled(false);
		console.log('Telemetry disabled.');
	});

const telemetryStatus = new Command('status')
	.description('Show telemetry status')
	.action(async () => {
		const status = await getTelemetryStatus();
		console.log(formatStatus(status));
	});

telemetryCommand.addCommand(telemetryOn);
telemetryCommand.addCommand(telemetryOff);
telemetryCommand.addCommand(telemetryStatus);
