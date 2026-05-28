import { init, use } from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import {
	DataZoomComponent,
	LegendComponent,
	TitleComponent,
	TooltipComponent,
	GridComponent,
	DatasetComponent,
	MarkLineComponent,
	MarkPointComponent,
	MarkAreaComponent
} from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

use([
	LineChart,
	BarChart,
	DataZoomComponent,
	LegendComponent,
	TitleComponent,
	TooltipComponent,
	GridComponent,
	DatasetComponent,
	LabelLayout,
	CanvasRenderer,
	MarkLineComponent,
	MarkPointComponent,
	MarkAreaComponent
]);

export { init };
