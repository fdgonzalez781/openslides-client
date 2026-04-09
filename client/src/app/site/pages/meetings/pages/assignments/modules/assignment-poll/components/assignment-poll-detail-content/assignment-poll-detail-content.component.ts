import {
    AfterViewInit,
    ChangeDetectorRef,
    Component,
    ElementRef,
    Input,
    OnInit,
    QueryList,
    ViewChildren
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { auditTime, combineLatest, filter, iif, map, NEVER, startWith, switchMap } from 'rxjs';
import { Permission } from 'src/app/domain/definitions/permission';
import { PollData } from 'src/app/domain/models/poll/generic-poll';
import {
    PollMethod,
    PollPercentBase,
    PollState,
    PollTableData,
    VotingResult
} from 'src/app/domain/models/poll/poll-constants';
import { Deferred } from 'src/app/infrastructure/utils/promises';
import { ChartData, ChartDate } from 'src/app/site/pages/meetings/modules/poll/components/chart/chart.component';
import { PollService } from 'src/app/site/pages/meetings/modules/poll/services/poll.service';
import { OperatorService } from 'src/app/site/services/operator.service';
import { ThemeService } from 'src/app/site/services/theme.service';

import { ViewPoll } from '../../../../../polls';
import { ViewAssignment } from '../../../../view-models';
import { AssignmentPollService } from '../../services/assignment-poll.service';

@Component({
    selector: `os-assignment-poll-detail-content`,
    templateUrl: `./assignment-poll-detail-content.component.html`,
    styleUrls: [`./assignment-poll-detail-content.component.scss`],
    standalone: false
})
export class AssignmentPollDetailContentComponent implements OnInit, AfterViewInit {
    private _poll: PollData;

    public readonly hasLoaded = new Deferred<boolean>();

    private _tableData: PollTableData[] = [];
    private _chartData: ChartData = null;
    public reformedTableData: PollTableData[];

    private _stvChartData: ChartData;
    private _stvChartLabels: string[];

    @Input()
    public set poll(pollData: PollData) {
        this._poll = pollData;
        this.setupTableData();
        this.cd.markForCheck();
    }

    public get poll(): PollData {
        return this._poll;
    }

    @Input()
    public iconSize: `large` | `gigantic` = `large`;

    @Input()
    public inSlide = false;

    @ViewChildren(`btn`)
    public buttonElements!: QueryList<ElementRef>;

    public get chartData(): ChartData {
        return this._chartData;
    }

    public get tableData(): PollTableData[] {
        return this._tableData;
    }

    public get stvChartData(): ChartData {
        return this._stvChartData;
    }

    public get stvChartLabels(): string[] {
        return this._stvChartLabels;
    }

    private get method(): string | null {
        return this.poll?.pollmethod || null;
    }

    private get state(): PollState | null {
        return this.poll?.state || null;
    }

    public get showYHeader(): boolean {
        return this.isMethodY || this.isMethodYN || this.isMethodYNA;
    }

    public get showNHeader(): boolean {
        return this.isMethodN || this.isMethodYN || this.isMethodYNA;
    }

    public get isMethodY(): boolean {
        return this.method === PollMethod.Y;
    }

    public get isMethodN(): boolean {
        return this.method === PollMethod.N;
    }

    public get isMethodYN(): boolean {
        return this.method === PollMethod.YN;
    }

    public get isMethodYNA(): boolean {
        return this.method === PollMethod.YNA;
    }

    public get isMethodSTV(): boolean {
        return this.method === PollMethod.STV;
    }

    public get classOptionAmount(): string {
        if (this.isMethodY || this.isMethodN || this.isMethodSTV) {
            return `row-1`;
        } else if (this.isMethodYN) {
            return `row-2`;
        }
        return `row-3`;
    }

    public get isStarted(): boolean {
        return this.state === PollState.Started;
    }

    public get isFinished(): boolean {
        return this.state === PollState.Finished;
    }

    public get isPublished(): boolean {
        return this.state === PollState.Published;
    }

    public get shouldShowChart(): boolean {
        const validOptions = this.poll.options.some(
            option => option.yes! >= 0 && option.no! >= 0 && option.abstain! >= 0
        );
        return this.poll.options.length === 1 && this.chartData.length > 0 && validOptions;
    }

    public get hasResults(): boolean {
        return this.isFinished || this.isPublished;
    }

    public get canSeeResults(): boolean {
        return this.operator.hasPerms(Permission.assignmentCanManagePolls) || this.isPublished;
    }

    public get isPercentBaseEntitled(): boolean {
        return this.poll?.onehundred_percent_base === PollPercentBase.Entitled;
    }

    public get isPercentBaseEntitledPresent(): boolean {
        return this.poll?.onehundred_percent_base === PollPercentBase.EntitledPresent;
    }

    public get entitledPresentUsersCount(): number {
        return this.poll?.entitled_users_at_stop.filter(x => x.present).length || 0;
    }

    public get assignmentPollService(): PollService {
        return this.pollService;
    }

    private get assignment(): ViewAssignment {
        return this.poll.content_object as ViewAssignment;
    }

    public get enumerateCandidates(): boolean {
        return this.assignment?.number_poll_candidates || false;
    }

    public get showEntriesAmount(): boolean {
        return !!this.poll.options[0]?.entries_amount;
    }

    public constructor(
        private translate: TranslateService,
        private pollService: AssignmentPollService,
        private cd: ChangeDetectorRef,
        private operator: OperatorService,
        private themeService: ThemeService
    ) { }

    public ngOnInit(): void {
        combineLatest([
            this.poll.options$,
            iif(
                () => this.poll instanceof ViewPoll,
                (this.poll as ViewPoll).options$.pipe(
                    map(options => options.filter(option => !!option.content_object_id && !!option.content_object$)),
                    filter(options => !!options.length),
                    switchMap(options =>
                        combineLatest(
                            options.map(option =>
                                option.content_object$.pipe(filter(content_object => !!content_object))
                            )
                        ).pipe(auditTime(1))
                    )
                ),
                NEVER
            ).pipe(startWith(null)),
            this.themeService.currentGeneralColorsSubject
        ]).subscribe(() => this.setupTableData());
    }

    public ngAfterViewInit(): void {
        setTimeout(() => this.hasLoaded.resolve(true));
    }

    private setupTableData(): void {
        this._tableData = this.pollService.generateTableData(this.poll);
        this.updateReformedTableData();
        this.setChartData();
        this.cd.markForCheck();
    }

    private updateReformedTableData(): void {
        this.reformedTableData = [];
        this.tableData.forEach(tableDate => {
            if ([`user`, `list`].includes(tableDate.class)) {
                tableDate.value.forEach(value => {
                    if (this.voteFitsMethod(value)) {
                        this.reformedTableData.push({
                            class: tableDate.class,
                            votingOption: value.vote,
                            value: [value]
                        });
                    }
                });
            } else {
                this.reformedTableData.push(tableDate);
            }
        });
    }

    private setAlpha(color: string, alpha: number): string {
        let rgbaValues = color.substring(5, color.length - 1).split(",").map(it => +it.trim());
        return `rgba(${rgbaValues[0]}, ${rgbaValues[1]}, ${rgbaValues[2]}, ${alpha})`;
    }

    private setChartData(): void {
        this._chartData = this.pollService.generateChartData(this.poll).filter(option => option.data[0] > 0);
        const candidate_option_ids: number[][] = this.assignment?.candidatesAsUsers.map(it => it.option_ids.map(it => +it));
        this._stvChartLabels = this.assignment?.candidatesAsUsers.map(it => it.name);
        console.log(this.assignment?.candidatesAsUsers);

        const colors = ["rgba(54, 162, 235, 0.8)", "rgba(254, 99, 131, 0.8)", "rgba(74, 192, 192, 0.8)", "rgba(255, 159, 64, 0.8)", "rgba(153, 102, 255, 0.8)", "rgba(255, 204, 85, 0.8)", "rgba(202, 203, 207, 0.8)"]

        const stvData: ChartData = []
        console.log(this.poll.round_by_round);
        const rbrResults = [];
        const elected = [];
        const eliminated = [];
        this.poll.round_by_round.forEach(it => {
            const elements = it.split("/");
            if (isNaN(+elements[2])) {
                const el = {
                    round: +elements[0],
                    candidate: +elements[1],
                    result: elements[2]
                };

                console.log(el);

                if (el.result === "elect") {
                    console.log(`Elected: ${el.candidate}, round ${el.round}`);
                    elected.push(el);
                } else {
                    console.log(`Eliminated: ${el.candidate}, round ${el.round}`);
                    eliminated.push(el);
                }
            } else {
                rbrResults.push({
                    round: +elements[0],
                    candidate: +elements[1],
                    votes: +elements[2]
                });
            }
        });
        console.log(rbrResults);

        const finalResults = rbrResults.reduce((acc, current) => {
            if (!acc[`${current.candidate}`]) {
                acc[`${current.candidate}`] = current.votes;
                console.log(acc);
                return acc;
            }

            acc[`${current.candidate}`] += current.votes;
            return acc;
        }, {});

        elected.forEach(el => {
            const surplus = finalResults[`${el.candidate}`] - this.poll.quota;
            if (surplus > 0) {
                rbrResults.push({
                    round: el.round,
                    candidate: el.candidate,
                    votes: -surplus
                });
            }
        });

        rbrResults.forEach(el => {
            const index = candidate_option_ids.findIndex(arr => arr.includes(el.candidate));
            if (index != -1) {
                const resultObj = elected.map(it => it.candidate).includes(el.candidate) ? elected.find(it => it.candidate === el.candidate) : eliminated.find(it => it.candidate === el.candidate);
                if (!stvData[el.round]) {
                    let color = colors[el.round % colors.length];
                    const data = Array(index + 1).fill(0);
                    const cols = Array(index + 1).fill(color);
                    const candidate = this._stvChartLabels[index];
                    data[index] = el.votes;
                    cols[index] = resultObj.result === "elect" ? color : this.setAlpha(color, 0.3);
                    stvData[el.round] = {
                        type: "bar",
                        data: data.map(it => {
                            return {
                                votes: it,
                                candidate: this._stvChartLabels[index],
                                color: color,
                                round: el.round,
                                result: resultObj ? { outcome: resultObj.result, round: resultObj.round } : null,
                                quota: this.poll.quota
                            };
                        }),
                        label: `Round ${el.round + 1}`,
                        backgroundColor: cols,
                    };
                } else {
                    console.log(stvData[el.round]);
                    const color = stvData[el.round].data[0].color;
                    stvData[el.round].data[index] = {
                        votes: el.votes,
                        candidate: this._stvChartLabels[index],
                        color: color,
                        round: el.round,
                        result: resultObj ? { outcome: resultObj.result, round: resultObj.round } : null,
                        quota: this.poll.quota
                    };
                    stvData[el.round].backgroundColor[index] = resultObj.result === "elect" ? color : this.setAlpha(color, 0.3);
                }
            }
        });

        console.log(stvData);

        if (stvData[stvData.length - 1].data.length == 1 && stvData[stvData.length - 1].data[0].votes < 0) {
            stvData.pop();
        }

        console.log(stvData);

        stvData.push({
            type: "line",
            data: Array(this._stvChartLabels.length).fill(this.poll.quota),
            label: "Quota",
            backgroundColor: "rgba(76, 175, 80, 0.8)",
            borderColor: "rgba(76, 175, 80, 0.8)",
        });
        this._stvChartData = stvData;
    }

    public getVoteClass(votingResult: VotingResult): string {
        const votingClass = votingResult.vote as string;
        if (this.isMethodN && votingClass === `no`) {
            return `yes`;
        } else {
            return votingClass;
        }
    }

    public filterRelevantResults(votingResult: VotingResult[]): VotingResult[] {
        return votingResult.filter(result => result && this.voteFitsMethod(result));
    }

    public getVoteAmount(vote: VotingResult, row: PollTableData): number {
        vote.amount = vote.amount ?? 0;
        if (this.isMethodN && [`user`, `list`].includes(row.class)) {
            if (vote.amount < 0) {
                return vote.amount;
            } else {
                const amount_global_abstain = this.poll.global_option?.abstain ?? 0;
                return this.poll!.votesvalid - vote.amount - amount_global_abstain;
            }
        } else {
            return vote.amount;
        }
    }

    public voteFitsMethod(result: VotingResult): boolean {
        if (!result.vote) {
            return true;
        }
        if (this.isMethodY || this.isMethodSTV) {
            return result.vote === `yes`;
        } else if (this.isMethodN) {
            return result.vote === `no`;
        } else if (this.isMethodYN) {
            return result.vote !== `abstain`;
        } else {
            return true;
        }
    }

    public ariaLabel(str: string): string {
        if (str === `place`) {
            return this.translate.instant(`Candidate placement`);
        }
        return this.translate.instant(`Candidate name`);
    }
}
