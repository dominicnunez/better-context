<script lang="ts">
	import cliShowcase from '$lib/assets/cli-showcase.png';
</script>

<svelte:head>
	<title>btca | CLI</title>
	<meta
		name="description"
		content="The btca CLI for asking questions about real codebases straight from your terminal."
	/>
</svelte:head>

<section class="flex flex-col gap-14">
	<header class="flex flex-col gap-5">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>CLI</span>
		</div>

		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl">
			Answers from source, right in your terminal.
		</h1>
		<p class="bc-prose max-w-2xl text-pretty text-base sm:text-lg">
			Ask questions about any codebase and get answers grounded in real source code — no browser
			required.
		</p>

		<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
			<a
				href="https://docs.btca.dev/guides/quickstart"
				class="bc-chip bc-btnPrimary justify-center"
				target="_blank"
				rel="noreferrer">Get started</a
			>
			<a
				href="https://docs.btca.dev"
				class="bc-chip justify-center"
				target="_blank"
				rel="noreferrer">Read the docs</a
			>
		</div>
	</header>

	<section>
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>In action</span>
		</div>
		<p class="mt-2 max-w-2xl text-sm bc-prose">A quick look at asking a question with the CLI.</p>

		<div class="mt-4">
			<div class="bc-card bc-ring p-5">
				<div class="text-xs font-semibold uppercase tracking-[0.16em] bc-muted">Terminal</div>
				<img
					src={cliShowcase}
					alt="btca CLI in action"
					class="mt-3 w-full rounded-lg border border-[hsl(var(--bc-border))]"
					loading="lazy"
				/>
			</div>
		</div>

		<ul class="mt-4 flex flex-col gap-2 text-sm bc-prose">
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span
					>One command to ask a question — <code class="bc-code"
						>btca ask -r svelte -q "How do runes work?"</code
					></span
				>
			</li>
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span>Interactive TUI for multi-turn conversations with @mentions</span>
			</li>
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span>Add any git repo or local directory as a searchable resource</span>
			</li>
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span>Bring your own model — 7+ providers supported out of the box</span>
			</li>
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span>Built-in MCP server so your AI tools can query repos too</span>
			</li>
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span>Fully local — your code never leaves your machine</span>
			</li>
		</ul>
	</section>

	<section class="bc-card bc-ring p-6">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<div class="text-sm font-semibold">Ready to try it?</div>
				<p class="mt-1 text-sm bc-prose">Install with one command and start asking questions.</p>
			</div>
			<div class="flex flex-wrap gap-3">
				<a
					href="https://docs.btca.dev/guides/quickstart"
					class="bc-chip bc-btnPrimary"
					target="_blank"
					rel="noreferrer">Get started</a
				>
				<a href="https://docs.btca.dev" class="bc-chip" target="_blank" rel="noreferrer">Docs</a>
			</div>
		</div>
	</section>
</section>
