import * as _ from "lodash";
import {InconsistentParameters} from "../../../common/scripts/exceptions/InconsistentParameters";

export class RunningPowerEstimator {
    /**
     * Create Running Power stream estimation
     * @param athleteWeight Mass of athlete in KG
     * @param distanceArray
     * @param timeArray
     * @param altitudeArray
     * @returns {Array<number>} Array of power
     */
    public static createRunningPowerEstimationStream(athleteWeight: number, distanceArray: Array<number>,
                                                     timeArray: Array<number>, altitudeArray: Array<number>): Array<number> {

        console.log("Estimating power data stream from athleteWeight (%d kg) and grade adjusted distance", athleteWeight);

        if (!_.isNumber(athleteWeight)) {
            throw new InconsistentParameters("athleteWeight required as number");
        }

        if (!_.isArray(distanceArray)) {
            throw new InconsistentParameters("distanceArray required as array");
        }

        if (!_.isArray(timeArray)) {
            throw new InconsistentParameters("timeArray required as array");
        }

        let powerStream: Array<number> = [];
        for (let i = 0; i < timeArray.length; i++) {
            let power = 0;
            if (i > 0) {
                const time = timeArray[i] - timeArray[i - 1];
                const distanceAdjusted = distanceArray[i] - distanceArray[i - 1];
                const elevationGain = altitudeArray[i] - altitudeArray[i - 1];
                power = this.estimateRunningPower(athleteWeight, distanceAdjusted, time, elevationGain);
            }
            powerStream.push(power);
        }
        return powerStream;
    }

    /**
     * Return a power estimation from athlete weight and speed (m/s)
     * From https://alancouzens.com/blog/Run_Power.html
     * @param {number} weightKg
     * @param {number} meters
     * @param {number} seconds
     * @param elevationGain
     * @returns {number} power watts
     */
    public static estimateRunningPower(weightKg: number, meters: number, seconds: number, elevationGain: number): number {
        const minutes = seconds / 60;
        const km = meters / 1000;
        const minPerKmPace = minutes / km;
        const VO2Reserve = 210 / minPerKmPace;
        const VO2A = (VO2Reserve * weightKg) / 1000;
        const horizontalWatts = (75 * VO2A);
        const verticalWatts = (weightKg * 9.81 * elevationGain) / seconds;
        return Math.round(horizontalWatts + verticalWatts);
    }
}
