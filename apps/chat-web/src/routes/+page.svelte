<script lang="ts">
	import {
		MessageSquare,
		Plus,
		Trash2,
		Loader2,
		Send,
		XCircle,
		ChevronRight,
		Server,
		GitBranch,
		Zap
	} from '@lucide/svelte';
	import type { Message, BtcaChunk, CancelState, ChatSession } from '$lib/types';
	import { nanoid } from 'nanoid';
	import { marked } from 'marked';
	import { createHighlighter } from 'shiki';

	// Session state
	let sessions = $state<
		{
			id: string;
			status: string;
			createdAt: string;
			messageCount: number;
			threadResources: string[];
		}[]
	>([]);
	let currentSessionId = $state<string | null>(null);
	let currentSession = $state<{
		id: string;
		status: string;
		serverUrl: string;
		messages: Message[];
		threadResources: string[];
	} | null>(null);

	// UI state
	let isCreatingSession = $state(false);
	let isLoadingSession = $state(false);
	let isStreaming = $state(false);
	let sandboxStatus = $state<string | null>(null);
	let cancelState = $state<CancelState>('none');
	let inputValue = $state('');
	let availableResources = $state<{ name: string; type: string }[]>([]);
	let showSessionList = $state(true);

	// Streaming state
	let currentChunks = $state<BtcaChunk[]>([]);
	let abortController: AbortController | null = null;

	// Load sessions on mount
	$effect(() => {
		loadSessions();
	});

	async function loadSessions() {
		try {
			const response = await fetch('/api/sessions');
			const data = (await response.json()) as {
				sessions: typeof sessions;
			};
			sessions = data.sessions;
		} catch (error) {
			console.error('Failed to load sessions:', error);
		}
	}

	async function createNewSession() {
		isCreatingSession = true;
		try {
			const response = await fetch('/api/sessions', { method: 'POST' });
			const data = (await response.json()) as {
				id: string;
				error?: string;
			};

			if (!response.ok) {
				throw new Error(data.error ?? 'Failed to create session');
			}

			await loadSessions();
			await loadSession(data.id);
		} catch (error) {
			console.error('Failed to create session:', error);
			alert(error instanceof Error ? error.message : 'Failed to create session');
		} finally {
			isCreatingSession = false;
		}
	}

	async function loadSession(sessionId: string) {
		isLoadingSession = true;
		try {
			const response = await fetch(`/api/sessions/${sessionId}`);
			const data = (await response.json()) as typeof currentSession & { error?: string };

			if (!response.ok) {
				throw new Error(data?.error ?? 'Failed to load session');
			}

			currentSession = data;
			currentSessionId = sessionId;
			showSessionList = false;

			// Load available resources
			await loadResources();
		} catch (error) {
			console.error('Failed to load session:', error);
			alert(error instanceof Error ? error.message : 'Failed to load session');
		} finally {
			isLoadingSession = false;
		}
	}

	async function loadResources() {
		if (!currentSessionId) return;
		try {
			const response = await fetch(`/api/sessions/${currentSessionId}/resources`);
			const data = (await response.json()) as {
				resources: typeof availableResources;
			};
			availableResources = data.resources;
		} catch (error) {
			console.error('Failed to load resources:', error);
		}
	}

	async function destroySession(sessionId: string) {
		if (!confirm('Are you sure you want to destroy this session?')) return;

		try {
			await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
			await loadSessions();

			if (currentSessionId === sessionId) {
				currentSession = null;
				currentSessionId = null;
				showSessionList = true;
			}
		} catch (error) {
			console.error('Failed to destroy session:', error);
		}
	}

	async function clearChat() {
		if (!currentSessionId) return;
		try {
			await fetch(`/api/sessions/${currentSessionId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'clear' })
			});
			await loadSession(currentSessionId);
		} catch (error) {
			console.error('Failed to clear chat:', error);
		}
	}

	// Parse @mentions from input
	function parseMentions(input: string): { resources: string[]; question: string } {
		const mentionRegex = /@(\w+)/g;
		const resources: string[] = [];
		let match;
		while ((match = mentionRegex.exec(input)) !== null) {
			resources.push(match[1]!);
		}
		const question = input.replace(mentionRegex, '').trim();
		return { resources: [...new Set(resources)], question };
	}

	async function sendMessage() {
		if (!currentSessionId || !currentSession || isStreaming || !inputValue.trim()) return;

		const { resources: mentionedResources, question } = parseMentions(inputValue);
		const threadResources = currentSession.threadResources || [];

		// Validate resources
		if (mentionedResources.length === 0 && threadResources.length === 0) {
			alert('Please @mention a resource first (e.g., @svelte)');
			return;
		}

		if (!question.trim()) {
			alert('Please enter a question after the @mention');
			return;
		}

		// Validate mentioned resources exist
		const validResources: string[] = [];
		const invalidResources: string[] = [];
		for (const res of mentionedResources) {
			const found = availableResources.find((r) => r.name.toLowerCase() === res.toLowerCase());
			if (found) validResources.push(found.name);
			else invalidResources.push(res);
		}

		if (invalidResources.length > 0) {
			alert(`Unknown resources: ${invalidResources.join(', ')}`);
			return;
		}

		// Add user message to UI
		const userMessage: Message = {
			id: nanoid(),
			role: 'user',
			content: inputValue,
			resources: validResources
		};

		currentSession.messages = [...currentSession.messages, userMessage];
		const savedInput = inputValue;
		inputValue = '';
		isStreaming = true;
		sandboxStatus = currentSession.status === 'pending' ? 'pending' : null;
		cancelState = 'none';
		currentChunks = [];

		// Create abort controller
		abortController = new AbortController();

		try {
			const response = await fetch(`/api/sessions/${currentSessionId}/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: savedInput,
					resources: validResources
				}),
				signal: abortController.signal
			});

			if (!response.ok) {
				throw new Error('Failed to send message');
			}

			if (!response.body) {
				throw new Error('No response body');
			}

			// Process SSE stream
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				let eventData = '';
				for (const line of lines) {
					if (line.startsWith('data: ')) {
						eventData = line.slice(6);
					} else if (line === '' && eventData) {
						try {
							const event = JSON.parse(eventData) as
								| { type: 'add'; chunk: BtcaChunk }
								| { type: 'update'; id: string; chunk: Partial<BtcaChunk> }
								| { type: 'status'; status: ChatSession['status'] }
								| { type: 'done' }
								| { type: 'error'; error: string };

							if (event.type === 'status') {
								sandboxStatus = event.status;
								if (currentSession && event.status === 'active') {
									currentSession.status = 'active';
								}
							} else if (event.type === 'add') {
								sandboxStatus = null; // Clear status once streaming starts
								currentChunks = [...currentChunks, event.chunk];
							} else if (event.type === 'update') {
								currentChunks = currentChunks.map((c) => {
									if (c.id !== event.id) return c;
									// Cast to preserve discriminated union type
									return { ...c, ...event.chunk } as BtcaChunk;
								});
							} else if (event.type === 'error') {
								throw new Error(event.error);
							}
						} catch (e) {
							if (e instanceof SyntaxError) {
								console.error('Failed to parse event:', eventData);
							} else {
								throw e;
							}
						}
						eventData = '';
					}
				}
			}

			reader.releaseLock();

			// Add assistant message with final chunks
			const assistantMessage: Message = {
				id: nanoid(),
				role: 'assistant',
				content: {
					type: 'chunks',
					chunks: currentChunks
				}
			};
			currentSession.messages = [...currentSession.messages, assistantMessage];

			// Update thread resources
			currentSession.threadResources = [...new Set([...threadResources, ...validResources])];

			// Refresh sessions list to update status
			await loadSessions();
		} catch (error) {
			if ((error as Error).name === 'AbortError') {
				// Add canceled message
				const canceledMessage: Message = {
					id: nanoid(),
					role: 'system',
					content: 'Request canceled.'
				};
				currentSession.messages = [...currentSession.messages, canceledMessage];
			} else {
				console.error('Failed to send message:', error);
				const errorMessage: Message = {
					id: nanoid(),
					role: 'system',
					content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
				};
				currentSession.messages = [...currentSession.messages, errorMessage];
			}
		} finally {
			isStreaming = false;
			sandboxStatus = null;
			cancelState = 'none';
			currentChunks = [];
			abortController = null;
		}
	}

	function requestCancel() {
		if (cancelState === 'none') {
			cancelState = 'pending';
		} else {
			abortController?.abort();
		}
	}

	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let mentionSelectedIndex = $state(0);
	let mentionMenuOpen = $state(false);
	let mentionRange = $state<{ start: number; end: number; query: string } | null>(null);

	function getMentionAtCursor(value: string, cursor: number) {
		const regex = /(^|(?<=\s))@\w*/g;
		let match;
		while ((match = regex.exec(value)) !== null) {
			const start = match.index;
			const end = match.index + match[0].length;
			if (cursor >= start && cursor <= end) {
				return { start, end, query: match[0].slice(1) };
			}
		}
		return null;
	}

	function getFilteredResources() {
		if (!mentionRange) return [];
		const query = mentionRange.query.trim().toLowerCase();
		if (!query) return availableResources;
		return availableResources.filter((r) => r.name.toLowerCase().includes(query));
	}

	function updateMentionState() {
		if (!inputEl) {
			mentionMenuOpen = false;
			mentionRange = null;
			return;
		}

		const cursor = inputEl.selectionStart ?? inputValue.length;
		const range = getMentionAtCursor(inputValue, cursor);
		mentionRange = range;

		const shouldOpen = !!range && !isStreaming && availableResources.length > 0;
		if (!shouldOpen) {
			mentionMenuOpen = false;
			mentionSelectedIndex = 0;
			return;
		}

		const filtered = getFilteredResources();
		mentionMenuOpen = filtered.length > 0;
		mentionSelectedIndex = 0;
	}

	function applyMention(resourceName: string) {
		if (!mentionRange || !inputEl) return;
		const before = inputValue.slice(0, mentionRange.start);
		const after = inputValue.slice(mentionRange.end);
		const insert = `@${resourceName} `;
		inputValue = before + insert + after;

		queueMicrotask(() => {
			if (!inputEl) return;
			const cursor = before.length + insert.length;
			inputEl.focus();
			inputEl.selectionStart = cursor;
			inputEl.selectionEnd = cursor;
			updateMentionState();
		});
	}

	function adjustTextareaHeight() {
		if (!inputEl) return;
		inputEl.style.height = 'auto';
		inputEl.style.height = `${Math.min(240, Math.max(48, inputEl.scrollHeight))}px`;
	}

	$effect(() => {
		// Keep textarea + overlay height in sync
		inputValue;
		queueMicrotask(adjustTextareaHeight);
	});

	function handleKeydown(event: KeyboardEvent) {
		if (mentionMenuOpen) {
			const filtered = getFilteredResources();
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				mentionSelectedIndex =
					filtered.length === 0 ? 0 : (mentionSelectedIndex + 1) % filtered.length;
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				mentionSelectedIndex =
					filtered.length === 0
						? 0
						: (mentionSelectedIndex - 1 + filtered.length) % filtered.length;
				return;
			}
			if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
				event.preventDefault();
				const picked = filtered[mentionSelectedIndex];
				if (picked) applyMention(picked.name);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				mentionMenuOpen = false;
				return;
			}
		}

		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
		if (event.key === 'Escape' && isStreaming) {
			requestCancel();
		}

		queueMicrotask(() => {
			updateMentionState();
		});
	}

	// Strip conversation history markers from displayed text
	function stripHistory(text: string): string {
		const historyRegex = /=== CONVERSATION HISTORY ===[\s\S]*?=== END HISTORY ===/g;
		return text
			.replace(historyRegex, '')
			.replace(/^Current question:\s*/i, '')
			.trim();
	}

	const shikiHighlighter = createHighlighter({
		themes: ['vitesse-light', 'vitesse-dark'],
		langs: ['elixir', 'typescript', 'svelte', 'json', 'text']
	});

	let markdownCache = $state<Record<string, string>>({});
	const markdownPending = new Set<string>();

	function normalizeCodeLang(langRaw: string | undefined): string {
		const lang = (langRaw ?? '').trim().toLowerCase();
		if (!lang) return 'text';
		if (lang === 'ts') return 'typescript';
		if (lang === 'svelte') return 'svelte';
		if (lang === 'json') return 'json';
		if (lang === 'elixir' || lang === 'ex' || lang === 'exs') return 'elixir';
		if (lang === 'typescript') return 'typescript';
		return 'text';
	}

	async function renderMarkdownWithShiki(text: string): Promise<string> {
		const content = stripHistory(text);
		const highlighter = await shikiHighlighter;

		const renderer = new marked.Renderer();
		renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
			const normalized = normalizeCodeLang(lang);
			return highlighter.codeToHtml(text, {
				lang: normalized,
				themes: { light: 'vitesse-light', dark: 'vitesse-dark' },
				defaultColor: false
			});
		};

		return (await marked.parse(content, { async: true, renderer })) as string;
	}

	function getRenderedMarkdown(text: string): string {
		const content = stripHistory(text);
		if (markdownCache[content]) return markdownCache[content]!;

		if (!markdownPending.has(content)) {
			markdownPending.add(content);
			void renderMarkdownWithShiki(content)
				.then((html) => {
					markdownCache = { ...markdownCache, [content]: html };
				})
				.finally(() => {
					markdownPending.delete(content);
				});
		}

		return marked.parse(content, { async: false }) as string;
	}

	// Sort chunks for display: reasoning, tools, text
	function sortChunks(chunks: BtcaChunk[]): BtcaChunk[] {
		const reasoning: BtcaChunk[] = [];
		const tools: BtcaChunk[] = [];
		const text: BtcaChunk[] = [];
		const other: BtcaChunk[] = [];

		for (const chunk of chunks) {
			switch (chunk.type) {
				case 'reasoning':
					reasoning.push(chunk);
					break;
				case 'tool':
					tools.push(chunk);
					break;
				case 'text':
					text.push(chunk);
					break;
				default:
					other.push(chunk);
			}
		}

		return [...reasoning, ...tools, ...text, ...other];
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<!-- Session sidebar -->
	<aside
		class="bc-card flex w-64 flex-col border-r {showSessionList
			? 'translate-x-0'
			: '-translate-x-full md:translate-x-0'} absolute top-0 left-0 z-10 h-full transition-transform md:relative"
	>
		<div class="flex items-center justify-between border-b border-[hsl(var(--bc-border))] p-4">
			<h2 class="text-sm font-semibold">Sessions</h2>
			<button
				type="button"
				class="bc-btn bc-btn-primary p-2"
				onclick={createNewSession}
				disabled={isCreatingSession}
				title="New Session"
			>
				{#if isCreatingSession}
					<Loader2 size={16} class="animate-spin" />
				{:else}
					<Plus size={16} />
				{/if}
			</button>
		</div>

		<div class="flex-1 overflow-y-auto p-2">
			{#each sessions as session (session.id)}
				<div
					class="mb-2 flex w-full cursor-pointer items-center gap-2 p-3 text-left {currentSessionId ===
					session.id
						? 'bc-card border-[hsl(var(--bc-accent))]'
						: 'bc-card hover:border-[hsl(var(--bc-fg))]'}"
					role="button"
					tabindex="0"
					onclick={() => loadSession(session.id)}
					onkeydown={(e) => e.key === 'Enter' && loadSession(session.id)}
				>
					<MessageSquare size={16} class="shrink-0" />
					<div class="min-w-0 flex-1">
						<div class="truncate text-xs font-medium">
							{session.id.slice(0, 8)}...
						</div>
						<div class="bc-muted text-xs">
							{session.messageCount} messages
						</div>
						<div class="bc-muted text-xs">
							{#if session.status === 'active'}
								<span class="text-[hsl(var(--bc-success))]">Active</span>
							{:else if session.status === 'pending'}
								<span class="text-[hsl(var(--bc-fg-muted))]">Ready</span>
							{:else if session.status === 'creating' || session.status === 'cloning' || session.status === 'starting'}
								<span class="text-[hsl(var(--bc-warning))]">Starting...</span>
							{:else if session.status === 'error'}
								<span class="text-[hsl(var(--bc-error))]">Error</span>
							{:else}
								<span>{session.status}</span>
							{/if}
						</div>
					</div>
					<button
						type="button"
						class="bc-chip shrink-0 p-1"
						onclick={(e) => {
							e.stopPropagation();
							destroySession(session.id);
						}}
						title="Destroy session"
					>
						<Trash2 size={14} />
					</button>
				</div>
			{/each}

			{#if sessions.length === 0}
				<div class="bc-muted py-8 text-center text-sm">
					No sessions yet.
					<br />
					Click + to create one.
				</div>
			{/if}
		</div>
	</aside>

	<!-- Main chat area -->
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if !currentSession}
			<div class="flex flex-1 flex-col items-center justify-center gap-6 p-8">
				<div class="flex flex-col items-center gap-2">
					<div class="bc-logoMark">
						<MessageSquare size={20} />
					</div>
					<h2 class="text-xl font-semibold">btca Chat</h2>
				</div>
				<p class="bc-muted max-w-md text-center text-sm">
					Ask questions about Svelte, SvelteKit, Tailwind, and more. Each session runs in an
					isolated sandbox environment.
				</p>
				<button
					type="button"
					class="bc-btn bc-btn-primary"
					onclick={createNewSession}
					disabled={isCreatingSession}
				>
					{#if isCreatingSession}
						<Loader2 size={16} class="animate-spin" />
						Creating...
					{:else}
						<Plus size={16} />
						New Session
					{/if}
				</button>
				<div class="bc-muted mt-4 text-xs">
					Sandbox will be created when you send your first message.
				</div>
			</div>
		{:else if isLoadingSession}
			<div class="flex flex-1 items-center justify-center">
				<Loader2 size={32} class="animate-spin" />
			</div>
		{:else}
			<!-- Chat messages -->
			<div class="chat-messages">
				{#each currentSession.messages as message (message.id)}
					{#if message.role === 'user'}
						<div class="chat-message chat-message-user">
							<div class="mb-2 flex items-center gap-2">
								<span class="text-xs font-semibold text-[hsl(var(--bc-fg-muted))]">You</span>
								{#if message.resources.length > 0}
									<div class="flex gap-1">
										{#each message.resources as resource}
											<span class="bc-badge">@{resource}</span>
										{/each}
									</div>
								{/if}
							</div>
							<div class="text-sm leading-relaxed">{stripHistory(message.content)}</div>
						</div>
					{:else if message.role === 'assistant'}
						<div class="chat-message chat-message-assistant">
							<div class="mb-2 flex items-center gap-2">
								<span class="text-xs font-semibold text-[hsl(var(--bc-success))]">AI</span>
								{#if message.canceled}
									<span class="bc-badge bc-badge-warning">canceled</span>
								{/if}
							</div>
							{#if message.content.type === 'text'}
								<div class="prose prose-sm max-w-none prose-neutral prose-invert">
									{@html getRenderedMarkdown(message.content.content)}
								</div>
							{:else if message.content.type === 'chunks'}
								<div class="space-y-3">
									{#each sortChunks(message.content.chunks) as chunk (chunk.id)}
										{#if chunk.type === 'reasoning'}
											<div class="reasoning-block">
												<span class="font-medium">Thinking:</span>
												{chunk.text}
											</div>
										{:else if chunk.type === 'tool'}
											<div class="tool-indicator">
												{#if chunk.state === 'pending'}
													<span class="tool-dot tool-dot-pending"></span>
												{:else if chunk.state === 'running'}
													<Loader2 size={12} class="animate-spin text-[hsl(var(--bc-accent))]" />
												{:else}
													<span class="tool-dot tool-dot-completed"></span>
												{/if}
												<span class="font-medium">{chunk.toolName}</span>
											</div>
										{:else if chunk.type === 'text'}
											<div class="prose prose-sm max-w-none prose-neutral prose-invert">
												{@html getRenderedMarkdown(chunk.text)}
											</div>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					{:else if message.role === 'system'}
						<div class="chat-message chat-message-system">
							<div class="text-sm">{message.content}</div>
						</div>
					{/if}
				{/each}

				<!-- Sandbox initialization status -->
				{#if isStreaming && sandboxStatus}
					<div class="chat-message chat-message-system">
						<div class="flex items-center gap-3">
							<div class="sandbox-status-indicator">
								{#if sandboxStatus === 'pending' || sandboxStatus === 'creating'}
									<Server size={16} class="text-[hsl(var(--bc-warning))]" />
								{:else if sandboxStatus === 'cloning'}
									<GitBranch size={16} class="text-[hsl(var(--bc-accent))]" />
								{:else if sandboxStatus === 'starting'}
									<Zap size={16} class="text-[hsl(var(--bc-success))]" />
								{:else}
									<Loader2 size={16} class="animate-spin" />
								{/if}
							</div>
							<div class="flex flex-col gap-1">
								<span class="text-sm font-medium">
									{#if sandboxStatus === 'pending' || sandboxStatus === 'creating'}
										Creating sandbox environment...
									{:else if sandboxStatus === 'cloning'}
										Cloning repositories...
									{:else if sandboxStatus === 'starting'}
										Starting btca server...
									{:else}
										Initializing...
									{/if}
								</span>
								<div class="sandbox-progress-bar">
									<div
										class="sandbox-progress-fill"
										style="width: {sandboxStatus === 'pending'
											? '10%'
											: sandboxStatus === 'creating'
												? '30%'
												: sandboxStatus === 'cloning'
													? '60%'
													: sandboxStatus === 'starting'
														? '85%'
														: '95%'}"
									></div>
								</div>
							</div>
						</div>
					</div>
				{/if}

				<!-- Streaming message -->
				{#if isStreaming && currentChunks.length > 0}
					<div class="chat-message chat-message-assistant">
						<div class="mb-2 flex items-center gap-2">
							<span class="text-xs font-semibold text-[hsl(var(--bc-success))]">AI</span>
							<Loader2 size={12} class="animate-spin" />
						</div>
						<div class="space-y-3">
							{#each sortChunks(currentChunks) as chunk (chunk.id)}
								{#if chunk.type === 'reasoning'}
									<div class="reasoning-block">
										<span class="font-medium">Thinking:</span>
										{chunk.text}
									</div>
								{:else if chunk.type === 'tool'}
									<div class="tool-indicator">
										{#if chunk.state === 'pending'}
											<span class="tool-dot tool-dot-pending"></span>
										{:else if chunk.state === 'running'}
											<Loader2 size={12} class="animate-spin text-[hsl(var(--bc-accent))]" />
										{:else}
											<span class="tool-dot tool-dot-completed"></span>
										{/if}
										<span class="font-medium">{chunk.toolName}</span>
									</div>
								{:else if chunk.type === 'text'}
									<div class="prose prose-sm max-w-none">
										{@html getRenderedMarkdown(chunk.text)}
									</div>
								{/if}
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- Input area -->
			<div class="chat-input-container">
				<!-- Thread resources -->
				{#if currentSession.threadResources.length > 0}
					<div class="mb-3 flex flex-wrap items-center gap-2">
						<span class="bc-muted text-xs">Active:</span>
						{#each currentSession.threadResources as resource}
							<span class="bc-badge">@{resource}</span>
						{/each}
					</div>
				{/if}

				<div class="relative">
					<div class="bc-input bc-input-mentionWrap">
						{#if mentionMenuOpen}
							<div class="bc-card bc-mentionMenu" role="listbox" aria-label="Mention resource">
								<div class="bc-muted px-3 py-2 text-xs font-medium">Resources</div>
								{#each getFilteredResources() as res, i (res.name)}
									<div
										class="bc-mentionMenuItem"
										role="option"
										tabindex="-1"
										aria-selected={i === mentionSelectedIndex}
										onmousedown={(e) => {
											e.preventDefault();
											applyMention(res.name);
										}}
									>
										<span class="text-sm font-semibold">@{res.name}</span>
										<span class="bc-muted text-xs">{res.type}</span>
									</div>
								{/each}
							</div>
						{/if}

						<div
							class="bc-input-mentionOverlay"
							aria-hidden="true"
							style={inputEl ? `height: ${inputEl.style.height || '48px'}; overflow: hidden;` : ''}
						>
							{#if !inputValue}
								<span class="bc-muted">Type @ to mention a resource, then ask your question...</span
								>
							{:else}
								{#each (() => {
									const parts: { type: 'text' | 'mention'; text: string }[] = [];
									const regex = /(^|(?<=\s))@\w*/g;
									let lastIndex = 0;
									let match;
									while ((match = regex.exec(inputValue)) !== null) {
										if (match.index > lastIndex) {
											parts.push({ type: 'text', text: inputValue.slice(lastIndex, match.index) });
										}
										parts.push({ type: 'mention', text: match[0] });
										lastIndex = regex.lastIndex;
									}
									if (lastIndex < inputValue.length) {
										parts.push({ type: 'text', text: inputValue.slice(lastIndex) });
									}
									return parts;
								})() as part (part.text)}
									{#if part.type === 'mention'}
										<span class="bc-input-mentionPill">{part.text}</span>
									{:else}
										{part.text}
									{/if}
								{/each}
							{/if}
						</div>

						<textarea
							class="bc-input bc-input-mentionTextarea min-h-[48px] resize-none pr-14"
							bind:this={inputEl}
							bind:value={inputValue}
							oninput={() => {
								adjustTextareaHeight();
								updateMentionState();
							}}
							onclick={updateMentionState}
							onkeyup={updateMentionState}
							onkeydown={handleKeydown}
							disabled={isStreaming}
							rows="1"
							spellcheck="false"
							autocomplete="off"
							placeholder=""
						></textarea>
					</div>

					<button
						type="button"
						class="bc-btn bc-btn-primary absolute right-2 bottom-2 p-2"
						onclick={sendMessage}
						disabled={isStreaming || !inputValue.trim()}
					>
						{#if isStreaming}
							<Loader2 size={16} class="animate-spin" />
						{:else}
							<Send size={16} />
						{/if}
					</button>
				</div>

				<!-- Status bar -->
				<div class="mt-3 flex items-center justify-between text-xs">
					<div class="bc-muted">
						{#if isStreaming}
							{#if sandboxStatus}
								Initializing sandbox...
							{:else if cancelState === 'pending'}
								Press Escape again to cancel
							{:else}
								Streaming... (Escape to cancel)
							{/if}
						{:else}
							Enter to send, Shift+Enter for new line
						{/if}
					</div>
					<div class="flex gap-2">
						{#if isStreaming}
							<button
								type="button"
								class="bc-chip px-2 py-1 text-xs"
								onclick={requestCancel}
								title="Cancel"
							>
								<XCircle size={12} />
								Cancel
							</button>
						{:else}
							<button
								type="button"
								class="bc-chip px-2 py-1 text-xs"
								onclick={clearChat}
								title="Clear chat"
							>
								Clear
							</button>
						{/if}
					</div>
				</div>

				<!-- Available resources hint -->
				{#if availableResources.length > 0 && !inputValue.includes('@') && !currentSession.threadResources.length}
					<div class="bc-muted mt-2 text-xs">
						Available: {availableResources.map((r) => `@${r.name}`).join(', ')}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Mobile toggle for sidebar -->
	<button
		type="button"
		class="bc-btn fixed bottom-4 left-4 z-20 p-2 md:hidden"
		onclick={() => (showSessionList = !showSessionList)}
	>
		<ChevronRight size={16} class={showSessionList ? 'rotate-180' : ''} />
	</button>
</div>
