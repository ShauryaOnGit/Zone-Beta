// src/lib/focusAnalytics.js
//
// Shared, pure data-processing helpers for turning raw session telemetry
// (score_timeline: [{ elapsed, status, score }, ...]) into trustworthy
// aggregate insights. Used by Analytics.jsx (the Pro dashboard),
// FocusSession.jsx (to suggest a session length and nudge near a
// predicted dip), and the feed/profile pages (to display a fair score).
//
// -----------------------------------------------------------------------
// Why this exists instead of using `session.focus_score` directly:
//
// The sidecar's `focus_score` / telemetry `score` field is a CUMULATIVE
// running average from the start of the session, not a point-in-time
// reading. That makes it unreliable for two things we do here:
//   1. Detecting *when* focus drops (early readings swing the average
//      wildly on a small denominator; late in a long session a single
//      new reading barely moves it at all).
//   2. Comparing sessions of different lengths fairly, since a long
//      session's average is far "stickier" than a short one's.
//
// Every function below that needs a per-session score recomputes it from
// the raw per-reading `status` field instead, which is stable regardless
// of when in the session it was read.
// -----------------------------------------------------------------------

/**
 * A fair, position-independent focus score for a single session: the
 * percentage of readings that were ON_TASK. Unlike the stored
 * cumulative `focus_score`, a quiet back half can't fully paper over a
 * genuinely distracted start (or vice versa), and it's directly
 * comparable across sessions of any length.
 *
 * Works on old sessions too — it only needs `status` and `elapsed`,
 * both of which have always been in score_timeline.
 */
export function computeFairScore(timeline) {
  if (!timeline || timeline.length === 0) return null;
  const onTask = timeline.filter((p) => p.status === 'ON_TASK').length;
  return Math.round((onTask / timeline.length) * 100);
}

/**
 * Returns the usable timeline in chronological order.
 * Only ON_TASK / DISTRACTED readings with a finite elapsed timestamp
 * participate in time-based analytics.
 */
function normalizeTimeline(timeline) {
  return (timeline || [])
    .filter(
      (point) =>
        Number.isFinite(Number(point?.elapsed)) &&
        (point?.status === 'ON_TASK' || point?.status === 'DISTRACTED')
    )
    .map((point) => ({ ...point, elapsed: Number(point.elapsed) }))
    .sort((a, b) => a.elapsed - b.elapsed);
}

/**
 * Converts point samples into elapsed-time intervals.
 *
 * A reading is treated as the best available description of the state
 * from its timestamp until the next reading. The final point has no
 * trustworthy "until" time, so it contributes no interval by itself.
 *
 * This is intentionally time-based rather than sample-count based:
 * adaptive polling can produce many readings while distracted and fewer
 * while focused, and counting each reading as one equal vote would bias
 * the result toward whichever state is sampled more frequently.
 */
export function buildStatusIntervals(timeline) {
  const points = normalizeTimeline(timeline);
  const intervals = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i].elapsed;
    const end = points[i + 1].elapsed;
    if (end <= start) continue;

    intervals.push({
      startElapsed: start,
      endElapsed: end,
      durationSeconds: end - start,
      status: points[i].status,
    });
  }

  return intervals;
}

/**
 * Retained for compatibility with any UI/debug code that wants explicit
 * distraction episodes. Optimal-session estimation no longer uses this
 * function; it now uses a time-weighted rolling focus score.
 */
export function getDistractionEpisodes(timeline) {
  const intervals = buildStatusIntervals(timeline);
  const episodes = [];
  let current = null;

  for (const interval of intervals) {
    if (interval.status === 'DISTRACTED') {
      if (!current) {
        current = {
          startElapsed: interval.startElapsed,
          endElapsed: interval.endElapsed,
        };
      } else if (interval.startElapsed <= current.endElapsed) {
        current.endElapsed = Math.max(current.endElapsed, interval.endElapsed);
      } else {
        episodes.push({
          ...current,
          durationSeconds: current.endElapsed - current.startElapsed,
        });
        current = {
          startElapsed: interval.startElapsed,
          endElapsed: interval.endElapsed,
        };
      }
    } else if (current) {
      episodes.push({
        ...current,
        durationSeconds: current.endElapsed - current.startElapsed,
      });
      current = null;
    }
  }

  if (current) {
    episodes.push({
      ...current,
      durationSeconds: current.endElapsed - current.startElapsed,
    });
  }

  return episodes;
}

