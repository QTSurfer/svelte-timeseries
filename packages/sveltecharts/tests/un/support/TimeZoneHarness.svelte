<!--
  Test-only: mounts SVELightweightCharts and lets a test change its `timeZone` the way an app does.
-->
<script lang="ts">
	import SVELightweightCharts from '../../../src/lib/SVELightweightCharts.svelte';

	let { onLoad }: { onLoad: (chart: unknown) => Promise<void> } = $props();
	let zone = $state<'utc' | 'local'>('utc');

	export function setZone(next: 'utc' | 'local') {
		zone = next;
	}
</script>

<SVELightweightCharts onLoad={onLoad as never} timeZone={zone} />
