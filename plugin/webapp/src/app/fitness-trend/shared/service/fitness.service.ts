import * as _ from "lodash";
import * as moment from "moment";
import { Moment } from "moment";
import { Injectable } from "@angular/core";
import { ActivityService } from "../../../shared/services/activity/activity.service";
import { DayStressModel } from "../models/day-stress.model";
import { DayFitnessTrendModel } from "../models/day-fitness-trend.model";
import { SyncedActivityModel } from "../../../../../../common/scripts/models/Sync";
import { FitnessReadyActivityModel } from "../models/fitness-ready-activity.model";
import { PeriodModel } from "../models/period.model";

@Injectable()
export class FitnessService {

	public static readonly FUTURE_DAYS_PREVIEW: number = 14;

	constructor(private activityService: ActivityService) {
	}

	/**
	 * Return activities having required data to compute fitness trend: heart rate, power data & swim data
	 * @param {boolean} powerMeterEnable
	 * @param {number} cyclingFtp
	 * @param {boolean} swimEnable
	 * @param {number} swimFtp
	 * @returns {Promise<FitnessReadyActivityModel[]>}
	 */
	public getReady(powerMeterEnable: boolean,
					cyclingFtp: number,
					swimEnable: boolean,
					swimFtp: number): Promise<FitnessReadyActivityModel[]> {

		return new Promise((resolve: (result: FitnessReadyActivityModel[]) => void,
							reject: (error: string) => void) => {

			return this.activityService.fetch().then((activities: SyncedActivityModel[]) => {

				const fitnessReadyActivities: FitnessReadyActivityModel[] = [];

				_.forEach(activities, (activity: SyncedActivityModel) => {

					// Check if activity is eligible to fitness computing
					const hasHeartRateData: boolean = (activity.extendedStats
						&& !_.isEmpty(activity.extendedStats.heartRateData)
						&& _.isNumber(activity.extendedStats.heartRateData.TRIMP));

					const isPowerMeterUsePossible: boolean = (activity.type === "Ride" || activity.type === "VirtualRide")
						&& powerMeterEnable
						&& _.isNumber(cyclingFtp)
						&& activity.extendedStats && activity.extendedStats.powerData
						&& activity.extendedStats.powerData.hasPowerMeter
						&& _.isNumber(activity.extendedStats.powerData.weightedPower);

					const hasSwimmingData: boolean = (swimEnable && _.isNumber(swimFtp) && swimFtp > 0
						&& activity.type === "Swim"
						&& _.isNumber(activity.distance_raw) && _.isNumber(activity.moving_time_raw)
						&& activity.moving_time_raw > 0);

					if (hasHeartRateData || isPowerMeterUsePossible || hasSwimmingData) {

						const momentStartTime: Moment = moment(activity.start_time);

						const fitnessReadyActivity: FitnessReadyActivityModel = {
							id: activity.id,
							date: momentStartTime.toDate(),
							timestamp: momentStartTime.toDate().getTime(),
							dayOfYear: momentStartTime.dayOfYear(),
							year: momentStartTime.year(),
							type: activity.type,
							activityName: activity.name,

						};

						if (hasHeartRateData) {
							fitnessReadyActivity.trainingImpulseScore = activity.extendedStats.heartRateData.TRIMP;
						}

						if (isPowerMeterUsePossible) {
							const movingTime = activity.moving_time_raw;
							const weightedPower = activity.extendedStats.powerData.weightedPower;
							fitnessReadyActivity.powerStressScore = this.computePowerStressScore(movingTime, weightedPower, cyclingFtp);
						}

						if (hasSwimmingData) {
							fitnessReadyActivity.swimStressScore = this.computeSwimStressScore(activity.distance_raw,
								activity.moving_time_raw,
								activity.elapsed_time_raw,
								swimFtp);
						}

						fitnessReadyActivities.push(fitnessReadyActivity);
					}
				});

				resolve(fitnessReadyActivities);
			});
		});
	}