/**
 * Calculates the fraction of *elapsed time* that was ON_TASK inside a
 * requested window. This is the core fix for irregular/adaptive sampling.
 *
 * Example: if a 5-minute window contains 4 minutes represented as
 * ON_TASK and 1 minute represented as DISTRACTED, this returns 0.8
 * regardless of whether those periods contained 5 readings or 50.
 */
export function timeWeightedFocusInWindow(
  timeline,
  windowStartSeconds,
  windowEndSeconds,
  { maxTrustedGapSeconds = 150 } = {}
) {
  if (windowEndSeconds <= windowStartSeconds) {
    return { focusFraction: null, coveredSeconds: 0, requestedSeconds: 0 };
  }

  const intervals = buildStatusIntervals(timeline);
  let focusedSeconds = 0;
  let coveredSeconds = 0;

  for (const interval of intervals) {
    const overlapStart = Math.max(interval.startElapsed, windowStartSeconds);
    const overlapEnd = Math.min(interval.endElapsed, windowEndSeconds);
    if (overlapEnd <= overlapStart) continue;

    // A very large telemetry gap should not be treated as if one stale
    // verdict described the entire gap with perfect certainty.
    const rawOverlap = overlapEnd - overlapStart;
    const trustedOverlap = Math.min(rawOverlap, maxTrustedGapSeconds);

    coveredSeconds += trustedOverlap;
    if (interval.status === 'ON_TASK') {
      focusedSeconds += trustedOverlap;
    }
  }

  return {
    focusFraction: coveredSeconds > 0 ? focusedSeconds / coveredSeconds : null,
    coveredSeconds,
    requestedSeconds: windowEndSeconds - windowStartSeconds,
  };
}

/**
 * Produces a regular time series of rolling, time-weighted focus.
 *
 * `windowSeconds` controls how much recent history each point summarizes.
 * `stepSeconds` controls how often the rolling score is evaluated.
 * A point is only accepted when enough of the requested window is covered
 * by trustworthy telemetry, so long sleep/background gaps do not invent
 * confidence that the app does not actually have.
 */
export function buildRollingFocusSeries(
  timeline,
  {
    windowSeconds = 300,
    stepSeconds = 30,
    minCoverageRatio = 0.75,
    maxTrustedGapSeconds = 150,
  } = {}
) {
  const points = normalizeTimeline(timeline);
  if (points.length < 2) return [];

  const sessionEnd = points[points.length - 1].elapsed;
  if (sessionEnd < windowSeconds) return [];

  const series = [];

  for (let t = windowSeconds; t <= sessionEnd; t += stepSeconds) {
    const windowStart = t - windowSeconds;
    const result = timeWeightedFocusInWindow(timeline, windowStart, t, {
      maxTrustedGapSeconds,
    });

    const coverageRatio =
      result.requestedSeconds > 0
        ? result.coveredSeconds / result.requestedSeconds
        : 0;

    if (
      result.focusFraction != null &&
      coverageRatio >= minCoverageRatio
    ) {
      series.push({
        elapsed: t,
        focusFraction: result.focusFraction,
        coverageRatio,
      });
    }
  }

  return series;
}

/**
 * Finds when recent attention quality first enters a sustained low-focus
 * regime.
 *
 * Default interpretation:
 *   - look at the most recent 5 minutes of *elapsed time*
 *   - consider that window degraded below 70% focused
 *   - require the rolling score to remain degraded for ~3 minutes
 *
 * Returning the *start* of that persistent low-focus run captures where
 * focus began to wane rather than where the persistence requirement was
 * finally satisfied.
 */
