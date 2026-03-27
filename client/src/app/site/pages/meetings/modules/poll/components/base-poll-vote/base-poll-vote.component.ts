import { ChangeDetectorRef, Directive, inject, Input, OnInit } from '@angular/core';
import { UntypedFormBuilder, UntypedFormControl, UntypedFormGroup, Validators } from '@angular/forms';
import { _ } from '@ngx-translate/core';
import { BehaviorSubject, combineLatest, debounceTime, distinctUntilChanged, Observable, Subscription } from 'rxjs';
import { Id } from 'src/app/domain/definitions/key-types';
import { Selectable } from 'src/app/domain/interfaces';
import { UserSelectionData } from 'src/app/site/pages/meetings/modules/participant-search-selector/index';
import { ParticipantControllerService } from 'src/app/site/pages/meetings/pages/participants/services/common/participant-controller.service/participant-controller.service';
import {
    GlobalVote,
    IdentifiedVotingData,
    PollContentObject,
    PollPropertyVerbose,
    PollType,
    VoteValue,
    VotingData
} from 'src/app/domain/models/poll';
import { BaseComponent } from 'src/app/site/base/base.component';
import { BaseViewModel } from 'src/app/site/base/base-view-model';
import { PollControllerService } from 'src/app/site/pages/meetings/modules/poll/services/poll-controller.service';
import { AssignmentControllerService } from 'src/app/site/pages/meetings/pages/assignments/services/assignment-controller.service';
// import { AssignmentCandidateControllerService } from 'src/app/site/pages/meetings/pages/assignments/pages/assignment-detail/services/assignment-candidate-controller.service';
import { ViewOption, ViewPoll } from 'src/app/site/pages/meetings/pages/polls';
import { ViewUser } from 'src/app/site/pages/meetings/view-models/view-user';
import { OperatorService } from 'src/app/site/services/operator.service';
import { ViewPortService } from 'src/app/site/services/view-port.service';
import { CustomIcon } from 'src/app/ui/modules/custom-icon/definitions';

import { MeetingSettingsService } from '../../../../services/meeting-settings.service';
import { VoteControllerService } from '../../services/vote-controller.service';
import { VotingProhibition, VotingService } from '../../services/voting.service';

export interface VoteOption {
    vote?: VoteValue;
    css?: string;
    label: string;
}

export interface PollVoteViewSettings {
    hideLeftoverVotes?: boolean;
    hideGlobalOptions?: boolean;
    hideSendNow?: boolean;
    isSplitSingleOption?: boolean;
}

@Directive()
export abstract class BasePollVoteComponent<C extends PollContentObject = any> extends BaseComponent implements OnInit {
    public readonly drawnCross = CustomIcon.DRAWN_CROSS;

    @Input()
    public set poll(value: ViewPoll<C>) {
        this._poll = value;
        this.updatePoll();
	value.options.forEach(option => {
	    const user = option.getContentObject();
	    this._userToOptionId[user.id] = option.id;
	});
	this.candidates = value.options.map(it => it.getContentObject());
	this._candidateOptionIds = value.options.map(it => it.id);
	this.filterCandidates();
    }

    public get poll(): ViewPoll<C> {
        return this._poll;
    }

    @Input()
    public set displayInAutopilot(is_in_autopilot: boolean) {
        this.displayed_in_autopilot = is_in_autopilot;
    }

    protected displayed_in_autopilot = true;

    public PollType = PollType;
    public formControlMap: Record<number, UntypedFormControl> = {};

    public candidatesForm: UntypedFormGroup;
    public placeholder = this.translate.instant(`Select candidate to rank`);
    public candidates: PollContentObject[] = [];

    private _sortedOptionContents: PollContentObject[] = [];
    private _filteredCandidatesSubject = new BehaviorSubject<PollContentObject[]>([]);
    private _nonSelectableUserIds: number[] = [];
    private _userToOptionId: Record<number, number> = {};
    private _candidateOptionIds: number[] = [];