	/**
	 * Return day by day the athlete stress. Active & rest days included
	 * @param {boolean} powerMeterEnable
	 * @param {number} cyclingFtp
	 * @param {boolean} swimEnable
	 * @param {number} swimFtp
	 * @returns {Promise<DayStressModel[]>}
	 */
	public generateDailyStress(powerMeterEnable: boolean, cyclingFtp: number, swimEnable: boolean, swimFtp: number): Promise<DayStressModel[]> {

		return new Promise((resolve: (activityDays: DayStressModel[]) => void,
							reject: (error: string) => void) => {

			this.getReady(powerMeterEnable, cyclingFtp, swimEnable, swimFtp)
				.then((fitnessReadyActivities: FitnessReadyActivityModel[]) => {

					if (_.isEmpty(fitnessReadyActivities)) {
						reject("No ready activities");
						return;
					}

					// Subtract 1 day to the first activity done in history:
					// Goal is to show graph point with 1 day before
					const startDay = moment(_.first(fitnessReadyActivities).date)
						.subtract(1, "days").startOf("day");

					const today: Moment = this.getTodayMoment().startOf("day"); // Today end of day

					// Now inject days off/resting
					const dailyActivity: DayStressModel[] = [];
					const currentDay = moment(startDay).clone();

					while (currentDay.isSameOrBefore(today)) {

						// Compute athlete stress on that current day.
						const dayStress: DayStressModel = this.dayStressOnDate(currentDay, fitnessReadyActivities);

						// Then push every day... Rest or active...
						dailyActivity.push(dayStress);

						// If current day is today. The last real day right?! Then leave the loop !
						if (currentDay.isSame(today)) {
							break;
						}

						// Add a day until today is reached :)
						currentDay.add(1, "days");
					}

					// Then add PREVIEW days
					this.appendPreviewDaysToDailyActivity(currentDay, dailyActivity);

					resolve(dailyActivity);
				});
		});
	}

	/**
	 *
	 * @param {number} movingTime
	 * @param {number} weightedPower
	 * @param {SyncedActivityModel} activity
	 * @param {number} cyclingFtp
	 * @returns {number}
	 */
	private computePowerStressScore(movingTime: number, weightedPower: number, cyclingFtp: number): number {
		return (movingTime * weightedPower * (weightedPower / cyclingFtp) / (cyclingFtp * 3600) * 100);
	}

	/**
	 *
	 * @param {number} distance
	 * @param {number} movingTime
	 * @param {number} elaspedTime
	 * @param {number} swimFtp
	 * @returns {number}
	 */
	private computeSwimStressScore(distance: number, movingTime: number, elaspedTime: number, swimFtp: number) {
		const normalizedSwimSpeed = distance / (movingTime / 60); // Normalized_Swim_Speed (m/min) = distance(m) / timeInMinutesNoRest
		const swimIntensity = normalizedSwimSpeed / swimFtp; // Intensity = Normalized_Swim_Speed / Swim FTP
		return Math.pow(swimIntensity, 3) * (elaspedTime / 3600) * 100; // Swim Stress Score = Intensity^3 * TotalTimeInHours * 100
	}

	/**
	 *
	 * @param {boolean} isPowerMeterEnabled
	 * @param {number} cyclingFtp
	 * @param {boolean} isSwimEnabled
	 * @param {number} swimFtp
	 * @returns {Promise<DayFitnessTrendModel[]>}
	 */
	public computeTrend(isPowerMeterEnabled: boolean,
						cyclingFtp: number,
						isSwimEnabled: boolean,
						swimFtp: number): Promise<DayFitnessTrendModel[]> {

		return new Promise((resolve: (fitnessTrend: DayFitnessTrendModel[]) => void,
							reject: (error: string) => void) => {

			this.generateDailyStress(isPowerMeterEnabled, cyclingFtp, isSwimEnabled, swimFtp)
				.then((dailyActivity: DayStressModel[]) => {

					let ctl = 0;
					let atl = 0;
					let tsb = 0;

					const fitnessTrend: DayFitnessTrendModel[] = [];

					_.forEach(dailyActivity, (dayStress: DayStressModel) => {

						ctl = ctl + (dayStress.finalStressScore - ctl) * (1 - Math.exp(-1 / 42));
						atl = atl + (dayStress.finalStressScore - atl) * (1 - Math.exp(-1 / 7));
						tsb = ctl - atl;

						const dayFitnessTrend: DayFitnessTrendModel = new DayFitnessTrendModel(dayStress, ctl, atl, tsb);

						if (_.isNumber(dayStress.trainingImpulseScore) && dayStress.trainingImpulseScore > 0) {
							dayFitnessTrend.trainingImpulseScore = dayStress.trainingImpulseScore;
						}

						if (_.isNumber(dayStress.powerStressScore) && dayStress.powerStressScore > 0) {
							dayFitnessTrend.powerStressScore = dayStress.powerStressScore;
						}

						if (_.isNumber(dayStress.swimStressScore) && dayStress.swimStressScore > 0) {
							dayFitnessTrend.swimStressScore = dayStress.swimStressScore;
						}

						if (_.isNumber(dayStress.finalStressScore) && dayStress.finalStressScore > 0) {
							dayFitnessTrend.finalStressScore = dayStress.finalStressScore;
						}

						fitnessTrend.push(dayFitnessTrend);

					});

					resolve(fitnessTrend);
				}, error => {

					reject(error);

				});
		});
	}

