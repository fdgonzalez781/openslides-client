import { Component, Input } from '@angular/core';
import { ChartjsComponent } from '@coreui/angular-chartjs';
import { ChartData as NgChartData, ChartOptions, ChartType, Interaction, InteractionModeFunction } from 'chart.js';
import { getRelativePosition } from 'chart.js/helpers';

declare module 'chart.js' {
    interface InteractionModeMap {
        customMode: InteractionModeFunction;
    }
}


Interaction.modes.customMode = function(chart, e, options, useFinalPosition) {
    const position = getRelativePosition(e, chart);
    const items = Interaction.modes.dataset(chart, e, options, useFinalPosition);
    if (items.length > 0) {
        let previousRound = items[0].datasetIndex - 1;
        let eliminatedCandidate = "";
        if (previousRound >= 0) {
            const data = chart.getDatasetMeta(previousRound).data;
            console.log(items.map(it => it.element["$context"].raw.candidate));
            // console.log(data);
            for (let i = 0; i < data.length; ++i) {
                if (!items.map(it => it.element["$context"].raw.candidate).includes(data[i]["$context"].raw.candidate)) {
                    eliminatedCandidate = data[i]["$context"].raw.candidate;
                    items.push({ element: data[i], datasetIndex: previousRound, index: i })
                }
            }
        }

        if (eliminatedCandidate !== "" && previousRound - 1 >= 0) {
            for (let r = previousRound - 1; r >= 0; r--) {
                const data = chart.getDatasetMeta(r).data;
                const i = data.findIndex(it => it["$context"].raw.candidate === eliminatedCandidate);
                items.push({ element: data[i], datasetIndex: r, index: i });
            }
        }
    }
    // Interaction.evaluateInteractionItems(chart, 'x', position, (element, datasetIndex, index) => {
    //     if (element.inXRange(position.x, useFinalPosition)) {
    //         items.push({ element, datasetIndex, index });
    //     }
    // });
    return items;
};

export type ChartData = ChartDate[];

/**
 * One single collection in an array.
 */
export interface ChartDate {
    type: ChartType;
    data: any[];
    label?: string;
    backgroundColor?: string;
    hoverBackgroundColor?: string;
    borderColor?: string;
    barThickness?: number;
    maxBarThickness?: number;
    order?: number;
}

type SingleLineLabel = string;
type MultiLineLabel = string[];
type Label = SingleLineLabel | MultiLineLabel;

@Component({
    selector: `os-chart`,
    templateUrl: `./chart.component.html`,
    styleUrls: [`./chart.component.scss`],
    imports: [ChartjsComponent]
})
export class ChartComponent {
    /**
     * The type of the chart.
     */
    @Input()
    public type: ChartType = `bar`;

    /**
     * The labels for the separated sections.
     * Each label represent one section, e.g. one year.
     */
    @Input()
    public labels: Label[] = [];

    /**
     * Show a legend
     */
    @Input()
    public legend = false;

    /**
     * Required since circle charts demand SingleDataSet-Objects
     */
    @Input()
    public set circleColors(colors: { backgroundColor?: string[]; hoverBackgroundColor?: string[] }[]) {
        this.colors = colors;
        this._circleColors = colors;
    }

    /**
     * Threshold for STV charts = quota
     */
    @Input()
    public threshold = 4;

    private _circleColors: { backgroundColor?: string[]; hoverBackgroundColor?: string[] }[];

    public colors: { backgroundColor?: string[]; hoverBackgroundColor?: string[] }[];

    /**
     * The general data for the chart.
     * This is only needed for `type == 'bar' || 'line'`
     */
    public chartData: NgChartData<ChartType> = { datasets: [], labels: [] };

    @Input()
    public set data(inputData: ChartDate[]) {
        if (inputData && inputData.length) {
            this.progressInputData(inputData);
        }
    }