    public get sortedOptionContents() {
	return this._sortedOptionContents;
    }
    
    public get filteredCandidatesSubject(): BehaviorSubject<PollContentObject[]> {
	return this._filteredCandidatesSubject;
    }

    public set nonSelectableUserIds(userIds: number[]) {
	this._nonSelectableUserIds = userIds;
	this.filterCandidates();
    }

    private filterCandidates(): void {
	const notAvailable = this._nonSelectableUserIds;
	const availableUsers = this.candidates.filter(user => !notAvailable.includes(user.id));
	this._filteredCandidatesSubject.next(availableUsers);
    }

    public onSortingChange(newContents: PollContentObject[], user: ViewUser = this.user) {
	this._sortedOptionContents = newContents;
	this.saveRankedChoice(newContents.map(it => it.id), user);
    }

    public handleNotFound(): void {}

    public get minVotes(): number {
        return this.poll.min_votes_amount;
    }

    public votingErrors = VotingProhibition;

    public get isReady(): boolean {
        return this._isReady;
    }

    public get isUserPresent(): boolean {
        return this.user?.isPresentInMeeting();
    }

    public get isUserInMeeting(): boolean {
        return this.user?.isInActiveMeeting;
    }

    public get isMobile(): boolean {
        return this.viewport.isMobile;
    }

    public PollPropertyVerbose = PollPropertyVerbose;

    public delegations: ViewUser[] = [];

    public readonly voteOptions: VoteOption[] = [
        {
            vote: `Y`,
            css: `voted-yes`,
            label: `Yes`
        },
        {
            vote: `N`,
            css: `voted-no`,
            label: `No`
        },
        {
            vote: `A`,
            css: `voted-abstain`,
            label: `Abstain`
        }
    ];

    /**
     * Subset of voteOptions that is used based on the pollmethod.
     */
    public voteActions: VoteOption[] = [];

    public get showAvailableVotes(): boolean {
        return !this.poll.isListPoll && this.poll.max_votes_amount > 1;
    }

    /**
     * Subset of global voteOptions that is used.
     */
    public globalVoteActions: VoteOption[] = [];

    // eslint-disable-next-line @typescript-eslint/class-literal-property-style
    public get pollHint(): string {
        return null;
    }

    public readonly settings: PollVoteViewSettings = {};

    public readonly noDataLabel: string = _(`No data`);

    public readonly maxVotesPerOptionSuffix: string = _(`votes per option`);

    public readonly optionPluralLabel: string = _(`Options`);

    public voteDelegationEnabled: Observable<boolean> =
        this.meetingSettingsService.get(`users_enable_vote_delegations`);

    public forbidDelegationToVote: Observable<boolean> =
        this.meetingSettingsService.get(`users_forbid_delegator_to_vote`);

    protected voteRequestData: IdentifiedVotingData = {};

    protected alreadyVoted: Record<number, boolean> = {};

    protected deliveringVote: Record<number, boolean> = {};

    protected user!: ViewUser;

    private _isReady = false;
    private _poll!: ViewPoll<C>;
    private _delegationsMap: Record<number, ViewUser> = {};
    private _canVoteForSubjectMap: Record<number, BehaviorSubject<boolean>> = {};

    private voteRepo = inject(VoteControllerService);
    private userRepo = inject(ParticipantControllerService);

    protected votingService = inject(VotingService);
    protected cd = inject(ChangeDetectorRef);
    private pollRepo = inject(PollControllerService);
    private operator = inject(OperatorService);
    private viewport = inject(ViewPortService);
    protected formBuilder = inject(UntypedFormBuilder);
    private votedSubscription: Subscription;
    private votedSubscriptionPollId: Id;