export function findDecayPoint(
  timeline,
  {
    windowSeconds = 300,
    focusThreshold = 0.7,
    persistenceSeconds = 180,
    stepSeconds = 30,
    minCoverageRatio = 0.75,
    maxTrustedGapSeconds = 150,
  } = {}
) {
  const series = buildRollingFocusSeries(timeline, {
    windowSeconds,
    stepSeconds,
    minCoverageRatio,
    maxTrustedGapSeconds,
  });

  let lowRunStart = null;
  let previousElapsed = null;

  for (const point of series) {
    // If there is a large hole in otherwise-valid rolling observations,
    // do not pretend the low-focus run was continuously observed.
    if (
      previousElapsed != null &&
      point.elapsed - previousElapsed > stepSeconds * 1.5
    ) {
      lowRunStart = null;
    }

    if (point.focusFraction < focusThreshold) {
      if (lowRunStart == null) {
        lowRunStart = point.elapsed;
      }

      if (point.elapsed - lowRunStart >= persistenceSeconds) {
        return lowRunStart;
      }
    } else {
      lowRunStart = null;
    }

    previousElapsed = point.elapsed;
  }

  return null;
}

/**
 * A robust weighted median. Unlike a weighted mean, an unusually long or
 * unusually short session cannot drag the center far away from where most
 * of the user's weighted evidence actually sits.
 */
export function weightedMedian(values) {
  const usable = (values || [])
    .filter(
      (item) =>
        Number.isFinite(Number(item?.value)) &&
        Number.isFinite(Number(item?.weight)) &&
        Number(item.weight) > 0
    )
    .map((item) => ({
      value: Number(item.value),
      weight: Number(item.weight),
    }))
    .sort((a, b) => a.value - b.value);

  if (usable.length === 0) return null;

  const totalWeight = usable.reduce((sum, item) => sum + item.weight, 0);
  const halfway = totalWeight / 2;
  let cumulative = 0;

  for (const item of usable) {
    cumulative += item.weight;
    if (cumulative >= halfway) return item.value;
  }

  return usable[usable.length - 1].value;
}

/**
 * Weighted Kaplan-Meier median for decay time.
 *
 * Each observation is:
 *   { minutes, event: true,  weight }  -> decay was observed at that time
 *   { minutes, event: false, weight }  -> session ended focused at that time
 *
 * The second form is right-censored evidence: it says the user's decay
 * point was later than the observed session length without pretending we
 * know exactly how much later.
 */
export function weightedKaplanMeierMedian(observations) {
  const usable = (observations || [])
    .filter(
      (o) =>
        Number.isFinite(Number(o?.minutes)) &&
        Number(o.minutes) > 0 &&
        Number.isFinite(Number(o?.weight)) &&
        Number(o.weight) > 0
    )
    .map((o) => ({
      minutes: Number(o.minutes),
      event: Boolean(o.event),
      weight: Number(o.weight),
    }));

  if (usable.length === 0) return null;

  const eventTimes = [...new Set(
    usable.filter((o) => o.event).map((o) => o.minutes)
  )].sort((a, b) => a - b);

  let survival = 1;

  for (const time of eventTimes) {
    // Everyone whose observation lasts at least to `time` is still in the
    // risk set, including sessions censored exactly at that time.
    const riskWeight = usable
      .filter((o) => o.minutes >= time)
      .reduce((sum, o) => sum + o.weight, 0);

    const eventWeight = usable
      .filter((o) => o.event && o.minutes === time)
      .reduce((sum, o) => sum + o.weight, 0);

    if (riskWeight <= 0 || eventWeight <= 0) continue;

    survival *= Math.max(0, 1 - eventWeight / riskWeight);

    if (survival <= 0.5) {
      return time;
    }
  }

  // More than half of the weighted evidence survived beyond every
  // observed decay point. There is no statistically identified median
  // inside the user's observed range yet.
  return null;
}

/**
 * How much a session should count toward aggregate stats.
 *
 * Reliability is now based on *temporal coverage*, not raw sample count.
 * Adaptive polling is therefore free to produce many readings in one
 * state and fewer in another without automatically making one session
 * look more reliable.
 *
 * Large telemetry gaps are only trusted up to `maxTrustedGapSeconds`.
 * Duration and recency remain separate weights.
 */
