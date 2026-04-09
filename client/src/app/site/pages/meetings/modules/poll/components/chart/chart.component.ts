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
        // let eliminatedCandidate = "";
        // if (previousRound >= 0) {
        //     const data = chart.getDatasetMeta(previousRound).data;
        //     for (let i = 0; i < data.length; ++i) {
        //         if (!items.map(it => it.element["$context"].raw.candidate).includes(data[i]["$context"].raw.candidate)) {
        //             eliminatedCandidate = data[i]["$context"].raw.candidate;
        //             items.push({ element: data[i], datasetIndex: previousRound, index: i })
        //         }
        //     }
        // }

        for (let r = previousRound; r >= 0; r--) {
            const data = chart.getDatasetMeta(r).data;
            data.forEach((item, i) => {
                items.push({ element: item, datasetIndex: r, index: i });
            });
        }

        // if (eliminatedCandidate !== "" && previousRound - 1 >= 0) {
        //     for (let r = previousRound - 1; r >= 0; r--) {
        //         const data = chart.getDatasetMeta(r).data;
        //         const i = data.findIndex(it => it["$context"].raw.candidate === eliminatedCandidate);
        //         items.push({ element: data[i], datasetIndex: r, index: i });
        //     }
        // }
    }
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
    backgroundColor?: any;
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
                animation: {
                    duration: 0
                },
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
                    duration: 500
                },
                scales: {
                    x: {
                        grid: {
                            drawOnChartArea: false
                        },
                        // ticks: { stepSize: 1 },
                        ticks: {
                            font: {
                                family: "'OSFont Condensed', 'Fira Sans Condensed', 'Roboto-condensed', 'Arial', 'Helvetica', sans-serif",
                                size: 16
                            },
                        },
                        stacked: 'single',
                        min: 0,
                        beginAtZero: true
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
                        stacked: true,
                        beginAtZero: true
                    }
                },
                plugins: {
                    tooltip: {
                        enabled: true,
                        mode: 'dataset',
                        callbacks: {
                            label: function(tooltipItem) {
                                let candidate = tooltipItem.label;
                                let total = 0;
                                for (let r = tooltipItem.datasetIndex; r >= 0; r--) {
                                    const data = tooltipItem.chart.getDatasetMeta(r).data.find(it => it["$context"].raw.candidate === candidate && it["$context"].raw.votes > 0);
                                    if (data) {
                                        total += data["$context"].raw.votes;
                                    }
                                }

                                if (Object.hasOwn(tooltipItem.raw as any, 'round')) {
                                    const data = tooltipItem.raw as any
                                    const afterFirstRound = data.round > 0;
                                    if (data.votes == 0) {
                                        return ``;
                                    }
                                    const adjustment = data.votes > 0 ? `+${data.votes}` : `${data.votes}`;
                                    total = data.votes > 0 ? total : total + data.votes;
                                    return afterFirstRound ? `${candidate}: ${total} (${adjustment})` : `${candidate}: ${total}`;
                                }

                                return `${candidate}: ${total}`;
                            },
                            footer: function(tooltipItems) {
                                const prevRound = tooltipItems[0].datasetIndex - 1;
                                if (prevRound < 0) {
                                    return "";
                                }

                                const eliminatedCandidate = tooltipItems[0].chart.getDatasetMeta(prevRound).data.find(element => {
                                    const res = element["$context"].raw.result;
                                    return res.outcome === "elim" && res.round === prevRound + 1;
                                });

                                if (eliminatedCandidate) {
                                    let eliminatedVotes = 0;
                                    for (let r = prevRound; r >= 0; r--) {
                                        const data = tooltipItems[0].chart.getDatasetMeta(r).data.find(it => it["$context"].raw.candidate === eliminatedCandidate["$context"].raw.candidate && it["$context"].raw.votes > 0);
                                        if (data) {
                                            eliminatedVotes += data["$context"].raw.votes;
                                        }
                                    }
                                    return `Eliminated: ${eliminatedCandidate["$context"].raw.candidate} (${eliminatedVotes})`;
                                } else {
                                    return "";
                                }
                            }
                        }
                    },
                    legend: {
                        display: this.legend,
                        labels: {
                            font: {
                                family: "'OSFont Condensed', 'Fira Sans Condensed', 'Roboto-condensed', 'Arial', 'Helvetica', sans-serif"
                            }
                        },
                        onClick: null,
                        onHover: this.handleChartHover,
                        onLeave: this.handleLeave
                    },
                },
                indexAxis: 'y',
                elements: {
                    point: {
                        radius: 0
                    },
                    // bar: {
                    //     backgroundColor: this.fadeEliminated,
                    // }
                },
                parsing: {
                    xAxisKey: 'votes',
                    yAxisKey: 'candidate'
                },
                onHover: this.handleChartHover,
                // hover: {
                //     mode: 'customMode'
                // },
                // interaction: {
                //     mode: 'customMode'
                // },
            };
        }
    }

    private handleChartHover(evt, active, chartRef) {
        let item;
        if (Array.isArray(active)) {
            item = active[0];
        } else {
            item = active;
        }

        let chart;
        if (Object.hasOwn(chartRef, "chart")) {
            chart = chartRef.chart;
        } else {
            chart = chartRef;
        }

        //const item = active[0];
        if (!item) {
            chart.data.datasets.filter(it => it.type === "bar").forEach(dataset => {
                const colors = dataset.data.map(element => element.result.outcome === "elect" ? element.color : setAlpha(element.color, 0.4));
                dataset.backgroundColor = colors;
            });

            chart.update();
            return;
        }

        function setAlpha(color: string, alpha: number): string {
            let rgbaValues = color.substring(5, color.length - 1).split(",").map(it => +it.trim());
            return `rgba(${rgbaValues[0]}, ${rgbaValues[1]}, ${rgbaValues[2]}, ${alpha})`;
        }

        const colorGainedVotes = "rgba(76, 175, 80, 1)";
        const colorLostVotes = "rgba(204, 108, 91, 1)";

        chart.data.datasets.filter(it => it.type === "bar").forEach(dataset => {
            const setRound = dataset.data[0].round;
            // let colors = dataset.backgroundColor;
            let colors = dataset.data.map(element => setAlpha(element.color, 0.3));

            // Color bars from the current round green, and fade out otherwise
            if (setRound === item.datasetIndex) {
                dataset.data.forEach((element, index) => {
                    console.log(element.votes);
                    if (element.votes > 0) {
                        colors[index] = colorGainedVotes;
                    } else {
                        colors[index] = colorLostVotes;
                    }
                })
            }

            if (setRound < item.datasetIndex) {
                dataset.data.forEach((element, index) => {
                    if (element.result.outcome === "elim") {
                        // Color all bars from newly eliminated candidates red
                        if (element.result.round === item.datasetIndex) {
                            colors[index] = colorLostVotes;
                        }

                        // Hide all bars from candidates that have already been eliminated in a previous round
                        if (element.result.round < item.datasetIndex) {
                            colors[index] = setAlpha(element.color, 0);
                        }
                    }
                });
            }

            if (setRound > item.datasetIndex) {
                dataset.data.forEach((element, index) => {
                    colors[index] = setAlpha(element.color, 0);
                });
            }

            dataset.backgroundColor = colors;
        });

        chart.update();
    }

    private handleHover(evt, item, legend) {
        if (item.text === "Quota") {
            return;
        }

        this.handleChartHover(evt, [item], legend.chart);
    }

    private handleXHover(evt, item, legend) {
        if (item.text === "Quota") {
            return;
        }

        function setAlpha(color: string, alpha: number): string {
            let rgbaValues = color.substring(5, color.length - 1).split(",").map(it => +it.trim());
            return `rgba(${rgbaValues[0]}, ${rgbaValues[1]}, ${rgbaValues[2]}, ${alpha})`;
        }

        const colorGainedVotes = "rgba(76, 175, 80, 1)";
        const colorLostVotes = "rgba(204, 108, 91, 1)";

        legend.chart.data.datasets.filter(it => it.type === "bar").forEach(dataset => {
            const setRound = dataset.data[0].round;
            let colors = dataset.backgroundColor;

            // Color bars from the current round green, and fade out otherwise
            if (setRound === item.datasetIndex) {
                dataset.data.forEach((element, index) => {
                    console.log(element.votes);
                    if (element.votes > 0) {
                        colors[index] = colorGainedVotes;
                    } else {
                        colors[index] = colorLostVotes;
                    }
                });
            }

            if (setRound < item.datasetIndex) {
                dataset.data.forEach((element, index) => {
                    if (element.result.outcome === "elim") {
                        // Color all bars from newly eliminated candidates red
                        if (element.result.round === item.datasetIndex) {
                            colors[index] = colorLostVotes;
                        }

                        // Hide all bars from candidates that have already been eliminated in a previous round
                        if (element.result.round < item.datasetIndex) {
                            colors[index] = setAlpha(colors[index], 0);
                        }
                    }
                });
            }

            if (setRound > item.datasetIndex) {
                dataset.data.forEach((_, index) => {
                    colors[index] = setAlpha(colors[index], 0);
                });
            }

            dataset.backgroundColor = colors;
        });

        legend.chart.update();
    }

    private handleLeave(evt, item, legend) {
        if (item.text === "Quota") {
            return;
        }

        function setAlpha(color: string, alpha: number): string {
            let rgbaValues = color.substring(5, color.length - 1).split(",").map(it => +it.trim());
            return `rgba(${rgbaValues[0]}, ${rgbaValues[1]}, ${rgbaValues[2]}, ${alpha})`;
        }

        legend.chart.data.datasets.filter(it => it.type === "bar").forEach(dataset => {
            const colors = dataset.data.map((element, index) => element.result.outcome === "elect" ? element.color : setAlpha(element.color, 0.4));
            dataset.backgroundColor = colors;
        });

        legend.chart.update();
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