    /**
     * The options used for the charts.
     */
    public get chartOptions(): ChartOptions {
        if (this.isCircle) {
            return {
                responsive: true,
                maintainAspectRatio: false,
                // animation: {
                //     duration: 0
                // },
                plugins: {
                    tooltip: {
                        enabled: false
                    },
                    legend: {
                        display: this.legend,
                        position: `left`
                    }
                }
            };
        } else {
            return {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 0
                },
                scales: {
                    x: {
                        grid: {
                            drawOnChartArea: false
                        },
                        beginAtZero: true,
                        // ticks: { stepSize: 1 },
                        ticks: {
                            font: {
                                family: "'OSFont Condensed', 'Fira Sans Condensed', 'Roboto-condensed', 'Arial', 'Helvetica', sans-serif",
                                size: 16
                            }
                        },
                        stacked: true
                    },
                    y: {
                        grid: {
                            drawOnChartArea: false,
                            drawTicks: false
                        },
                        ticks: {
                            font: {
                                family: "'OSFont Condensed', 'Fira Sans Condensed', 'Roboto-condensed', 'Arial', 'Helvetica', sans-serif",
                                size: 16
                            }
                        },
                        // ticks: { mirror: true, labelOffset: -20 },
                        stacked: true
                    }
                },
                plugins: {
                    tooltip: {
                        enabled: true
                    },
                    legend: {
                        display: this.legend,
                        labels: {
                            font: {
                                family: "'OSFont Condensed', 'Fira Sans Condensed', 'Roboto-condensed', 'Arial', 'Helvetica', sans-serif"
                            }
                        }
                    },
                },
                indexAxis: 'y',
                elements: {
                    point: {
                        radius: 0
                    },
                    bar: {
                        backgroundColor: this.colorize
                    }
                },
                parsing: {
                    xAxisKey: 'votes',
                    yAxisKey: 'candidate'
                },
                interaction: {
                    // mode: 'dataset'
                    mode: 'customMode'
                },
            };
        }
    }

    private colorize(ctx, options) {
        function transparentize(color: string, alpha: number): string {
            let rgbaValues = color.substring(5, color.length - 1).split(",").map(it => +it.trim());
            const newValues = rgbaValues.map(it => it * alpha)
            return `rgba(${rgbaValues[0]}, ${rgbaValues[1]}, ${rgbaValues[2]}, ${newValues[3]})`;
        }

        const totalVotes = Object.values(ctx.parsed._stacks.x._visualValues).reduce((a: number, b: number) => a + b) as number;
        const color = ctx.raw.color;

        if (ctx.active) {
            // console.log(ctx);
            const latestRound = Math.max(...ctx.chart._active.map(it => it.datasetIndex));
            const next = ctx.raw.round + 1;
            const stillInRunning = ctx.chart.getDatasetMeta(next).data.map(it => it.$context.raw).some(it => it.candidate === ctx.raw.candidate);
            if (ctx.raw.round < latestRound /* && !stillInRunning */) {
                return "rgba(204, 108, 91, 1)";
            }

            if (ctx.raw.round === latestRound) {
                return "rgba(76, 175, 80, 1)";
            }

            return transparentize(color, 0.3);
        }

        if (totalVotes < ctx.raw.quota && !ctx.active) {
            return transparentize(color, 0.2);
        }

        return transparentize(color, 0.7);
    }


    public get isReadyToShow(): boolean {
        return !!this.chartData.labels.length;
    }

    public get isCircle(): boolean {
        return this.type === `pie` || this.type === `doughnut`;
    }

    public get isBar(): boolean {
        return !this.isCircle;
    }

    public calcBarChartHeight(): string | undefined {
        if (!this.isCircle) {
            const baseHeight = 120;
            const perLabel = 60;
            return `${baseHeight + perLabel * this.labels.length}px`;
        } else {
            return `260px`;
        }
    }

    private calculateCircleColors(inputChartData: ChartData): {
        backgroundColor?: string[];
        hoverBackgroundColor?: string[];
    }[] {
        return [
            {
                backgroundColor: inputChartData.map(chartDate => chartDate.backgroundColor).filter(color => !!color),
                hoverBackgroundColor: inputChartData
                    .map(chartDate => chartDate.hoverBackgroundColor)
                    .filter(color => !!color)
            }
        ];
    }

    private progressInputData(inputChartData: ChartDate[]): void {
        if (this.isCircle) {
            const data = inputChartData.flatMap(chartDate => {
                // removes undefined and null values
                return chartDate.data.filter(data => !!data);
            });
            const newCircleColors = this.calculateCircleColors(inputChartData);
            if (
                !this._circleColors &&
                newCircleColors?.length &&
                newCircleColors[0].backgroundColor &&
                newCircleColors[0].backgroundColor.length &&
                JSON.stringify(newCircleColors) !== JSON.stringify(this.circleColors)
            ) {
                this.colors = newCircleColors;
            }
            this.chartData.datasets = [
                {
                    data: data,
                    backgroundColor: this.colors[0].backgroundColor,
                    hoverBackgroundColor: this.colors[0].hoverBackgroundColor,
                    hoverBorderColor: this.colors[0].hoverBackgroundColor,
                    hoverBorderWidth: 0
                }
            ];
        } else {
            this.chartData.datasets = inputChartData;
            this.chartData.labels = this.labels;
        }

        if (!this.labels) {
            this.labels = inputChartData.map(chartDate => chartDate.label);
            this.chartData.labels = this.labels;
        }
    }
}
