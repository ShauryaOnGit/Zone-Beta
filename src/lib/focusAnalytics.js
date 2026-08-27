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
 * Walks the raw per-reading status and collapses consecutive DISTRACTED
 * readings into episodes, in seconds-elapsed terms.
 */
export function getDistractionEpisodes(timeline) {
  if (!timeline || timeline.length === 0) return [];

  const episodes = [];
  let current = null;

  for (const point of timeline) {
    if (point.status === 'DISTRACTED') {
      if (!current) {
        current = { startElapsed: point.elapsed, endElapsed: point.elapsed };
      } else {
        current.endElapsed = point.elapsed;
      }
    } else if (current) {
      episodes.push({ ...current, durationSeconds: current.endElapsed - current.startElapsed });
      current = null;
    }
  }
  if (current) {
    episodes.push({ ...current, durationSeconds: current.endElapsed - current.startElapsed });
  }

  return episodes;
}

/**
 * The elapsed-seconds mark of the first *sustained* distraction episode
 * (at least `minDurationSeconds` long, default 60s — long enough to
 * filter out a single noisy reading). This is what we treat as "focus
 * started to wane" for one session, used instead of hunting for a big
 * drop in the smoothed cumulative score.
 */
export function findDecayPoint(timeline, minDurationSeconds = 60) {
  const episodes = getDistractionEpisodes(timeline);
  const sustained = episodes.find((e) => e.durationSeconds >= minDurationSeconds);
  return sustained ? sustained.startElapsed : null;
}

/**
 * How much a session should count toward aggregate stats (time-of-day
 * trends, optimal session length). Combines three things:
 *   - reliability: sessions with very few readings are noisy, so they're
 *     down-weighted until they hit `reliabilityFloor` samples
 *   - duration: longer sessions are better evidence of real focus
 *     ability than a 3-minute session, capped at `durationCapMinutes` so
 *     one marathon session can't single-handedly dominate every average
 *   - recency: recent sessions count more than old ones, so recommendations
 *     track real improvement (e.g. a growing attention span) instead of
 *     staying anchored to data from weeks ago
 */