    public constructor(private meetingSettingsService: MeetingSettingsService) {
        super();
        this.updatePollOptionTitleWidth();
        this.subscriptions.push(
            this.operator.userObservable.pipe(debounceTime(50)).subscribe(user => {
                if (
                    user &&
                    (!user.getMeetingUser()?.vote_delegated_to_id || user.getMeetingUser()?.vote_delegated_to)
                ) {
                    this.user = user;
                    this.delegations = user.vote_delegations_from();
                    this.voteRequestData[this.user.id] = { value: {} } as VotingData;
                    if (this.poll.hasVoted !== undefined) {
                        this.alreadyVoted[this.user.id] = this.poll.hasVoted;
                    }
                    if (this.delegations && this.poll.user_has_voted_for_delegations !== undefined) {
                        this.setupDelegations(this.poll.user_has_voted_for_delegations);
                    }

                    this.setupHasVotedSubscription();
                    this._isReady = true;
                    this.cd.markForCheck();
                }
            }),
            this.translate.onLangChange.subscribe(() => {
                this.updatePollOptionTitleWidth();
            }),
            combineLatest([
                this.meetingSettingsService.get(`users_enable_vote_delegations`).pipe(distinctUntilChanged()),
                this.meetingSettingsService.get(`users_forbid_delegator_to_vote`).pipe(distinctUntilChanged())
            ]).subscribe(_ => {
                for (const key of Object.keys(this._canVoteForSubjectMap)) {
                    this._canVoteForSubjectMap[+key].next(this.canVote(this._delegationsMap[+key]));
                }
            }),
            this.viewport.isMobileSubject.subscribe(() => {
                this.cd.markForCheck();
            })
        );
	this.candidatesForm = this.formBuilder.group({
	    userId: null
	});
    }

    public ngOnInit(): void {
        this.defineVoteOptions();
        this.cd.markForCheck();
	this.subscriptions.push(
	    this.candidatesForm.valueChanges.subscribe(async formResult => {
		if (formResult?.userId && typeof formResult?.userId === `number`) {
		    await this.processSelectedUser(formResult.userId, this.user);
		    this.candidatesForm.reset();
		}
	    })
	);
    }

    private processSelectedUser(userId: number, user: ViewUser): void {
        if (this._filteredCandidatesSubject.value.some(it => it.id === userId)) {
            this.removeUserFromSelectorList(userId);
	    this.addCandidateToRankList(userId, user);
        } else {
            throw new Error(`Tried to select an unselectable user`);
        }
    }

    private removeUserFromSelectorList(userId: number): void {
	this.nonSelectableUserIds = [...this._nonSelectableUserIds, userId];
    }

    public async addCandidateToRankList(userId: number, user: ViewUser): Promise<void> {
	const candidateUser = this.userRepo.getViewModel(userId) as unknown as PollContentObject;
	this.onSortingChange([...this.sortedOptionContents, candidateUser], user);
    }

    public async unrankCandidate(candidate: PollContentObject, user: ViewUser): Promise<void> {
	this.nonSelectableUserIds = this._nonSelectableUserIds.filter(it => {
		return it !== candidate.id
	});
	this.onSortingChange(this.sortedOptionContents.filter(it => {
		return it.id !== candidate.id;
	}), user);
    }

    private updatePollOptionTitleWidth(): void {
        document.documentElement.style.setProperty(
            `--poll-option-title-width`,
            `${Math.max(
                Math.max(...this.voteOptions.map(option => this.translate.instant(option.label).length * 9)),
                70
            )}px`
        );
    }

    public isDeliveringVote(user: ViewUser = this.user): boolean {
        return this.deliveringVote[user?.id];
    }

    public hasAlreadyVoted(user: ViewUser = this.user): boolean {
        return this.alreadyVoted[user?.id];
    }

    public canVoteForObservable(user: ViewUser = this.user): Observable<boolean> {
        if (!this._canVoteForSubjectMap[user.id]) {
            this._canVoteForSubjectMap[user.id] = new BehaviorSubject(this.canVote(user));
        }
        return this._canVoteForSubjectMap[user.id];
    }