export function sessionWeight(
  session,
  {
    now = Date.now(),
    durationCapMinutes = 45,
    recencyHalfLifeDays = 21,
    maxTrustedGapSeconds = 150,
  } = {}
) {
  const timeline = normalizeTimeline(session.score_timeline || []);
  if (timeline.length < 2) return 0;

  const sessionEnd = timeline[timeline.length - 1].elapsed;
  if (!Number.isFinite(sessionEnd) || sessionEnd <= 0) return 0;

  let trustedCoverageSeconds = 0;
  let previousElapsed = 0;

  for (const point of timeline) {
    const gap = Math.max(0, point.elapsed - previousElapsed);
    trustedCoverageSeconds += Math.min(gap, maxTrustedGapSeconds);
    previousElapsed = point.elapsed;
  }

  const coverageReliability = Math.max(
    0,
    Math.min(1, trustedCoverageSeconds / sessionEnd)
  );

  const durationMin = sessionEnd / 60;
  const durationWeight = Math.min(1, durationMin / durationCapMinutes);

  const daysAgo = session.created_at
    ? (now - new Date(session.created_at).getTime()) / (1000 * 60 * 60 * 24)
    : 0;

  // This is a true half-life: after `recencyHalfLifeDays`, the recency
  // contribution is exactly 0.5.
  const recencyWeight = Math.exp(
    (-Math.LN2 * Math.max(0, daysAgo)) / recencyHalfLifeDays
  );

  return coverageReliability * durationWeight * recencyWeight;
}

/**
 * Optimal Session Length
 *
 * V2 model:
 *   1. Detect decay from a time-weighted rolling focus score.
 *   2. Keep sessions with no detected decay as right-censored evidence.
 *   3. Use a weighted Kaplan-Meier median when censoring allows one to be
 *      identified; otherwise fall back to the weighted median of observed
 *      decay points.
 *   4. Keep the weighted 5-minute mode as a stabilizing second signal.
 *
 * This preserves the public return shape used by Analytics.jsx and
 * FocusSession.jsx while making the recommendation robust to adaptive
 * polling, temporary distractions, censored successful sessions, and
 * unusual marathon/bad-day outliers.
 */