	/**
	 *
	 * @param {moment.Moment} startFrom
	 * @param {DayStressModel[]} dailyActivity
	 */
	private appendPreviewDaysToDailyActivity(startFrom: moment.Moment, dailyActivity: DayStressModel[]) {

		for (let i = 0; i < FitnessService.FUTURE_DAYS_PREVIEW; i++) {

			const futureDate: Date = startFrom.add(1, "days").startOf("day").toDate();

			const dayActivity: DayStressModel = new DayStressModel(futureDate, true);

			dailyActivity.push(dayActivity);
		}
	}

	/**
	 *
	 * @param {moment.Moment} currentDay
	 * @param {FitnessReadyActivityModel[]} fitnessReadyActivities
	 * @returns {DayStressModel}
	 */

	private dayStressOnDate(currentDay: moment.Moment, fitnessReadyActivities: FitnessReadyActivityModel[]): DayStressModel {

		const foundActivitiesThatDay: FitnessReadyActivityModel[] = _.filter(fitnessReadyActivities, {
			year: currentDay.year(),
			dayOfYear: currentDay.dayOfYear(),
		});

		const dayActivity: DayStressModel = new DayStressModel(currentDay.toDate(), false);

		// Compute final stress scores on that day
		if (foundActivitiesThatDay.length > 0) {

			_.forEach(foundActivitiesThatDay, (activity: FitnessReadyActivityModel) => {

				dayActivity.ids.push(activity.id);
				dayActivity.activitiesName.push(activity.activityName);
				dayActivity.types.push(activity.type);

				// Apply scores for that day
				// PSS
				if (activity.powerStressScore) {

					if (!dayActivity.powerStressScore) { // Initialize value if not exists
						dayActivity.powerStressScore = 0;
					}

					dayActivity.powerStressScore += activity.powerStressScore;
				}

				// TRIMP
				if (activity.trainingImpulseScore) { // Check for TRIMP score if available
					if (!dayActivity.trainingImpulseScore) { // Initialize value if not exists
						dayActivity.trainingImpulseScore = 0;
					}
					dayActivity.trainingImpulseScore += activity.trainingImpulseScore;
				}

				// SwimSS
				if (activity.swimStressScore) { // Check for TRIMP score if available
					if (!dayActivity.swimStressScore) { // Initialize value if not exists
						dayActivity.swimStressScore = 0;
					}
					dayActivity.swimStressScore += activity.swimStressScore;
				}

				// Apply final stress score for that day
				if (activity.powerStressScore) { // Use PSS has priority over TRIMP

					dayActivity.finalStressScore += activity.powerStressScore;

				} else if (activity.trainingImpulseScore) {

					dayActivity.finalStressScore += activity.trainingImpulseScore;

				} else if (activity.swimStressScore) {

					dayActivity.finalStressScore += activity.swimStressScore;

				}
			});

		}

		return dayActivity;
	}

	/**
	 * Return start/end indexes of fullFitnessTrend collection corresponding to from/to date given in a period
	 * @param {PeriodModel} period
	 * @param {DayFitnessTrendModel[]} fitnessTrend
	 * @returns {{start: number; end: number}}
	 */
	public indexesOf(period: PeriodModel, fitnessTrend: DayFitnessTrendModel[]): { start: number; end: number } {

		let startIndex = 0; // Use first day as start index by default.
		if (_.isDate(period.from)) { // Then override index if "From" is specified
			startIndex = _.findIndex(fitnessTrend, {
				dateString: moment(period.from).format(DayFitnessTrendModel.DATE_FORMAT)
			});
		}

		let endIndex = (fitnessTrend.length - 1); // Use last preview index by default
		if (_.isDate(period.to)) { // Then override index if "To" is specified
			endIndex = _.findIndex(fitnessTrend, {
				dateString: moment(period.to).format(DayFitnessTrendModel.DATE_FORMAT)
			});
		}

		if (startIndex >= endIndex) {
			throw (new Error()).message = "FROM cannot be upper than TO date";
		}

		return {start: startIndex, end: endIndex};
	}

	public getTodayMoment(): Moment {
		return moment();
	}
}