    public getVotingError(user: ViewUser = this.user): string {
        return this.votingService.getVotingProhibitionReasonVerbose(this.poll, user) || ``;
    }

    public getVotingErrorFromName(errorName: string): string {
        return this.votingService.getVotingProhibitionReasonVerboseFromName(errorName) || ``;
    }

    public getVotesCount(user: ViewUser = this.user): number {
        if (this.voteRequestData[user?.id]) {
            if (this.poll.isMethodY && this.poll.max_votes_per_option > 1 && !this.isGlobalOptionSelected(user)) {
                return Object.keys(this.voteRequestData[user.id].value)
                    .map(key => parseInt(this.voteRequestData[user.id].value[+key] as string, 10))
                    .reduce((a, b) => a + b, 0);
            } else if (this.poll.isMethodSTV) {
		console.log(this.voteRequestData[user.id])
		if (!Array.isArray(this.voteRequestData[user.id].value)) {
		    return 0
		} else {
		    return (this.voteRequestData[user.id].value as number[]).length
		}
	    } else {
                return Object.keys(this.voteRequestData[user.id].value).filter(
                    key => this.voteRequestData[user.id].value[+key]
                ).length;
            }
        }
        return 0;
    }

    public getVotesAvailable(user: ViewUser = this.user): number | string {
        if (this.isGlobalOptionSelected()) {
            return `-`;
        }
        return this.poll.max_votes_amount - this.getVotesCount(user);
    }

    public getFormControl(optionId: number): UntypedFormControl {
        if (!this.formControlMap[optionId]) {
            this.formControlMap[optionId] = new UntypedFormControl(0, [
                Validators.required,
                Validators.min(0),
                Validators.max(this.poll.max_votes_per_option)
            ]);
        }
        return this.formControlMap[optionId];
    }

    public getErrorInVoteEntry(optionId: number): string {
        if (this.formControlMap[optionId].hasError(`required`)) {
            return this.translate.instant(`This is not a number.`);
        } else if (this.formControlMap[optionId].hasError(`min`)) {
            return this.translate.instant(`Negative votes are not allowed.`);
        } else if (this.formControlMap[optionId].hasError(`max`)) {
            return this.translate.instant(`Too many votes on one option.`);
        }
        return ``;
    }

    public abstract getActionButtonClass(actions: VoteOption, option: ViewOption, user: ViewUser): string;

    public getActionButtonContentClass(voteOption: VoteOption, option: ViewOption, user: ViewUser = this.user): string {
        return this.getActionButtonClass(voteOption, option, user) ? `` : `button-content-opaque`;
    }

    public getGlobalButtonContentClass(option: VoteOption, user: ViewUser = this.user): string {
        return this.getGlobalCSSClass(option, user) ? `` : `button-content-opaque`;
    }

    protected isGlobalOptionSelected(user: ViewUser = this.user): boolean {
        const value = this.voteRequestData[user.id]?.value;
        return value === `Y` || value === `N` || value === `A`;
    }

    public saveGlobalVote(globalVote: GlobalVote, user: ViewUser = this.user): void {
        if (this.voteRequestData[user.id].value && this.voteRequestData[user.id].value === globalVote) {
            this.voteRequestData[user.id].value = {};
            if (this.poll.isMethodY && this.poll.max_votes_per_option > 1) {
                this.enableInputs();
            }
        } else {
            this.voteRequestData[user.id].value = globalVote;
            if (this.poll.isMethodY && this.poll.max_votes_per_option > 1) {
                this.disableAndResetInputs();
            }
            this.submitVote(user);
        }
    }

    public async submitVote(user: ViewUser, value: any = undefined): Promise<void> {
        this.deliveringVote[user.id] = true;
        this.cd.markForCheck();

        const votePayload = {
            value: value,
            user_id: user.id
        };

	console.log("hi!!!");
	console.log(votePayload);
        await this.sendVote(user.id, votePayload);
    }

