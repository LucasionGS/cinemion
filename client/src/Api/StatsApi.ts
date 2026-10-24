import type { ProfileStats, ServerStats, StatsPeriod, YearInReview } from "@shared/stats.ts";
import BaseApi from "./BaseApi.ts";

/**
 * Statistics and the year in review.
 */
export namespace StatsApi {
  export function mine(period: StatsPeriod) {
    return BaseApi.GET<ProfileStats>(`/stats/me?period=${period}`);
  }

  /**
   * Everyone's, for people who manage the server.
   */
  export function server(period: StatsPeriod) {
    return BaseApi.GET<ServerStats>(`/stats/server?period=${period}`);
  }

  export function year(year: number, scope: "me" | "household") {
    return BaseApi.GET<YearInReview>(`/stats/year/${year}?scope=${scope}`);
  }
}

export default StatsApi;