export function sessionWeight(
  session,
  {
    now = Date.now(),
    durationCapMinutes = 45,
    recencyHalfLifeDays = 21,
    reliabilityFloor = 10,
  } = {}
) {
  const timeline = session.score_timeline || [];
  const sampleCount = timeline.length;
  const durationMin = sampleCount ? (timeline[timeline.length - 1].elapsed || 0) / 60 : 0;

  const reliability = Math.min(1, sampleCount / reliabilityFloor);
  const durationWeight = Math.min(1, durationMin / durationCapMinutes);

  const daysAgo = session.created_at
    ? (now - new Date(session.created_at).getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  const recencyWeight = Math.exp(-Math.max(0, daysAgo) / recencyHalfLifeDays);

  return reliability * durationWeight * recencyWeight;
}

/**
 * Optimal Session Length
 * Finds each session's decay point (from raw status, see findDecayPoint),
 * then bins those minutes into a weighted histogram — weighted by
 * sessionWeight so long, reliable, recent sessions count for more than a
 * single noisy 4-minute session did. Recommends a length grounded
 * between the most common dip point and the weighted average.
 */
export function computeOptimalSession(sessions, { minSustainedSeconds = 60 } = {}) {
  const now = Date.now();
  const decayPoints = [];

  sessions.forEach((session) => {
    const timeline = session.score_timeline || [];
    if (timeline.length < 3) return;

    const decaySeconds = findDecayPoint(timeline, minSustainedSeconds);
    if (decaySeconds == null) return;

    decayPoints.push({
      minutes: decaySeconds / 60,
      weight: sessionWeight(session, { now }),
    });
  });

  const totalWeight = decayPoints.reduce((sum, d) => sum + d.weight, 0);

  // Require both a minimum count AND a minimum effective (weighted)
  // sample size, so two low-confidence sessions can't unlock a
  // recommendation on their own.
  if (decayPoints.length < 2 || totalWeight < 0.5) {
    return { hasEnoughData: false, decayMinutes: [], recommendedMinutes: null };
  }

  const binSize = 5;
  const bins = {};
  decayPoints.forEach(({ minutes, weight }) => {
    const bin = Math.round(minutes / binSize) * binSize;
    bins[bin] = (bins[bin] || 0) + weight;
  });

  const [modeBin] = Object.entries(bins).sort((a, b) => b[1] - a[1])[0];
  const weightedAvg = decayPoints.reduce((sum, d) => sum + d.minutes * d.weight, 0) / totalWeight;

  const recommended = Math.round(((Number(modeBin) + weightedAvg) / 2) / 5) * 5;

  return {
    hasEnoughData: true,
    decayMinutes: decayPoints.map((d) => d.minutes),
    modeBin: Number(modeBin),
    avgDecayMinutes: Math.round(weightedAvg),
    recommendedMinutes: Math.max(10, recommended),
    sampleSize: decayPoints.length,
    effectiveSampleSize: Math.round(totalWeight * 10) / 10,
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

  const scored = (sessions || [])
    .map((session) => ({
      ...session,
      fairScore: computeFairScore(session.score_timeline),
    }))
    .filter((session) => session.fairScore != null);

  const recentFive = scored.slice(0, 5);
  const olderFive = scored.slice(5, 10);

  const averageScore = (items) => {
    if (!items.length) return null;
    return items.reduce((sum, item) => sum + item.fairScore, 0) / items.length;
  };

  const sessionDurationMinutes = (session) => {
    const timeline = session?.score_timeline || [];
    if (!timeline.length) return null;
    const elapsed = Number(timeline[timeline.length - 1]?.elapsed);
    return Number.isFinite(elapsed) && elapsed > 0 ? elapsed / 60 : null;
  };

  const averageDurationMinutes = (items) => {
    const durations = items
      .map(sessionDurationMinutes)
      .filter((minutes) => minutes != null && Number.isFinite(minutes));

    if (!durations.length) return null;
    return durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length;
  };

  const evidenceWindow = (items, { countOverride = null, qualifier = 'tracked sessions' } = {}) => {
    const count = countOverride ?? items.length;
    const dates = items
      .map((item) => new Date(item?.created_at).getTime())
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);

    const countText = `${count} ${qualifier}`;

    if (dates.length < 2) {
      return `Based on ${countText}`;
    }

    const days = Math.max(1, Math.ceil((dates[dates.length - 1] - dates[0]) / 86400000));
    return `Based on ${countText} · ${days}-day window`;
  };

  const sessionsForDaypart = (daypartName) => {
    const normalized = String(daypartName || '').toLowerCase();

    const inDaypart = (hour) => {
      if (normalized === 'early morning') return hour >= 5 && hour < 9;
      if (normalized === 'morning') return hour >= 9 && hour < 12;
      if (normalized === 'afternoon') return hour >= 12 && hour < 17;
      if (normalized === 'evening') return hour >= 17 && hour < 21;
      if (normalized === 'night') return hour >= 21 && hour < 24;
      if (normalized === 'late night') return hour >= 0 && hour < 5;
      return false;
    };

    return scored.filter((session) => {
      if (!session.created_at) return false;
      return inDaypart(new Date(session.created_at).getHours());
    });
  };

  if (optimalSession.hasEnoughData) {
    const sampleCount = optimalSession.sampleSize || optimalSession.decayMinutes?.length || 0;
    const recommendedMinutes = optimalSession.recommendedMinutes;
    const dipMinute = optimalSession.modeBin;

    tips.push({
      id: 'session-length',
      title: `Your focus starts slipping around ${dipMinute} minutes — stop at ${recommendedMinutes}`,
      action: 'Take a 5-minute reset immediately after, before starting another demanding block.',
      evidence: `Across ${sampleCount} qualifying sessions, sustained attention decline appeared most consistently around minute ${dipMinute}. Stopping at ${recommendedMinutes} minutes keeps your next block just ahead of the point where your focus has repeatedly weakened.`,
      context: evidenceWindow(scored, {
        countOverride: sampleCount,
        qualifier: `qualifying session${sampleCount === 1 ? '' : 's'}`,
      }),
      basisLabel: 'Research basis',
      research: {
        source: 'Ariga & Lleras · Cognition (2011)',
        finding: 'In a sustained-attention experiment, brief task interruptions prevented the usual vigilance decline over time.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/21211793/',
      },
      body: `Across ${sampleCount} qualifying sessions, sustained attention decline appeared most consistently around minute ${dipMinute}. Stopping at ${recommendedMinutes} minutes keeps your next block just ahead of the point where your focus has repeatedly weakened.`,
    });
  }

  if (timeOfDayTrends.length >= 2) {
    const best = timeOfDayTrends[0];
    const worst = timeOfDayTrends[timeOfDayTrends.length - 1];
    const gap = best.avgScore - worst.avgScore;

    if (gap >= 10) {
      const bestSessions = sessionsForDaypart(best.name);
      const worstSessions = sessionsForDaypart(worst.name);
      const evidenceSessions = [...bestSessions, ...worstSessions];

      tips.push({
        id: 'peak-hours',
        title: `${best.range} is your strongest focus window`,
        action: `Put your highest-effort task here. Move routine work to the ${worst.name.toLowerCase()} when you can.`,
        evidence: `Your ${best.name.toLowerCase()} sessions average ${best.avgScore}% focus, compared with ${worst.avgScore}% in the ${worst.name.toLowerCase()} — a ${gap}-point advantage. Of the time windows Zone has measured, this is where your attention is most reliable.`,
        context: evidenceWindow(evidenceSessions, {
          countOverride: best.sessionCount + worst.sessionCount,
          qualifier: `relevant session${best.sessionCount + worst.sessionCount === 1 ? '' : 's'}`,
        }),
        basisLabel: 'Research basis',
        research: {
          source: 'Chauhan et al. · Chronobiology International (2025) · 65-study systematic review',
          finding: "The review found evidence that attention, inhibition and memory can perform better when cognitive work aligns with an individual's optimal time of day.",
          url: 'https://pubmed.ncbi.nlm.nih.gov/40293205/',
        },
        body: `Your ${best.name.toLowerCase()} sessions average ${best.avgScore}% focus, compared with ${worst.avgScore}% in the ${worst.name.toLowerCase()} — a ${gap}-point advantage. Of the time windows Zone has measured, this is where your attention is most reliable.`,
      });
    }
  }

  if (recentFive.length >= 3 && olderFive.length >= 3) {
    const avgRecent = averageScore(recentFive);
    const avgOlder = averageScore(olderFive);
    const delta = Math.round(avgRecent - avgOlder);
    const roundedRecent = Math.round(avgRecent);
    const roundedOlder = Math.round(avgOlder);
    const comparedSessions = [...recentFive, ...olderFive];

    if (delta >= 5) {
      tips.push({
        id: 'improving-trend',
        title: `Your focus is up ${delta} points across your latest ${recentFive.length} sessions`,
        action: 'Hold your current routine steady for the next 3 sessions before changing anything.',
        evidence: `Your latest ${recentFive.length} sessions average ${roundedRecent}%, versus ${roundedOlder}% across the previous ${olderFive.length}. That improvement is showing across several sessions rather than coming from one unusually strong result.`,
        context: evidenceWindow(comparedSessions, {
          qualifier: `compared session${comparedSessions.length === 1 ? '' : 's'}`,
        }),
        basisLabel: 'Research basis',
        research: {
          source: 'Harkin et al. · Psychological Bulletin (2016) · meta-analysis of 138 studies',
          finding: 'Across 138 experimental studies, interventions that increased progress monitoring also improved goal attainment on average.',
          url: 'https://pubmed.ncbi.nlm.nih.gov/26479070/',
        },
        body: `Your latest ${recentFive.length} sessions average ${roundedRecent}%, versus ${roundedOlder}% across the previous ${olderFive.length}. That improvement is showing across several sessions rather than coming from one unusually strong result.`,
      });
    } else if (delta <= -5) {
      const recentAverageDuration = averageDurationMinutes(recentFive);
      const fallbackTarget = recentAverageDuration == null
        ? null
        : Math.max(10, Math.round(recentAverageDuration / 5) * 5 - 5);
      const targetMinutes = optimalSession.hasEnoughData
        ? optimalSession.recommendedMinutes
        : fallbackTarget;

      const title = `Your recent focus is ${Math.abs(delta)} points below your previous baseline`;
      const action = targetMinutes
        ? `Cap the next 3 focus blocks at ${targetMinutes} minutes, then compare the scores before increasing duration again.`
        : 'Shorten each of the next 3 focus blocks by one 5-minute step, then compare the scores before increasing duration again.';

      tips.push({
        id: 'declining-trend',
        title,
        action,
        evidence: `Your latest ${recentFive.length} sessions average ${roundedRecent}%, compared with ${roundedOlder}% across the previous ${olderFive.length}. The drop spans multiple sessions, so Zone is treating it as a repeated change worth testing rather than a one-off bad session.`,
        context: evidenceWindow(comparedSessions, {
          qualifier: `compared session${comparedSessions.length === 1 ? '' : 's'}`,
        }),
        basisLabel: 'Research basis',
        research: {
          source: 'Salihu, Hill & Jaberzadeh · Reviews in the Neurosciences (2022) · systematic review/meta-analysis',
          finding: 'Across 33 neuroimaging studies, sustained cognitive work was associated with mental fatigue and time-on-task changes in cognitive-control networks.',
          url: 'https://pubmed.ncbi.nlm.nih.gov/35700454/',
        },
        body: `Your latest ${recentFive.length} sessions average ${roundedRecent}%, compared with ${roundedOlder}% across the previous ${olderFive.length}. The drop spans multiple sessions, so Zone is treating it as a repeated change worth testing rather than a one-off bad session.`,
      });
    }
  }

  if (tips.length === 0) {
    const sessionsNeeded = Math.max(0, 6 - scored.length);

    if (sessionsNeeded > 0) {
      tips.push({
        id: 'building-baseline',
        title: 'Zone is still establishing your baseline',
        action: `Complete ${sessionsNeeded} more representative focus session${sessionsNeeded === 1 ? '' : 's'} before changing your routine from this data.`,
        evidence: `Zone has ${scored.length} usable tracked session${scored.length === 1 ? '' : 's'} so far. That is not enough repeated history to separate your normal variation from a stable personal pattern with confidence.`,
        context: evidenceWindow(scored),
        basisLabel: 'Method',
        research: {
          source: 'Zone evidence threshold',
          finding: 'Zone waits for repeated observations before turning a pattern into a directive.',
          url: null,
        },
        body: `Zone has ${scored.length} usable tracked session${scored.length === 1 ? '' : 's'} so far. That is not enough repeated history to separate your normal variation from a stable personal pattern with confidence.`,
      });
    } else {
      tips.push({
        id: 'stable-baseline',
        title: 'Your data does not justify changing the routine yet',
        action: 'Keep your current setup stable for the next 3 sessions while Zone tests for a repeatable shift.',
        evidence: `Across your recent ${Math.min(scored.length, 10)} usable sessions, no session-length, time-of-day or recent-score difference has cleared Zone's threshold for a confident directive.`,
        context: evidenceWindow(scored.slice(0, 10)),
        basisLabel: 'Method',
        research: {
          source: 'Zone evidence threshold',
          finding: 'Zone only surfaces a directive when a pattern clears its minimum evidence threshold.',
          url: null,
        },
        body: `Across your recent ${Math.min(scored.length, 10)} usable sessions, no session-length, time-of-day or recent-score difference has cleared Zone's threshold for a confident directive.`,
      });
    }
  }

  return tips.slice(0, 3);
}