    public getGlobalCSSClass(option: VoteOption, user: ViewUser = this.user): string {
        if (this.voteRequestData[user.id]?.value === option.vote) {
            return `button-content-not-opaque`;
        }
        return ``;
    }

    public getGlobalOptionName(option: VoteOption): string {
        switch (option.label) {
            case `Yes`:
                return `General approval`;
            case `No`:
                return `General rejection`;
            default:
                return `General ` + option.label.toLowerCase();
        }
    }

    public saveMultipleVotes(optionId: number, event: any, user: ViewUser = this.user): void {
        let vote = parseInt(event.target.value, 10);

        if (isNaN(vote) || vote > this.poll.max_votes_per_option || vote < 0) {
            vote = 0;
        }

        if (!this.voteRequestData[user.id]) {
            throw new Error(`The user for your voting request does not exist`);
        }

        if (this.isGlobalOptionSelected(user)) {
            delete this.voteRequestData[user.id].value;
        }

        if (this.poll.isMethodY && this.poll.max_votes_per_option > 1) {
            this.saveMultipleVotesMultiVoteMethodY(optionId, vote, user);
        }
    }

    public abstract saveSingleVote(optionId: number, vote: VoteValue, user: ViewUser): void;
    public abstract shouldStrikeOptionText(option: ViewOption, user: ViewUser): boolean;

    public saveRankedChoice(ranking: number[], user: ViewUser): void {
        if (!this.voteRequestData[user.id]) {
            throw new Error(`The user for your voting request does not exist`);
        }

	this.voteRequestData[user.id].value = ranking.map(it => this._userToOptionId[it]);
    }

    protected async sendVote(userId: Id, votePayload: any): Promise<void> {
        try {
            await this.pollRepo.vote(this.poll, votePayload);
            this.alreadyVoted[userId] = true;
            this.poll.hasVoted = true; // Set it manually to `true`, because the server will do the same
        } catch (e: any) {
            this.raiseError(e);
        } finally {
            this.deliveringVote[userId] = false;
            this.cd.markForCheck();
        }
    }

    protected isErrorInVoteEntry(): boolean {
        for (const key in this.formControlMap) {
            if (Object.prototype.hasOwnProperty.call(this.formControlMap, key) && this.formControlMap[key].invalid) {
                return true;
            }
        }
        return false;
    }

    private saveMultipleVotesMultiVoteMethodY(optionId: number, vote: number, user: ViewUser = this.user): void {
        // Another option is not expected here
        const maxVotesAmount = this.poll.max_votes_amount;
        const tmpVoteRequest = this.getTmpVoteRequestMultipleVotes(optionId, vote, user);

        // check if you can still vote
        const countedVotes = Object.keys(tmpVoteRequest)
            .map(key => parseInt(tmpVoteRequest[key], 10))
            .reduce((a, b) => a + b, 0);
        if (countedVotes <= maxVotesAmount) {
            this.voteRequestData[user.id].value = tmpVoteRequest;

            // if you have no options anymore, try to send
            if (this.getVotesCount(user) === maxVotesAmount && !this.isErrorInVoteEntry()) {
                this.submitVote(user);
            }
        } else {
            this.raiseError(
                this.translate.instant(`You reached the maximum amount of votes. Deselect one option first.`)
            );
            this.formControlMap[optionId].setValue(this.voteRequestData[user.id].value[optionId]);
        }
    }

    private getTmpVoteRequestMultipleVotes(
        optionId: number,
        vote: number,
        user: ViewUser = this.user
    ): Record<number, number> {
        const maxVotesAmount = this.poll.max_votes_amount;
        const maxVotesPerOption = this.poll.max_votes_per_option;
        return this.poll.options
            .map(option => option.id)
            .reduce((output, next_id) => {
                output[next_id] = this.voteRequestData[user.id].value[next_id];
                output[next_id] = output[next_id] ? output[next_id] : 0;
                if (next_id === optionId) {
                    if (vote > Math.min(maxVotesPerOption, maxVotesAmount)) {
                        output[next_id] = Math.min(maxVotesPerOption, maxVotesAmount);
                    } else if (vote >= 0) {
                        output[next_id] = vote;
                    }
                }
                return output;
            }, {});
    }