export function computeOptimalSession(
  sessions,
  {
    rollingWindowSeconds = 300,
    focusThreshold = 0.7,
    persistenceSeconds = 180,
    stepSeconds = 30,
    minCoverageRatio = 0.75,
    maxTrustedGapSeconds = 150,
  } = {}
) {
  const now = Date.now();
  const observations = [];
  const decayPoints = [];
  const censoredPoints = [];

  (sessions || []).forEach((session) => {
    const timeline = normalizeTimeline(session.score_timeline || []);
    if (timeline.length < 2) return;

    const sessionEndSeconds = timeline[timeline.length - 1].elapsed;
    if (!Number.isFinite(sessionEndSeconds) || sessionEndSeconds <= 0) return;

    const weight = sessionWeight(session, {
      now,
      maxTrustedGapSeconds,
    });
    if (weight <= 0) return;

    const decaySeconds = findDecayPoint(timeline, {
      windowSeconds: rollingWindowSeconds,
      focusThreshold,
      persistenceSeconds,
      stepSeconds,
      minCoverageRatio,
      maxTrustedGapSeconds,
    });

    if (decaySeconds == null) {
      const minutes = sessionEndSeconds / 60;
      const observation = { minutes, event: false, weight };
      observations.push(observation);
      censoredPoints.push(observation);
      return;
    }

    const minutes = decaySeconds / 60;
    const observation = { minutes, event: true, weight };
    observations.push(observation);
    decayPoints.push(observation);
  });

  const eventWeight = decayPoints.reduce((sum, d) => sum + d.weight, 0);
  const totalSupportWeight = observations.reduce((sum, d) => sum + d.weight, 0);

  // Censored sessions improve the estimate, but they cannot by themselves
  // tell us where decay occurs. Keep the requirement for at least two
  // actual observed decay events before publishing a recommendation.
  if (decayPoints.length < 2 || eventWeight < 0.5) {
    return {
      hasEnoughData: false,
      decayMinutes: decayPoints.map((d) => d.minutes),
      censoredMinutes: censoredPoints.map((d) => d.minutes),
      recommendedMinutes: null,
      sampleSize: decayPoints.length,
      censoredSampleSize: censoredPoints.length,
      effectiveSampleSize: Math.round(eventWeight * 10) / 10,
      supportingSessionWeight: Math.round(totalSupportWeight * 10) / 10,
    };
  }

  const binSize = 5;
  const bins = {};

  decayPoints.forEach(({ minutes, weight }) => {
    const bin = Math.round(minutes / binSize) * binSize;
    bins[bin] = (bins[bin] || 0) + weight;
  });

  const [modeBin] = Object.entries(bins).sort((a, b) => b[1] - a[1])[0];

  const observedWeightedMedian = weightedMedian(
    decayPoints.map(({ minutes, weight }) => ({ value: minutes, weight }))
  );

  const survivalMedian = weightedKaplanMeierMedian(observations);

  // Prefer the censor-aware survival median whenever the data identifies
  // one. If more than half of the weighted evidence is still focused past
  // every observed decay time, fall back to the robust observed median
  // rather than inventing an unsupported later endpoint.
  const typicalDecay =
    survivalMedian ?? observedWeightedMedian ?? Number(modeBin);

  // Keep the mode as a stabilizer, but use a robust median instead of the
  // old weighted mean. The final user-facing value remains rounded to a
  // friendly 5-minute increment.
  const recommended =
    Math.round(((Number(modeBin) + typicalDecay) / 2) / 5) * 5;

  // Weighted mean is retained only as a diagnostic field. It no longer
  // influences the recommendation.
  const weightedMean =
    decayPoints.reduce((sum, d) => sum + d.minutes * d.weight, 0) /
    eventWeight;

  return {
    hasEnoughData: true,
    decayMinutes: decayPoints.map((d) => d.minutes),
    censoredMinutes: censoredPoints.map((d) => d.minutes),
    modeBin: Number(modeBin),

    // Backwards compatibility: FocusSession.jsx currently reads
    // avgDecayMinutes for its live nudge. It now receives the robust,
    // censor-aware typical decay rather than the old weighted mean.
    avgDecayMinutes: Math.round(typicalDecay),
    typicalDecayMinutes: Math.round(typicalDecay),

    weightedMedianDecayMinutes:
      observedWeightedMedian == null ? null : Math.round(observedWeightedMedian),
    survivalMedianMinutes:
      survivalMedian == null ? null : Math.round(survivalMedian),
    weightedMeanDecayMinutes: Math.round(weightedMean),

    recommendedMinutes: Math.max(10, recommended),

    // `sampleSize` intentionally remains the number of actual tracked
    // drop-offs because Analytics.jsx labels it that way.
    sampleSize: decayPoints.length,
    censoredSampleSize: censoredPoints.length,
    effectiveSampleSize: Math.round(eventWeight * 10) / 10,
    supportingSessionWeight: Math.round(totalSupportWeight * 10) / 10,
  };
}

/**
 * Time-of-Day Trend Analysis
 * Groups sessions into dayparts by created_at, and averages the FAIR
 * score within each daypart, weighted by sessionWeight — so a single
 * 3-minute morning session doesn't carry the same voting power as a
 * reliable 50-minute one.
 */
function formatHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

function formatHourRange(start, end) {
  return `${formatHour(start)}\u2013${formatHour(end)}`;
}

const DAYPARTS = [
  { key: 'early_morning', name: 'Early Morning', range: formatHourRange(5, 9), start: 5, end: 9 },
  { key: 'morning', name: 'Morning', range: formatHourRange(9, 12), start: 9, end: 12 },
  { key: 'afternoon', name: 'Afternoon', range: formatHourRange(12, 17), start: 12, end: 17 },
  { key: 'evening', name: 'Evening', range: formatHourRange(17, 21), start: 17, end: 21 },
  { key: 'night', name: 'Night', range: formatHourRange(21, 24), start: 21, end: 24 },
  { key: 'late_night', name: 'Late Night', range: formatHourRange(0, 5), start: 0, end: 5 },
];

function getDaypart(hour) {
  return DAYPARTS.find((d) =>
    d.start < d.end ? hour >= d.start && hour < d.end : hour >= d.start || hour < d.end
  );
}

