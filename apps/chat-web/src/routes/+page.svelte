<script lang="ts">
	import {
		MessageSquare,
		Plus,
		Trash2,
		Loader2,
		Send,
		ChevronRight,
		Server,
		GitBranch,
		Zap,
		Copy,
		Check
	} from '@lucide/svelte';
	import type { Message, BtcaChunk, CancelState, ChatSession } from '$lib/types';
	import { nanoid } from 'nanoid';
	import { marked } from 'marked';
	import { createHighlighter } from 'shiki';
	import DOMPurify from 'isomorphic-dompurify';

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

	// Copy state
	let copiedId = $state<string | null>(null);

	// Load sessions on mount
	$effect(() => {
		loadSessions();
	});

	async function loadSessions() {
		try {
			const response = await fetch('/api/sessions');
			const data = (await response.json()) as { sessions: typeof sessions };
			sessions = data.sessions;
		} catch (error) {
			console.error('Failed to load sessions:', error);
		}
	}

	async function createNewSession() {
		isCreatingSession = true;
		try {
			const response = await fetch('/api/sessions', { method: 'POST' });
			const data = (await response.json()) as { id: string; error?: string };
			if (!response.ok) throw new Error(data.error ?? 'Failed to create session');
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
			if (!response.ok) throw new Error(data?.error ?? 'Failed to load session');
			currentSession = data;
			currentSessionId = sessionId;
			showSessionList = false;
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
			const data = (await response.json()) as { resources: typeof availableResources };
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

		if (mentionedResources.length === 0 && threadResources.length === 0) {
			alert('Please @mention a resource first (e.g., @svelte)');
			return;
		}
		if (!question.trim()) {
			alert('Please enter a question after the @mention');
			return;
		}

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
		abortController = new AbortController();

		try {
			const response = await fetch(`/api/sessions/${currentSessionId}/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: savedInput, resources: validResources }),
				signal: abortController.signal
			});

			if (!response.ok) throw new Error('Failed to send message');
			if (!response.body) throw new Error('No response body');

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
								sandboxStatus = null;
								currentChunks = [...currentChunks, event.chunk];
							} else if (event.type === 'update') {
								currentChunks = currentChunks.map((c) => {
									if (c.id !== event.id) return c;
									return { ...c, ...event.chunk } as BtcaChunk;
								});
							} else if (event.type === 'error') {
								throw new Error(event.error);
							}
						} catch (e) {
							if (!(e instanceof SyntaxError)) throw e;
						}
						eventData = '';
					}
				}
			}

			reader.releaseLock();

			const assistantMessage: Message = {
				id: nanoid(),
				role: 'assistant',
				content: { type: 'chunks', chunks: currentChunks }
			};
			currentSession.messages = [...currentSession.messages, assistantMessage];
			currentSession.threadResources = [...new Set([...threadResources, ...validResources])];
			await loadSessions();
		} catch (error) {
			if ((error as Error).name === 'AbortError') {
				currentSession.messages = [
					...currentSession.messages,
					{ id: nanoid(), role: 'system', content: 'Request canceled.' }
				];
			} else {
				currentSession.messages = [
					...currentSession.messages,
					{
						id: nanoid(),
						role: 'system',
						content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
					}
				];
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

	// Input handling
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
		queueMicrotask(updateMentionState);
	}

	function getPlaceholder(): string {
		if (isStreaming && cancelState === 'pending') return 'Press Escape again to cancel';
		if (isStreaming) return 'Press Escape to cancel';
		return '@resource question...';
	}

	// Markdown rendering
	function stripHistory(text: string): string {
		return text
			.replace(/=== CONVERSATION HISTORY ===[\s\S]*?=== END HISTORY ===/g, '')
			.replace(/^Current question:\s*/i, '')
			.trim();
	}

	const shikiHighlighter = createHighlighter({
		themes: ['vitesse-light', 'vitesse-dark'],
		langs: [
			'elixir',
			'typescript',
			'svelte',
			'json',
			'text',
			'javascript',
			'html',
			'css',
			'bash',
			'shell'
		]
	});

	let markdownCache = $state<Record<string, string>>({});
	const markdownPending = new Set<string>();

	function normalizeCodeLang(langRaw: string | undefined): string {
		const lang = (langRaw ?? '').trim().toLowerCase();
		if (!lang) return 'text';
		const langMap: Record<string, string> = {
			ts: 'typescript',
			js: 'javascript',
			svelte: 'svelte',
			json: 'json',
			elixir: 'elixir',
			ex: 'elixir',
			exs: 'elixir',
			typescript: 'typescript',
			javascript: 'javascript',
			html: 'html',
			css: 'css',
			bash: 'bash',
			sh: 'shell',
			shell: 'shell'
		};
		return langMap[lang] ?? 'text';
	}

	async function renderMarkdownWithShiki(text: string): Promise<string> {
		const content = stripHistory(text);
		const highlighter = await shikiHighlighter;

		const renderer = new marked.Renderer();
		renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
			const normalized = normalizeCodeLang(lang);
			const codeId = nanoid(8);
			const highlighted = highlighter.codeToHtml(text, {
				lang: normalized,
				themes: { light: 'vitesse-light', dark: 'vitesse-dark' },
				defaultColor: false
			});
			// Wrap with copy button
			return `<div class="code-block-wrapper" data-code-id="${codeId}"><div class="code-block-header"><span class="code-lang">${lang || 'text'}</span><button class="copy-btn" data-copy-target="${codeId}" onclick="window.copyCode('${codeId}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</button></div><div class="code-content" id="code-${codeId}">${highlighted}</div><pre style="display:none" id="code-raw-${codeId}">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></div>`;
		};

		const html = (await marked.parse(content, { async: true, renderer })) as string;
		return DOMPurify.sanitize(html, {
			ADD_TAGS: ['pre', 'code'],
			ADD_ATTR: ['data-code-id', 'data-copy-target', 'onclick', 'class', 'id', 'style']
		});
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

		const html = marked.parse(content, { async: false }) as string;
		return DOMPurify.sanitize(html, {
			ADD_TAGS: ['pre', 'code'],
			ADD_ATTR: ['class']
		});
	}

	// Global copy function
	if (typeof window !== 'undefined') {
		(window as unknown as { copyCode: (id: string) => void }).copyCode = async (id: string) => {
			const rawEl = document.getElementById(`code-raw-${id}`);
			if (rawEl) {
				const text = rawEl.textContent ?? '';
				await navigator.clipboard.writeText(text);
				copiedId = id;
				setTimeout(() => {
					copiedId = null;
				}, 2000);
			}
		};
	}

	async function copyFullAnswer(messageId: string, chunks: BtcaChunk[]) {
		const text = chunks
			.filter((c): c is BtcaChunk & { type: 'text' } => c.type === 'text')
			.map((c) => c.text)
			.join('\n\n');
		await navigator.clipboard.writeText(stripHistory(text));
		copiedId = messageId;
		setTimeout(() => {
			copiedId = null;
		}, 2000);
	}

	function sortChunks(chunks: BtcaChunk[]): BtcaChunk[] {
		const reasoning: BtcaChunk[] = [];
		const tools: BtcaChunk[] = [];
		const text: BtcaChunk[] = [];
		const other: BtcaChunk[] = [];
		for (const chunk of chunks) {
			if (chunk.type === 'reasoning') reasoning.push(chunk);
			else if (chunk.type === 'tool') tools.push(chunk);
			else if (chunk.type === 'text') text.push(chunk);
			else other.push(chunk);
		}
		return [...reasoning, ...tools, ...text, ...other];
	}

	function getTextContent(message: Message): string {
		if (message.role !== 'assistant') return '';
		if (message.content.type === 'text') return message.content.content;
		return message.content.chunks
			.filter((c): c is BtcaChunk & { type: 'text' } => c.type === 'text')
			.map((c) => c.text)
			.join('\n\n');
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<!-- Sidebar -->
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
						<div class="truncate text-xs font-medium">{session.id.slice(0, 8)}...</div>
						<div class="bc-muted text-xs">{session.messageCount} messages</div>
						<div class="text-xs">
							{#if session.status === 'active'}
								<span class="text-[hsl(var(--bc-success))]">Active</span>
							{:else if session.status === 'pending'}
								<span class="bc-muted">Ready</span>
							{:else if session.status === 'creating' || session.status === 'cloning' || session.status === 'starting'}
								<span class="text-[hsl(var(--bc-warning))]">Starting...</span>
							{:else if session.status === 'error'}
								<span class="text-[hsl(var(--bc-error))]">Error</span>
							{:else}
								<span class="bc-muted">{session.status}</span>
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
					>
						<Trash2 size={14} />
					</button>
				</div>
			{/each}
			{#if sessions.length === 0}
				<div class="bc-muted py-8 text-center text-sm">
					No sessions yet.<br />Click + to create one.
				</div>
			{/if}
		</div>
	</aside>

	<!-- Main area -->
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if !currentSession}
			<div class="flex flex-1 flex-col items-center justify-center gap-6 p-8">
				<div class="bc-logoMark"><MessageSquare size={20} /></div>
				<h2 class="text-xl font-semibold">btca Chat</h2>
				<p class="bc-muted max-w-md text-center text-sm">
					Ask questions about Svelte, SvelteKit, Tailwind, and more.
				</p>
				<button
					type="button"
					class="bc-btn bc-btn-primary"
					onclick={createNewSession}
					disabled={isCreatingSession}
				>
					{#if isCreatingSession}
						<Loader2 size={16} class="animate-spin" /> Creating...
					{:else}
						<Plus size={16} /> New Session
					{/if}
				</button>
				<div class="bc-muted text-xs">Sandbox is created on first message.</div>
			</div>
		{:else if isLoadingSession}
			<div class="flex flex-1 items-center justify-center">
				<Loader2 size={32} class="animate-spin" />
			</div>
		{:else}
			<!-- Messages -->
			<div class="chat-messages">
				{#each currentSession.messages as message (message.id)}
					{#if message.role === 'user'}
						<div class="chat-message chat-message-user">
							<div class="mb-1 flex items-center gap-2">
								<span class="bc-muted text-xs font-medium">You</span>
								{#each message.resources as resource}
									<span class="bc-badge">@{resource}</span>
								{/each}
							</div>
							<div class="text-sm">{stripHistory(message.content)}</div>
						</div>
					{:else if message.role === 'assistant'}
						<div class="chat-message chat-message-assistant">
							<div class="mb-2 flex items-center justify-between">
								<span class="text-xs font-medium text-[hsl(var(--bc-success))]">AI</span>
								<button
									type="button"
									class="copy-answer-btn"
									onclick={() =>
										copyFullAnswer(
											message.id,
											message.content.type === 'chunks' ? message.content.chunks : []
										)}
								>
									{#if copiedId === message.id}
										<Check size={12} /> Copied
									{:else}
										<Copy size={12} /> Copy
									{/if}
								</button>
							</div>
							{#if message.content.type === 'text'}
								<div class="prose prose-sm prose-neutral prose-invert max-w-none">
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
												{#if chunk.state === 'running'}
													<Loader2 size={12} class="animate-spin" />
												{:else}
													<span
														class="tool-dot {chunk.state === 'completed'
															? 'tool-dot-completed'
															: 'tool-dot-pending'}"
													></span>
												{/if}
												<span>{chunk.toolName}</span>
											</div>
										{:else if chunk.type === 'text'}
											<div class="prose prose-sm prose-neutral prose-invert max-w-none">
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

				<!-- Sandbox status -->
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
							<div>
								<div class="text-sm font-medium">
									{#if sandboxStatus === 'pending' || sandboxStatus === 'creating'}
										Creating sandbox...
									{:else if sandboxStatus === 'cloning'}
										Cloning repositories...
									{:else if sandboxStatus === 'starting'}
										Starting server...
									{:else}
										Initializing...
									{/if}
								</div>
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

				<!-- Streaming -->
				{#if isStreaming && currentChunks.length > 0}
					<div class="chat-message chat-message-assistant">
						<div class="mb-2 flex items-center gap-2">
							<span class="text-xs font-medium text-[hsl(var(--bc-success))]">AI</span>
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
										{#if chunk.state === 'running'}
											<Loader2 size={12} class="animate-spin" />
										{:else}
											<span
												class="tool-dot {chunk.state === 'completed'
													? 'tool-dot-completed'
													: 'tool-dot-pending'}"
											></span>
										{/if}
										<span>{chunk.toolName}</span>
									</div>
								{:else if chunk.type === 'text'}
									<div class="prose prose-sm prose-neutral prose-invert max-w-none">
										{@html getRenderedMarkdown(chunk.text)}
									</div>
								{/if}
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- Input -->
			<div class="chat-input-container">
				{#if currentSession.threadResources.length > 0}
					<div class="mb-2 flex flex-wrap items-center gap-2">
						<span class="bc-muted text-xs">Active:</span>
						{#each currentSession.threadResources as resource}
							<span class="bc-badge">@{resource}</span>
						{/each}
					</div>
				{/if}

				<div class="input-wrapper">
					{#if mentionMenuOpen}
						<div class="mention-menu">
							{#each getFilteredResources() as res, i (res.name)}
								<div
									class="mention-item {i === mentionSelectedIndex ? 'mention-item-selected' : ''}"
									role="option"
									tabindex="-1"
									aria-selected={i === mentionSelectedIndex}
									onmousedown={(e) => {
										e.preventDefault();
										applyMention(res.name);
									}}
								>
									<span class="font-medium">@{res.name}</span>
									<span class="bc-muted text-xs">{res.type}</span>
								</div>
							{/each}
						</div>
					{/if}

					<textarea
						class="chat-input"
						bind:this={inputEl}
						bind:value={inputValue}
						oninput={updateMentionState}
						onclick={updateMentionState}
						onkeydown={handleKeydown}
						disabled={isStreaming}
						rows="1"
						placeholder={getPlaceholder()}
					></textarea>

					<button
						type="button"
						class="send-btn"
						onclick={sendMessage}
						disabled={isStreaming || !inputValue.trim()}
					>
						{#if isStreaming}
							<Loader2 size={18} class="animate-spin" />
						{:else}
							<Send size={18} />
						{/if}
					</button>
				</div>

				<div class="bc-muted mt-2 flex items-center justify-between text-xs">
					<span>
						{#if isStreaming}
							{cancelState === 'pending' ? 'Press Escape again to cancel' : 'Streaming...'}
						{:else}
							Enter to send
						{/if}
					</span>
					{#if !isStreaming}
						<button type="button" class="text-xs hover:underline" onclick={clearChat}>Clear</button>
					{/if}
				</div>

				{#if availableResources.length > 0 && !inputValue.includes('@') && !currentSession.threadResources.length}
					<div class="bc-muted mt-1 text-xs">
						Available: {availableResources.map((r) => `@${r.name}`).join(', ')}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Mobile sidebar toggle -->
	<button
		type="button"
		class="bc-btn fixed bottom-4 left-4 z-20 p-2 md:hidden"
		onclick={() => (showSessionList = !showSessionList)}
	>
		<ChevronRight size={16} class={showSessionList ? 'rotate-180' : ''} />
	</button>
</div>
