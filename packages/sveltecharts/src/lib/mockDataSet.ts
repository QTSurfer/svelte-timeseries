export function createDataSet<T>(hours: number, type: 'object' | 'array') {
	// Create random number between min and max
	const random = (min = 45, max = 50): number => Math.random() * max + min;

	const rows = [];
	const YDimensionsName = ['Column 1', 'Column 2', 'Column 3', 'Column 4', 'Column 5 %'];
	// Create a date range
	let startDate = new Date(2025, 9, 28, 14, 0, 0).getTime();

	// Create random data per hour
	for (let i = 0; i < hours; i++) {
		// Add 1 hour
		const time = new Date(startDate + i * 3600000).getTime();
		if (type === 'object') {
			(rows as Record<string, any>[]).push({
				_ts: time,
				col1: random(),
				col2: random(),
				col3: random(),
				col4: random(),
				'col5%': random(0, 5)
			});
			continue;
		} else {
			rows.push([time, random(), random(), random(), random(), random()]);
			continue;
		}
	}

	return {
		data: rows as T[],
		yDimensionsNames: YDimensionsName
	};
}