    private enableInputs(): void {
        for (const key in this.formControlMap) {
            if (Object.prototype.hasOwnProperty.call(this.formControlMap, key)) {
                this.formControlMap[key].enable();
            }
        }
    }

    private disableAndResetInputs(): void {
        for (const key in this.formControlMap) {
            if (Object.prototype.hasOwnProperty.call(this.formControlMap, key)) {
                this.formControlMap[key].setValue(0);
                this.formControlMap[key].disable();
            }
        }
    }

    private updatePoll(): void {
        if (this._isReady) {
            this.setupHasVotedSubscription();
        }
        this.defineVoteOptions();
        this.cd.markForCheck();
    }

    private setupHasVotedSubscription(): void {
        if (!this.votedSubscription || this.votedSubscription.closed || this.votedSubscriptionPollId !== this.poll.id) {
            if (this.votedSubscription) {
                this.votedSubscription.unsubscribe();
            }

            this.votedSubscription = this.voteRepo.subscribeVoted(this.poll).subscribe(votedFor => {
                if (votedFor[this.poll.id] === undefined) {
                    return;
                }

                const votes = votedFor[this.poll.id] || [];
                if (
                    ((!this.poll.live_votes && votes.length > 0) ||
                        votes.filter(m => this.poll.live_votes[m] !== undefined).length > 0) &&
                    this.poll.hasVoted
                ) {
                    return;
                }
                if (this.user) {
                    this.alreadyVoted[this.user.id] = votes.includes(this.user.id);
                    if (this.delegations) {
                        this.setupDelegations(votes);
                    }
                }

                for (const key of Object.keys(this._canVoteForSubjectMap)) {
                    this._canVoteForSubjectMap[+key].next(this.canVote(this._delegationsMap[+key]));
                }

                this.cd.markForCheck();
            });
            this.votedSubscriptionPollId = this.poll.id;
            this.subscriptions.push(this.votedSubscription);
        }
    }

    private setupDelegations(votedFor: Id[]): void {
        for (const delegation of this.delegations) {
            this._delegationsMap[delegation.id] = delegation;
            this.alreadyVoted[delegation.id] = votedFor.includes(delegation.id);
            if (!this.voteRequestData[delegation.id]) {
                this.voteRequestData[delegation.id] = { value: {} } as VotingData;
                this.deliveringVote[delegation.id] = false;
            }
        }
    }

    private canVote(user: ViewUser = this.user): boolean {
        return (
            this.votingService.canVote(this.poll, user) &&
            !this.isDeliveringVote(user) &&
            !this.hasAlreadyVoted(user) &&
            this.hasAlreadyVoted(user) !== undefined
        );
    }

    private defineVoteOptions(): void {
        this.voteActions = [];
        this.globalVoteActions = [];
        if (this.poll) {
            const globals = {
                Y: this.poll.global_yes,
                N: this.poll.global_no,
                A: this.poll.global_abstain
            };

            for (const option of this.voteOptions) {
                if (this.poll.pollmethod?.includes(option.vote)) {
                    this.voteActions.push(option);
                }

                if (globals[option.vote]) {
                    this.globalVoteActions.push(option);
                }
            }
        }
    }

    /** 
     * Converts a ranking in the form of an ordered list of candidates to
     * a record that associates each candidate's option ID with its numbered rank.
     */
    private rankOrderingToRecord(ranking: number[]): Record<number, number> {
	const scores: Record<number, number> = {};

	/** Initialize empty ballot */
	this._candidateOptionIds.forEach(optionId => {
	    scores[optionId] = 0;
	});
	
	ranking.forEach((userId, i) => {
	    const optionId = this._userToOptionId[userId];
	    scores[optionId] = i+1;
	});

	return scores;
    }
}
