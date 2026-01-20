<script lang="ts">
	import PricingPlans from '$lib/components/pricing/PricingPlans.svelte';
	import { goto } from '$app/navigation';

	function handleSignIn() {
		goto('/app');
	}
</script>

<svelte:head>
	<title>Pricing - Better Context</title>
	<meta name="description" content="btca Pro plan pricing - one plan, built to stay fast." />
</svelte:head>

<div class="mx-auto max-w-5xl">
	<PricingPlans isSignedIn={false} isSubscribed={false} onSignIn={handleSignIn} />
</div>
