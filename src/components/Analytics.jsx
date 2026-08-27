import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import LowDopamineBreak from './LowDopamineBreak';
import {
  computeOptimalSession,
  computeTimeOfDayTrends,
  computeAttentionProgression,
  generateTips,
} from '../lib/focusAnalytics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreToCoverOpacity(score) {
  const clamped = Math.max(0, Math.min(100, score));
  const inverted = (100 - clamped) / 100;
  return inverted * 0.82;
}

const OPTIMAL_BREAKS_STORAGE_PREFIX = 'zone:optimal-breaks:';


function buildSmoothPath(coords) {
  if (coords.length === 0) return '';
  if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;

  let path = `M ${coords[0].x} ${coords[0].y}`;

  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i - 1] || coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  return path;
}


// ---------------------------------------------------------------------------
// Small chart primitives (light theme, matches Feed/Profile card styling)
// ---------------------------------------------------------------------------

function AttentionProgressionChart({ points }) {
  const width = 700;
  const height = 220;
  const padding = 36;

  if (points.length < 2) {
    return (
      <div className="h-40 flex items-center justify-center border border-dashed border-slate-200 rounded-sm text-slate-500 text-sm bg-white">
        Complete a few more sessions to see your progression.
      </div>
    );
  }

  const xFor = (i) => padding + (i / (points.length - 1)) * (width - padding * 2);
  const yFor = (score) => height - padding - (score / 100) * (height - padding * 2);

  const lineCoords = points.map((p, i) => ({
    x: xFor(i),
    y: yFor(p.score),
  }));
  const linePath = buildSmoothPath(lineCoords);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56 overflow-visible">
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#E2E8F0" strokeDasharray="4" />
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#E2E8F0" strokeDasharray="4" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#CBD5E1" />

        <path
          d={linePath}
          fill="none"
          stroke="#0F172A"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p, i) => (
          <circle key={i} cx={xFor(i)} cy={yFor(p.score)} r="3.5" fill="bg-slate-900" />
        ))}
      </svg>
      <div className="flex justify-between text-xs text-slate-500 mt-2">
        <span>{new Date(points[0].date).toLocaleDateString()}</span>
        <span>{new Date(points[points.length - 1].date).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function TimeOfDayChart({ trends }) {
  if (trends.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center border border-dashed border-slate-200 rounded-sm text-slate-500 text-sm bg-white">
        Not enough sessions yet to spot a time-of-day pattern.
      </div>
    );
  }

  const maxScore = 100;

  return (
    <div className="space-y-3">
      {trends.map((t) => (
        <div key={t.name} className="flex items-center gap-4">
          <div className="w-32 shrink-0 leading-tight">
            <div className="text-sm text-slate-700 font-medium">{t.name}</div>
            <div className="text-[11px] text-slate-400">{t.range}</div>
          </div>
          <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
            <div
              className="h-full bg-slate-900 flex items-center justify-end pr-2 rounded-full transition-all"
              style={{ width: `${Math.max(6, (t.avgScore / maxScore) * 100)}%` }}
            >
              <span className="text-xs font-bold text-white">{t.avgScore}%</span>
            </div>
          </div>
          <div className="w-20 text-xs text-slate-500 shrink-0 text-right">
            {t.sessionCount} session{t.sessionCount === 1 ? '' : 's'}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Locked Pro preview
// ---------------------------------------------------------------------------

function LockIcon({ size = 18, strokeWidth = 2 }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}


const DOMAIN_SUFFIX_PARTS = new Set([
  'com',
  'net',
  'org',
  'io',
  'ai',
  'app',
  'dev',
  'co',
  'uk',
  'us',
  'ca',
  'au',
  'edu',
  'gov',
]);

function normalizeFocusSink(value) {
  const sink = String(value || '').trim();
  if (!sink) return null;

  const normalized = sink.toLowerCase();
  if (['n/a', 'na', 'unknown', 'none', 'unsure', 'unidentified'].includes(normalized)) {
    return null;
  }

  return sink;
}

function looksLikeSinkDomain(value) {
  const text = String(value || '').trim();
  return (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ||
    (!/\s/.test(text) && text.includes('.'))
  );
}

function canonicalizeFocusSink(value) {
  const sink = normalizeFocusSink(value);
  if (!sink) return null;

  const lower = sink.toLowerCase();
  let tokens = [];

  if (looksLikeSinkDomain(lower)) {
    try {
      const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(lower)
        ? lower
        : `https://${lower}`;

      const host = new URL(candidate)
        .hostname
        .toLowerCase()
        .replace(/^www\./, '');

      tokens = host
        .split('.')
        .flatMap((part) => part.split(/[^a-z0-9]+/))
        .filter(Boolean);

      // Remove domain infrastructure from the right-hand side.
      // Repeating this handles suffixes such as .co.uk.
      while (tokens.length > 1 && DOMAIN_SUFFIX_PARTS.has(tokens[tokens.length - 1])) {
        tokens.pop();
      }
    } catch {
      tokens = [];
    }
  }

  // Plain labels such as "Google Docs" or a malformed domain still get a
  // deterministic word-based key.
  if (tokens.length === 0) {
    tokens = lower
      .replace(/^www\./, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  // "google" identifies the parent company, not the product, when another
  // service word exists. This keeps Docs, Drive and Sheets as separate sinks.
  if (tokens.length > 1 && tokens.includes('google')) {
    tokens = tokens.filter((token) => token !== 'google');
  }

  if (tokens.length === 0) return null;

  return {
    key: tokens.join(''),
    tokens,
    raw: sink,
    isDomain: looksLikeSinkDomain(sink),
  };
}

function prettyFocusSinkName(canonical) {
  if (!canonical) return '';

  // Prefer Qwen's readable app/site label whenever it supplied one.
  // A domain-only verdict falls back to the meaningful service tokens.
  if (!canonical.isDomain) {
    return canonical.raw;
  }

  return canonical.tokens
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function computeFocusSinks(sessions) {
  const counts = new Map();

  for (const session of sessions || []) {
    let logs = session?.distracted_logs;

    if (typeof logs === 'string') {
      try {
        logs = JSON.parse(logs);
      } catch {
        logs = [];
      }
    }

    if (!Array.isArray(logs)) continue;

    for (const log of logs) {
      const canonical = canonicalizeFocusSink(log?.sink);
      if (!canonical?.key) continue;

      const existing = counts.get(canonical.key);

      if (existing) {
        existing.count += 1;

        // If the group started with a raw domain and a later verdict contains
        // a cleaner human-readable label, use that label for display.
        if (existing.isDomain && !canonical.isDomain) {
          existing.name = prettyFocusSinkName(canonical);
          existing.isDomain = false;
        }
      } else {
        counts.set(canonical.key, {
          name: prettyFocusSinkName(canonical),
          count: 1,
          isDomain: canonical.isDomain,
        });
      }
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(({ name, count }) => ({ name, count }));
}


function LockedAnalyticsPreview() {
  const demoTrends = [
    { label: 'Morning', value: 84 },
    { label: 'Afternoon', value: 67 },
    { label: 'Evening', value: 74 },
  ];

  const demoLine = '24,122 105,105 185,112 265,82 345,91 425,58 505,69 586,38';

  return (
    <div className="mb-8">
      <h1 className="mt-2 text-3xl font-semibold text-slate-900 mb-8">Analytics</h1>

      {/* Premium value proposition */}
      <section className="relative overflow-hidden rounded-md border border-[#D0D7DE] bg-white shadow-sm mb-10">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 12% 18%, rgba(244,116,74,0.16), transparent 28%), radial-gradient(circle at 88% 16%, rgba(143,95,219,0.17), transparent 30%), radial-gradient(circle at 76% 86%, rgba(90,158,221,0.16), transparent 34%), radial-gradient(circle at 18% 86%, rgba(62,168,157,0.12), transparent 30%)',
          }}
        />

        <div className="relative px-8 py-9 md:px-10 md:py-10">
          <div className="flex flex-col 2xl:flex-row 2xl:items-center 2xl:justify-between gap-8 2xl:gap-12">
            <div className="max-w-2xl 2xl:max-w-3xl">

              <h2 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900 leading-[1.08]">
                Your focus has a pattern.
                <span className="block text-slate-600">Pro shows you exactly what it is.</span>
              </h2>

              <p className="mt-4 text-[15px] leading-7 text-slate-600 max-w-xl">
                Turn every focus session into a clear picture of when your attention drops,
                when you work best, what distracts you, and how to structure your next session.
              </p>

              <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2.5 text-sm text-slate-700">
                {[
                  'Distraction explanations',
                  'Personalized session length',
                  'Long-term focus trends',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="text-emerald-600"><CheckIcon /></span>
                    <span className="font-medium">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <button className="w-full 2xl:w-auto 2xl:min-w-[280px] px-5 py-3 bg-slate-900 hover:bg-indigo-600 text-white rounded-md font-semibold text-sm transition-all cursor-pointer shadow-sm active:scale-[0.99]">
                Upgrade to Pro
              </button>
          </div>
        </div>
      </section>

      {/* Mirrors the unlocked Analytics layout so the upgrade feels tangible */}
      <div className="space-y-10">
        <section className="relative overflow-hidden rounded-md border border-[#D0D7DE] bg-slate-50 p-7 shadow-sm">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at 12% 18%, rgba(244,116,74,0.16), transparent 28%), radial-gradient(circle at 88% 16%, rgba(143,95,219,0.17), transparent 30%), radial-gradient(circle at 76% 86%, rgba(90,158,221,0.16), transparent 34%), radial-gradient(circle at 18% 86%, rgba(62,168,157,0.12), transparent 30%)',
            }}
          />

          <div className="relative">
            <h2 className="text-xl font-semibold text-slate-900">Personalized Insights</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Specific next steps from your own focus patterns, with the evidence and research basis underneath.
            </p>

            <div className="relative mt-5">
              <div className="divide-y divide-slate-200/80 select-none blur-[4px] opacity-65" aria-hidden="true">
                {[
                  {
                    title: 'End your next focus block at 45 minutes',
                    collapsedDetail: 'Take a 5-minute reset immediately after, before starting another demanding block.',
                  },
                  {
                    title: 'Reserve 9 AM–12 PM for your hardest work',
                    collapsedDetail: 'Put your highest-effort task inside this window and move routine work elsewhere.',
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="flex items-center justify-between gap-5 py-4"
                  >
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-900">
                        {item.title}
                      </h3>
                      {item.collapsedDetail && (
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          {item.collapsedDetail}
                        </p>
                      )}
                    </div>

                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0 text-slate-400"
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
                ))}
              </div>

              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="rounded-md border border-slate-200 bg-white/95 shadow-sm px-3 py-1.5 text-xs font-semibold text-slate-600 flex items-center gap-2">
                  <LockIcon size={13} /> Reveal your personalized insights
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-md border border-[#D0D7DE] bg-white p-7 shadow-sm">
          <div>
            <div className="flex items-start justify-between gap-5">
              <div className="max-w-2xl">
                <h2 className="text-xl font-semibold text-slate-900">Optimal Session Length</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  A personalized estimate of how long you can sustain strong focus before attention starts to dip.
                </p>
              </div>
              <span className="shrink-0 rounded-md border border-slate-200 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                Personalized insight
              </span>
            </div>

            <div className="relative mt-8">
              <div className="select-none blur-[4px] opacity-70" aria-hidden="true">
                <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
                  <div>
                    <p className="text-sm font-medium text-slate-600 mb-1">
                      Your ideal focus window is about
                    </p>
                    <div className="flex items-end gap-2">
                      <span className="text-6xl font-black tracking-tight text-slate-900">45</span>
                      <span className="text-xl font-semibold text-slate-400 mb-1.5">min</span>
                    </div>
                  </div>

                  <p className="text-sm leading-7 text-slate-600 max-w-xl">
                    Your attention typically begins to decline around minute 47. A short break just before that point
                    can help preserve more high-quality focus.
                  </p>
                </div>

                <div className="mt-7 border-t border-slate-200 pt-5 flex items-center justify-between gap-5">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Use optimal break timing</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Make an optional 5-minute break available after every recommended focus block.
                    </p>
                  </div>
                  <div className="relative h-6 w-11 shrink-0 rounded-full bg-slate-200">
                    <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm" />
                  </div>
                </div>

                <p className="mt-4 text-xs leading-5 text-slate-400">
                  Built from recent, well-tracked sessions.
                </p>
              </div>

              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="rounded-md border border-slate-200 bg-white/95 shadow-sm px-3 py-1.5 text-xs font-semibold text-slate-600 flex items-center gap-2">
                  <LockIcon size={13} /> Reveal your optimal focus window
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-sm border border-[#D0D7DE] bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">Time-of-Day Trends</h2>
              <p className="text-sm text-slate-500">Your average focus score by time of day.</p>
            </div>
          </div>

          <div className="relative p-4 overflow-hidden">
            <div className="space-y-3 opacity-70 select-none blur-[4px]" aria-hidden="true">
              {demoTrends.map((row) => (
                <div key={row.label} className="flex items-center gap-4">
                  <div className="w-28 text-sm font-medium text-slate-700">{row.label}</div>
                  <div className="flex-1 h-6 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-slate-900 blur-[4px]" style={{ width: `${row.value}%` }} />
                  </div>
                  <div className="w-12 text-right text-xs text-slate-500 blur-[4px]">{row.value}%</div>
                </div>
              ))}
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-white/10 backdrop-blur-[1px] pointer-events-none">
              <div className="rounded-md border border-slate-200 bg-white/95 shadow-sm px-3 py-1.5 text-xs font-semibold text-slate-600 flex items-center gap-2">
                <LockIcon size={13} /> Reveal your best focus window
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-sm border border-[#D0D7DE] bg-slate-50 p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">Attention Span Progression</h2>
              <p className="text-sm text-slate-500">Your focus score across sessions over time.</p>
            </div>
          </div>

          <div className="relative w-full bg-white p-4 rounded-sm border border-slate-200 overflow-hidden">
            <svg viewBox="0 0 620 170" className="w-full h-44 opacity-65 select-none" aria-hidden="true">
              <line x1="24" y1="28" x2="596" y2="28" stroke="#E2E8F0" strokeDasharray="4" />
              <line x1="24" y1="84" x2="596" y2="84" stroke="#E2E8F0" strokeDasharray="4" />
              <line x1="24" y1="140" x2="596" y2="140" stroke="#CBD5E1" />
              <polyline
                fill="none"
                stroke="#0F172A"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={demoLine}
                style={{ filter: 'blur(4px)' }}
              />
              <line x1="24" y1="119" x2="586" y2="48" stroke="#16A34A" strokeWidth="2" strokeDasharray="6 4" opacity="0.45" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center bg-white/5 backdrop-blur-[4px] pointer-events-none">
              <div className="rounded-md border border-slate-200 bg-white/95 shadow-sm px-3 py-1.5 text-xs font-semibold text-slate-600 flex items-center gap-2">
                <LockIcon size={13} /> See if your attention span is improving
              </div>
            </div>
          </div>
        </section>


        <section className="rounded-md border border-slate-200 bg-slate-900 text-white px-6 py-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-400 mb-1">Zone Pro</p>
              <h3 className="text-xl font-bold">Turn your sessions into a focus strategy.</h3>
              <p className="text-sm text-slate-300 mt-1">Unlock the dashboard above with your real session history.</p>
            </div>
            <button className="shrink-0 px-6 py-3 bg-white hover:bg-slate-100 text-slate-900 rounded-md font-semibold text-sm transition-colors cursor-pointer shadow-sm">
              Upgrade to Pro
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Analytics({ session }) {
  const location = useLocation();
  const navigate = useNavigate();
  const targetPostId = location.state?.targetPostId ?? null;
  const shouldOpenTarget = Boolean(location.state?.openSessionSummary && targetPostId);
  const [isPro, setIsPro] = useState(false);
  const [sessionsData, setSessionsData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [breakActive, setBreakActive] = useState(false);
  const [optimalBreaksEnabled, setOptimalBreaksEnabled] = useState(false);
  const [optimalBreaksSaving, setOptimalBreaksSaving] = useState(false);
  const [expandedInsightKeys, setExpandedInsightKeys] = useState(() => new Set());
  const breakLengthRef = useRef(5);

  // Existing Feed/Profile summary links used to point at Analytics.
  // Redirect those deep links into the new free History page.
  useEffect(() => {
    if (!shouldOpenTarget) return;

    navigate('/history', {
      replace: true,
      state: { targetPostId, openSessionSummary: true },
    });
  }, [navigate, shouldOpenTarget, targetPostId]);


  const toggleInsight = (key) => {
    setExpandedInsightKeys((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  };

  const handleOptimalBreaksToggle = async () => {
    if (
      !session?.user?.id ||
      !optimalSession.hasEnoughData ||
      optimalBreaksSaving
    ) {
      return;
    }

    const previous = optimalBreaksEnabled;
    const next = !previous;

    // Optimistic update keeps the switch feeling immediate.
    setOptimalBreaksEnabled(next);
    setOptimalBreaksSaving(true);

    const { error: preferenceError } = await supabase
      .from('profiles')
      .update({ optimal_breaks_enabled: next })
      .eq('user_id', session.user.id);

    if (preferenceError) {
      console.error('Could not save optimal-break preference:', preferenceError);
      setOptimalBreaksEnabled(previous);
    }

    setOptimalBreaksSaving(false);
  };

  useEffect(() => {
    if (!session?.user) {
      setLoading(false);
      return;
    }

    const fetchAnalytics = async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_pro, optimal_breaks_enabled')
        .eq('user_id', session.user.id)
        .single();

      setOptimalBreaksEnabled(Boolean(profile?.optimal_breaks_enabled));

      if (!profile?.is_pro) {
        setLoading(false);
        return;
      }
      setIsPro(true);

      const { data: posts, error: postsError } = await supabase
        .from('feed_posts')
        .select('id, task_name, focus_score, time_elapsed, score_timeline, created_at, theme_id, distracted_logs')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (postsError) {
        console.error('Failed to load analytics sessions:', postsError);
        setLoading(false);
        return;
      }

      const resolvedPosts = [...(posts || [])].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setSessionsData(resolvedPosts);
      setLoading(false);
    };

    fetchAnalytics();
  }, [session]);

  const optimalSession = useMemo(() => computeOptimalSession(sessionsData), [sessionsData]);
  const timeOfDayTrends = useMemo(() => computeTimeOfDayTrends(sessionsData), [sessionsData]);
  const attentionProgression = useMemo(() => computeAttentionProgression(sessionsData), [sessionsData]);
  const focusSinks = useMemo(() => computeFocusSinks(sessionsData), [sessionsData]);
  const tips = useMemo(
    () => generateTips({ optimalSession, timeOfDayTrends, sessions: sessionsData }),
    [optimalSession, timeOfDayTrends, sessionsData]
  );

  if (shouldOpenTarget) {
    return null;
  }

  if (loading) {
    return (
      <div className="bg-white rounded-sm border border-slate-200 p-6 shadow-sm">
        <p className="text-sm text-slate-500">Loading analytics...</p>
      </div>
    );
  }

  if (!isPro) {
    return <LockedAnalyticsPreview />;
  }

  if (breakActive) {
    return (
      <LowDopamineBreak
        durationSeconds={breakLengthRef.current * 60}
        onComplete={() => setBreakActive(false)}
        onSkip={() => setBreakActive(false)}
      />
    );
  }

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Analytics</h1>
      </div>

      {sessionsData.length === 0 ? (
        <div className="rounded-sm border border-[#D0D7DE] bg-slate-50 p-6 shadow-sm">
          <p className="text-sm text-slate-500">Complete a focus session to see your data.</p>
        </div>
      ) : (
        <div className="space-y-10">

          {/* Personalized Insights */}
          <section className="relative overflow-hidden rounded-md border border-[#D0D7DE] bg-slate-50 p-7 shadow-sm">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle at 12% 18%, rgba(244,116,74,0.16), transparent 28%), radial-gradient(circle at 88% 16%, rgba(143,95,219,0.17), transparent 30%), radial-gradient(circle at 76% 86%, rgba(90,158,221,0.16), transparent 34%), radial-gradient(circle at 18% 86%, rgba(62,168,157,0.12), transparent 30%)',
              }}
            />

            <div className="relative">
              <h2 className="text-xl font-semibold text-slate-900">Personalized Insights</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Specific next steps from your own focus patterns, with the evidence and research basis underneath.
              </p>

              <div className="mt-5 divide-y divide-slate-200/80">
                {tips.map((tip, i) => {
                  const insightKey = String(tip.id || tip.title || i);
                  const isExpanded = expandedInsightKeys.has(insightKey);
                  const showActionWhenCollapsed = Boolean(tip.action);

                  return (
                    <article key={insightKey}>
                      <button
                        type="button"
                        onClick={() => toggleInsight(insightKey)}
                        aria-expanded={isExpanded}
                        className="w-full flex items-center justify-between gap-5 py-4 text-left cursor-pointer"
                      >
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold text-slate-900">
                            {tip.title}
                          </h3>

                          {showActionWhenCollapsed && tip.action && (
                            <p className="mt-1 text-sm leading-6 text-slate-500">
                              {tip.action}
                            </p>
                          )}
                        </div>

                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`shrink-0 text-slate-400 transition-transform duration-200 ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                          aria-hidden="true"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="pb-5 pr-8">
                          {tip.action && !showActionWhenCollapsed && (
                            <p className="text-sm font-medium leading-6 text-slate-700">
                              {tip.action}
                            </p>
                          )}

                          {tip.evidence && (
                            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">
                              {tip.evidence}
                            </p>
                          )}

                          {tip.research && (
                            <p className="mt-3 max-w-3xl text-xs leading-5 text-slate-400">
                              <span className="font-semibold text-slate-500">
                                {tip.basisLabel || 'Research basis'}:
                              </span>{' '}
                              {tip.research.source}
                              {tip.research.finding ? ` — ${tip.research.finding}` : ''}
                            </p>
                          )}

                          {tip.context && (
                            <p className="mt-3 text-[11px] font-medium text-slate-400">
                              {tip.context}
                            </p>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Optimal Session Length */}
          <section className="relative overflow-hidden rounded-md border border-[#D0D7DE] bg-white p-7 shadow-sm">
            <div>
              <div className="flex items-start justify-between gap-5">
                <div className="max-w-2xl">
                  <h2 className="text-xl font-semibold text-slate-900">Optimal Session Length</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    A personalized estimate of how long you can sustain strong focus before attention starts to dip.
                  </p>
                </div>

                {optimalSession.hasEnoughData && (
                  <span className="shrink-0 rounded-md border border-slate-200 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                    {optimalSession.sampleSize >= 8
                      ? 'Strong pattern'
                      : optimalSession.sampleSize >= 4
                        ? 'Personalized estimate'
                        : 'Early estimate'}
                  </span>
                )}
              </div>

              {optimalSession.hasEnoughData ? (
                <>
                  <div className="mt-8 grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
                    <div>
                      <p className="text-sm font-medium text-slate-600 mb-1">
                        Your ideal focus window is about
                      </p>

                      <div className="flex items-end gap-2">
                        <span className="text-6xl font-black tracking-tight text-slate-900">
                          {optimalSession.recommendedMinutes}
                        </span>
                        <span className="text-xl font-semibold text-slate-400 mb-1.5">min</span>
                      </div>
                    </div>

                    <p className="text-sm leading-7 text-slate-600 max-w-2xl">
                      Your attention typically begins to decline around minute {optimalSession.modeBin}. A short break
                      just before that point can help preserve more high-quality focus.
                    </p>
                  </div>

                  <div className="mt-7 border-t border-slate-200 pt-5 flex items-center justify-between gap-5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        Use optimal break timing
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Make an optional 5-minute break available after every {optimalSession.recommendedMinutes}-minute focus block.
                      </p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={optimalBreaksEnabled}
                      aria-busy={optimalBreaksSaving}
                      onClick={handleOptimalBreaksToggle}
                      disabled={optimalBreaksSaving}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                        optimalBreaksEnabled ? 'bg-slate-900' : 'bg-slate-200'
                      } ${optimalBreaksSaving ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
                      title={
                        optimalBreaksSaving
                          ? 'Saving preference...'
                          : optimalBreaksEnabled
                            ? 'Optimal break timing is on'
                            : 'Optimal break timing is off'
                      }
                    >
                      <span
                        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                          optimalBreaksEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <p
                    className="mt-4 text-xs leading-5 text-slate-400"
                    title="Recent, longer, well-tracked sessions contribute more strongly to this estimate."
                  >
                    Built from recent, well-tracked sessions.
                  </p>
                </>
              ) : (
                <div className="mt-7">
                  <p className="text-sm font-semibold text-slate-700">
                    Zone is still learning your focus window.
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-500 max-w-2xl">
                    Complete a few more well-tracked sessions. Focused sessions still count as evidence even when no
                    sustained attention drop is detected.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Focus Sinks */}
          <section className="relative overflow-hidden rounded-md border border-[#D0D7DE] bg-white p-7 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Focus Sinks</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  The apps and websites that appear most often in your recent distracted verdicts.
                </p>
              </div>
            </div>

            {focusSinks.length > 0 ? (
              <div className="mt-6 divide-y divide-slate-200">
                {focusSinks.map((sink, index) => (
                  <div
                    key={sink.name.toLowerCase()}
                    className="flex items-center justify-between gap-5 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 text-xs font-semibold tabular-nums text-slate-400">
                        {index + 1}
                      </span>
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {sink.name}
                      </span>
                    </div>

                    <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-600">
                      {sink.count} {sink.count === 1 ? 'hit' : 'hits'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-6 text-sm text-slate-500">
                No identifiable focus sinks yet. New distracted verdicts will build this list.
              </p>
            )}
          </section>

          {/* Time of Day */}
          <section className="relative overflow-hidden rounded-md border border-[#D0D7DE] bg-white p-7 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Time-of-Day Trends</h2>
                <p className="text-sm text-slate-500">Your average focus score by time of day.</p>
              </div>
            </div>

            <div className="mt-6 overflow-hidden">
              <TimeOfDayChart trends={timeOfDayTrends} />
            </div>
          </section>

          {/* Attention Span Progression */}
          <section className="relative overflow-hidden rounded-md border border-[#D0D7DE] bg-white p-7 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Attention Span Progression</h2>
                <p className="text-sm text-slate-500">Your focus score across sessions over time.</p>
              </div>
            </div>

            <div className="relative mt-6 w-full overflow-hidden">
              <AttentionProgressionChart points={attentionProgression} />
            </div>
          </section>

        </div>
      )}
    </div>
  );
}