export function computeTimeOfDayTrends(sessions) {
  const now = Date.now();
  const buckets = {};

  sessions.forEach((session) => {
    const fairScore = computeFairScore(session.score_timeline);
    if (fairScore == null || !session.created_at) return;

    const hour = new Date(session.created_at).getHours();
    const daypart = getDaypart(hour);
    if (!daypart) return;

    const weight = sessionWeight(session, { now });
    if (weight <= 0) return;

    if (!buckets[daypart.key]) {
      buckets[daypart.key] = {
        name: daypart.name,
        range: daypart.range,
        weightedSum: 0,
        totalWeight: 0,
        sessionCount: 0,
      };
    }
    buckets[daypart.key].weightedSum += fairScore * weight;
    buckets[daypart.key].totalWeight += weight;
    buckets[daypart.key].sessionCount += 1;
  });

  return Object.values(buckets)
    .filter((b) => b.totalWeight > 0)
    .map((b) => ({
      name: b.name,
      range: b.range,
      label: `${b.name} (${b.range})`, // convenience for chart axes/labels
      avgScore: Math.round(b.weightedSum / b.totalWeight),
      sessionCount: b.sessionCount,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

/**
 * Attention Span Progression
 * One point per session (fair score), oldest first, for the long-term
 * trend chart.
 */
export function computeAttentionProgression(sessions) {
  return [...sessions]
    .filter((s) => (s.score_timeline || []).length > 0 && s.created_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((s) => ({
      score: computeFairScore(s.score_timeline),
      date: s.created_at,
      taskName: s.task_name,
    }));
}

/**
 * Tailored Productivity Tips
 * Same shape as before, just sourced from the fairer, weighted
 * computations above instead of the raw cumulative score.
 */
export function generateTips({ optimalSession, timeOfDayTrends, sessions }) {
  const tips = [];

  if (optimalSession.hasEnoughData) {
    tips.push({
      title: 'Right-size your sessions',
      body: `Your focus tends to dip around the ${optimalSession.modeBin}-minute mark. Try booking ${optimalSession.recommendedMinutes}-minute sessions and taking a break before the dip hits, rather than after.`,
    });
  }

  if (timeOfDayTrends.length >= 2) {
    const best = timeOfDayTrends[0];
    const worst = timeOfDayTrends[timeOfDayTrends.length - 1];
    if (best.avgScore - worst.avgScore >= 10) {
      tips.push({
        title: 'Protect your peak hours',
        body: `You average ${best.avgScore}% in the ${best.name.toLowerCase()} (${best.range}) versus ${worst.avgScore}% in the ${worst.name.toLowerCase()} (${worst.range}). Move your hardest tasks into that ${best.name.toLowerCase()} window when you can.`,
      });
    }
  }

  const scored = sessions
    .map((s) => ({ ...s, fairScore: computeFairScore(s.score_timeline) }))
    .filter((s) => s.fairScore != null);

  const recentFive = scored.slice(0, 5);
  if (recentFive.length >= 3) {
    const avgRecent = recentFive.reduce((a, s) => a + s.fairScore, 0) / recentFive.length;
    const olderFive = scored.slice(5, 10);
    if (olderFive.length >= 3) {
      const avgOlder = olderFive.reduce((a, s) => a + s.fairScore, 0) / olderFive.length;
      const delta = Math.round(avgRecent - avgOlder);
      if (delta >= 5) {
        tips.push({
          title: 'Trending upward',
          body: `Your last few sessions average ${Math.round(avgRecent)}%, up ${delta} points from before. Whatever changed recently, keep doing it.`,
        });
      } else if (delta <= -5) {
        tips.push({
          title: 'Stretch, don\u2019t strain',
          body: `Recent sessions are averaging ${Math.round(avgRecent)}%, down ${Math.abs(delta)} points. Consider shortening your next session slightly and building back up rather than pushing through.`,
        });
      }
    }
  }

  if (tips.length === 0) {
    tips.push({
      title: 'Keep logging sessions',
      body: 'Complete a few more focus sessions and personalized tips based on your own patterns will show up here.',
    });
  }

  return tips.slice(0, 3);
}