import { For, Show, createSignal, onCleanup, type Component } from 'solid-js';
import { useAppContext } from '../context/app-context';
import { colors, getColor } from '../theme';
import { RGBA, SyntaxStyle } from '@opentui/core';

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const LoadingSpinner: Component = () => {
	const [frameIndex, setFrameIndex] = createSignal(0);

	const interval = setInterval(() => {
		setFrameIndex((prev) => (prev + 1) % spinnerFrames.length);
	}, 80);

	onCleanup(() => clearInterval(interval));

	return <text fg={colors.success}>{spinnerFrames[frameIndex()]} </text>;
};

export const Messages: Component = () => {
	const appState = useAppContext();

	const syntaxStyle = SyntaxStyle.fromStyles({
		// Headings
		'markup.heading.1': { fg: RGBA.fromHex(colors.accent), bold: true },
		'markup.heading.2': { fg: RGBA.fromHex(colors.accent), bold: true },
		'markup.heading.3': { fg: RGBA.fromHex(colors.accent), bold: true },
		'markup.heading.4': { fg: RGBA.fromHex(colors.accent), bold: true },
		'markup.heading.5': { fg: RGBA.fromHex(colors.accent), bold: true },
		'markup.heading.6': { fg: RGBA.fromHex(colors.accent), bold: true },
		'markup.heading': { fg: RGBA.fromHex(colors.accent), bold: true },

		// Text formatting
		'markup.bold': { fg: RGBA.fromHex(colors.text), bold: true },
		'markup.italic': { fg: RGBA.fromHex(colors.text), italic: true },
		'markup.strikethrough': { fg: RGBA.fromHex(colors.textMuted) },

		// Code
		'markup.raw': { fg: RGBA.fromHex(colors.success) },
		'markup.raw.inline': { fg: RGBA.fromHex(colors.success) },
		'markup.raw.block': { fg: RGBA.fromHex(colors.success) },
		fenced_code_block: { fg: RGBA.fromHex(colors.success) },
		code_fence_content: { fg: RGBA.fromHex(colors.text) },

		// Links
		'markup.link': { fg: RGBA.fromHex(colors.info), underline: true },
		'markup.link.url': { fg: RGBA.fromHex(colors.info), underline: true },
		'markup.link.text': { fg: RGBA.fromHex(colors.info) },
		'string.other.link': { fg: RGBA.fromHex(colors.info), underline: true },

		// Lists
		'markup.list': { fg: RGBA.fromHex(colors.text) },
		'markup.list.unnumbered': { fg: RGBA.fromHex(colors.text) },
		'markup.list.numbered': { fg: RGBA.fromHex(colors.text) },
		'punctuation.definition.list': { fg: RGBA.fromHex(colors.accent) },

		// Quotes
		'markup.quote': { fg: RGBA.fromHex(colors.textMuted), italic: true },

		// Punctuation (markdown symbols like #, *, etc.)
		'punctuation.definition.heading': { fg: RGBA.fromHex(colors.textSubtle) },
		'punctuation.definition.bold': { fg: RGBA.fromHex(colors.textSubtle) },
		'punctuation.definition.italic': { fg: RGBA.fromHex(colors.textSubtle) },

		// Default
		default: { fg: RGBA.fromHex(colors.text) }
	});

	return (
		<scrollbox
			style={{
				flexGrow: 1,
				rootOptions: {
					border: true,
					borderColor: colors.border
				},
				contentOptions: {
					flexDirection: 'column',
					padding: 1,
					gap: 2
				},
				stickyScroll: true,
				stickyStart: 'bottom'
			}}
		>
			<For each={appState.messageHistory()}>
				{(m, index) => {
					if (m.role === 'user') {
						return (
							<box style={{ flexDirection: 'column', gap: 1 }}>
								<text fg={colors.accent}>You </text>
								<text>
									<For each={m.content}>
										{(part) => <span style={{ fg: getColor(part.type) }}>{part.content}</span>}
									</For>
								</text>
							</box>
						);
					}
					if (m.role === 'system') {
						return (
							<box style={{ flexDirection: 'column', gap: 1 }}>
								<text fg={colors.info}>SYS </text>
								<text fg={colors.text} content={`${m.content}`} />
							</box>
						);
					}
					if (m.role === 'assistant') {
						const isLastAssistant = () => {
							const history = appState.messageHistory();
							for (let i = history.length - 1; i >= 0; i--) {
								if (history[i]?.role === 'assistant') {
									return i === index();
								}
							}
							return false;
						};
						const isStreaming = () => appState.mode() === 'loading' && isLastAssistant();

						return (
							<box style={{ flexDirection: 'column', gap: 1 }}>
								<box style={{ flexDirection: 'row' }}>
									<text fg={colors.success}>AI </text>
									<Show when={isStreaming()}>
										<LoadingSpinner />
									</Show>
								</box>
								<Show when={!isStreaming()} fallback={<text>{m.content}</text>}>
									<code filetype="markdown" content={m.content} syntaxStyle={syntaxStyle} />
								</Show>
							</box>
						);
					}
				}}
			</For>
		</scrollbox>
	);
};
