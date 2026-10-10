<script lang="ts" module>
	export type LegendItem = {
		label: string;
		checked: boolean;
		onToggle: () => void;
		/** Shows a "Go to" button that scrolls the chart to the item. */
		onGo?: () => void;
	};
</script>

<script lang="ts">
	import EyeIcon from '$lib/icon/EyeIcon.svelte';
	import EyeOffIcon from '$lib/icon/EyeOffIcon.svelte';

	// Side panel of the demo pages: a titled list of items with a visibility toggle each.
	// `fixedHeight` gives a list that scrolls inside a tall panel (the schema); the default sizes to
	// its content (markers).
	let {
		title,
		items,
		fixedHeight = false,
		boldLabels = false
	}: { title: string; items: LegendItem[]; fixedHeight?: boolean; boldLabels?: boolean } = $props();
</script>

<details
	class="collapse collapse-arrow bg-base-300 border border-base-300 min-h-[3.6rem] max-h-full"
	name="data"
	open
>
	<summary class="collapse-title font-semibold"> {title} </summary>
	<div class={`collapse-content text-sm p-0 ${fixedHeight ? 'h-100' : ''}`}>
		<ul class="list overflow-auto h-full bg-base-100">
			{#each items as item, i (i)}
				<li class="list-row">
					{#if item.onGo}
						<div class="flex items-center">
							<button class="btn btn-primary btn-xs" onclick={item.onGo}> Go to </button>
						</div>
					{/if}
					<div class="list-col-grow">
						{#if boldLabels}
							<div class="font-bold">{item.label}</div>
						{:else}
							{item.label}
						{/if}
					</div>
					<div class="flex items-center">
						<label class="swap">
							<input type="checkbox" checked={item.checked} onchange={item.onToggle} />
							<div class="swap-on">
								<EyeIcon />
							</div>
							<div class="swap-off">
								<EyeOffIcon />
							</div>
						</label>
					</div>
				</li>
			{/each}
		</ul>
	</div>
</details>
