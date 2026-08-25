import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { feedCardThemes } from '../feedCardThemes';
import LowDopamineBreak from './LowDopamineBreak';
import {
  computeFairScore,
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

  const linePoints = points.map((p, i) => `${xFor(i)},${yFor(p.score)}`).join(' ');

  // simple linear regression for a trend line
  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.score);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  const slopeNum = xs.reduce((sum, x, i) => sum + (x - xMean) * (ys[i] - yMean), 0);
  const slopeDen = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const slope = slopeDen === 0 ? 0 : slopeNum / slopeDen;
  const intercept = yMean - slope * xMean;
  const trendStart = intercept;
  const trendEnd = slope * (n - 1) + intercept;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56 overflow-visible">
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#E2E8F0" strokeDasharray="4" />
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#E2E8F0" strokeDasharray="4" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#CBD5E1" />

        {/* trend line */}
        <line
          x1={xFor(0)}
          y1={yFor(Math.max(0, Math.min(100, trendStart)))}
          x2={xFor(n - 1)}
          y2={yFor(Math.max(0, Math.min(100, trendEnd)))}
          stroke="#16A34A"
          strokeWidth="2"
          strokeDasharray="6 4"
          opacity="0.55"
        />

        <polyline
          fill="none"
          stroke="bg-slate-900"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={linePoints}
        />

        {points.map((p, i) => (
          <circle key={i} cx={xFor(i)} cy={yFor(p.score)} r="3.5" fill="bg-slate-900" />
        ))}
      </svg>
      <div className="flex justify-between text-xs text-slate-500 mt-2">
        <span>{new Date(points[0].date).toLocaleDateString()}</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-green-600" style={{ opacity: 0.6 }} />
          trend
        </span>
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
// Accordion Component for Individual Sessions
// ---------------------------------------------------------------------------

function SessionAccordion({ sessionData, defaultOpen = false, shouldScroll = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!defaultOpen) return;
    setIsOpen(true);

    if (shouldScroll) {
      requestAnimationFrame(() => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }, [defaultOpen, shouldScroll]);

  const timeline = sessionData.score_timeline || [];
  const distractionLogs = Array.isArray(sessionData.distracted_logs) ? sessionData.distracted_logs : [];
  const width = 600;
  const height = 200;
  const padding = 40;

  const maxTime = timeline.length > 0
    ? Math.max(...timeline.map((d) => d.elapsed || d.timestamp || 0), 1)
    : 1;

  const points = timeline
    .map((d) => {
      const t = d.elapsed || d.timestamp || 0;
      const s = d.score || 0;
      const x = padding + (t / maxTime) * (width - padding * 2);
      const y = height - padding - (s / 100) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const theme = feedCardThemes.find((t) => t.id === sessionData.theme_id) ?? feedCardThemes[0];
  const fairScore = computeFairScore(timeline) ?? sessionData.focus_score;
  const coverOpacity = scoreToCoverOpacity(parseFloat(fairScore));
  const expandedGradient = theme.gradient.replace('circle 340px', 'circle 600px');

  const formatElapsed = (seconds) => {
    const total = Number(seconds);
    if (!Number.isFinite(total)) return 'Unknown time';
    const minutes = Math.floor(total / 60);
    const secs = Math.floor(total % 60);
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div
      ref={containerRef}
      onClick={() => setIsOpen(!isOpen)}
      className="relative rounded-md text-slate-900 w-full break-inside-avoid border border-[#D0D7DE] overflow-hidden shadow-sm cursor-pointer transition-all hover:border-slate-400"
      style={{ background: expandedGradient }}
    >
      <div
        className="absolute inset-0 z-0 pointer-events-none transition-opacity duration-700"
        style={{ background: '#e7edf3', opacity: coverOpacity }}
      />

      <div className="relative z-10 px-6 py-5 flex justify-between items-center">
        <div>
          <h3 className="text-[20px] leading-tight font-extrabold mb-1">{sessionData.task_name || 'Focus Session'}</h3>
          <p className="text-xs text-slate-600">{new Date(sessionData.created_at).toLocaleString()}</p>
        </div>

        <div className="flex gap-8 text-left">
          {sessionData.time_elapsed && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-600 mb-1">Time Elapsed</p>
              <p className="text-lg font-semibold">{sessionData.time_elapsed}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-600 mb-1">Focus Score</p>
            <p className="text-lg font-semibold">{fairScore}</p>
          </div>
        </div>
      </div>

      {isOpen && (
        <div
          className="relative z-10 px-6 pb-6 cursor-default space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          {timeline.length > 0 ? (
            <div className="w-full bg-white/60 backdrop-blur-md p-4 rounded-sm border border-slate-200 mt-2">
              <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48 overflow-visible">
                <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#E2E8F0" strokeDasharray="4" />
                <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#E2E8F0" strokeDasharray="4" />
                <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#CBD5E1" />

                <text x={padding - 10} y={padding} textAnchor="end" alignmentBaseline="middle" className="text-[10px] fill-slate-500 font-semibold">100</text>
                <text x={padding - 10} y={height / 2} textAnchor="end" alignmentBaseline="middle" className="text-[10px] fill-slate-500 font-semibold">50</text>
                <text x={padding - 10} y={height - padding} textAnchor="end" alignmentBaseline="middle" className="text-[10px] fill-slate-500 font-semibold">0</text>

                <text x={padding} y={height - padding + 15} textAnchor="middle" alignmentBaseline="hanging" className="text-[10px] fill-slate-500 font-semibold">0</text>
                <text x={width - padding} y={height - padding + 15} textAnchor="middle" alignmentBaseline="hanging" className="text-[10px] fill-slate-500 font-semibold">{Math.round(maxTime)} sec</text>

                <polyline
                  fill="none"
                  stroke="#0F172A"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={points}
                />
              </svg>
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center border border-dashed border-slate-200 rounded-sm text-slate-500 text-sm bg-white/70 backdrop-blur-md mt-2">
              No timeline data available for this session.
            </div>
          )}

          <div className="bg-white/70 backdrop-blur-md rounded-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-slate-900">Distraction Logs</h4>
              <span className="text-[11px] font-semibold text-slate-500">{distractionLogs.length}</span>
            </div>

            {distractionLogs.length === 0 ? (
              <p className="text-sm text-slate-500">No distracted verdicts recorded for this session.</p>
            ) : (
              <div className="space-y-2">
                {distractionLogs.map((log, index) => (
                  <div key={`${log.occurred_at || log.elapsed_seconds || 'log'}-${index}`} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-4 mb-1">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-rose-600">Distracted</span>
                      <span className="text-xs text-slate-500">
                        {formatElapsed(log.elapsed_seconds)} into session
                        {log.occurred_at ? ` · ${new Date(log.occurred_at).toLocaleTimeString()}` : ''}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{log.explanation || 'No explanation returned.'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
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


function InsightIcon({ type }) {
  const common = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  if (type === 'time') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  if (type === 'trend') {
    return (
      <svg {...common}>
        <path d="M4 16l5-5 4 4 7-8" />
        <path d="M15 7h5v5" />
      </svg>
    );
  }

  if (type === 'recovery') {
    return (
      <svg {...common}>
        <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8" />
        <path d="M4 4v4h4" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l2.5 2.5" />
      <path d="M8 3h8" />
    </svg>
  );
}

function tipPresentation(tip) {
  const title = (tip?.title || '').toLowerCase();

  if (title.includes('right-size')) {
    return {
      type: 'session',
      eyebrow: 'Session length',
      accent: 'rgba(90,158,221,0.12)',
      actionLabel: 'Best move',
      action: 'Take a short break just before your usual dip.',
    };
  }

  if (title.includes('peak')) {
    return {
      type: 'time',
      eyebrow: 'Peak focus window',
      accent: 'rgba(244,166,74,0.12)',
      actionLabel: 'Best move',
      action: 'Protect this window for your hardest work.',
    };
  }

  if (title.includes('trending upward')) {
    return {
      type: 'trend',
      eyebrow: 'Momentum',
      accent: 'rgba(62,168,157,0.12)',
      actionLabel: 'Keep doing',
      action: 'Repeat the conditions that made your recent sessions stronger.',
    };
  }

  if (title.includes('stretch')) {
    return {
      type: 'recovery',
      eyebrow: 'Recovery signal',
      accent: 'rgba(143,95,219,0.11)',
      actionLabel: 'Best move',
      action: 'Ease the next session slightly, then build back up.',
    };
  }

  return {
    type: 'session',
    eyebrow: 'Focus pattern',
    accent: 'rgba(90,158,221,0.10)',
    actionLabel: 'Next step',
    action: 'Keep logging sessions so Zone can sharpen this recommendation.',
  };
}

function splitTipBody(body = '') {
  const parts = body.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [];
  if (parts.length <= 1) {
    return { insight: body, detail: '' };
  }

  return {
    insight: parts[0],
    detail: parts.slice(1).join(' '),
  };
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
                  'Past session summaries',
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
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Personalized Insights</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                The easiest steps you can take, based on your current recorded habits, to improve your productivity.
              </p>
            </div>

            <div className="relative mt-5">
              <div className="select-none blur-[4px] opacity-65" aria-hidden="true">
                {[
                  {
                    title: 'Right-size your sessions',
                    hero: '45 min',
                    action: 'Take a short break just before your usual dip.',
                    detail: 'Your recent sessions show a repeatable attention drop at a similar point.',
                  },
                  {
                    title: 'Protect your peak hours',
                    hero: '9 AM–12 PM',
                    action: 'Put your hardest work inside your strongest focus window.',
                    detail: 'Your recent sessions show a clear difference between stronger and weaker times of day.',
                  },
                ].map((item, index) => (
                  <div
                    key={item.title}
                    className={`${index === 0 ? '' : 'border-t border-slate-200/80'} py-5`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-900">
                        {item.title}
                      </h3>
                      <span className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                        {item.hero}
                      </span>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {item.action}
                    </p>
                    <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">
                      {item.detail}
                    </p>
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

        <section>
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Session Summaries</h2>
              <p className="text-sm text-slate-500 mt-1">Open any session to inspect its attention timeline and distraction log.</p>
            </div>
          </div>

          <div className="space-y-4">
            {[
              { title: 'Deep work session', time: '48:12', score: '91', gradient: 'linear-gradient(120deg, #d9eafb 0%, #eef5ff 50%, #b8dbf8 100%)' },
              { title: 'Revision block', time: '36:40', score: '84', gradient: 'linear-gradient(120deg, #ffd8c6 0%, #fff0e9 52%, #ffb28f 100%)' },
            ].map((item) => (
              <div
                key={item.title}
                className="relative overflow-hidden rounded-md border border-[#D0D7DE] shadow-sm"
                style={{ background: item.gradient }}
              >
                <div className="px-6 py-5 flex justify-between items-center gap-6 opacity-70 blur-[4px] select-none" aria-hidden="true">
                  <div>
                    <h3 className="text-[20px] leading-tight font-extrabold text-slate-900 mb-1">{item.title}</h3>
                    <p className="text-xs text-slate-600">Sample session</p>
                  </div>
                  <div className="flex gap-8 text-left">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-600 mb-1">Time Elapsed</p>
                      <p className="text-lg font-semibold text-slate-900">{item.time}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-600 mb-1">Focus Score</p>
                      <p className="text-lg font-semibold text-slate-900">{item.score}</p>
                    </div>
                  </div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center bg-white/5 backdrop-blur-[1px] pointer-events-none">
                  <div className="rounded-md border border-white/80 bg-white/92 shadow-sm px-3 py-1.5 text-xs font-semibold text-slate-600 flex items-center gap-2">
                    <LockIcon size={13} /> Unlock past session details
                  </div>
                </div>
              </div>
            ))}
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
  const targetPostId = location.state?.targetPostId ?? null;
  const shouldOpenTarget = Boolean(location.state?.openSessionSummary && targetPostId);
  const [isPro, setIsPro] = useState(false);
  const [sessionsData, setSessionsData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [breakActive, setBreakActive] = useState(false);
  const [optimalBreaksEnabled, setOptimalBreaksEnabled] = useState(false);
  const [optimalBreaksSaving, setOptimalBreaksSaving] = useState(false);
  const breakLengthRef = useRef(5);


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

      let resolvedPosts = posts || [];

      if (targetPostId && !resolvedPosts.some((post) => String(post.id) === String(targetPostId))) {
        const { data: targetPost, error: targetError } = await supabase
          .from('feed_posts')
          .select('id, task_name, focus_score, time_elapsed, score_timeline, created_at, theme_id, distracted_logs')
          .eq('user_id', session.user.id)
          .eq('id', targetPostId)
          .maybeSingle();

        if (targetError) {
          console.error('Failed to load requested analytics session:', targetError);
        } else if (targetPost) {
          resolvedPosts = [...resolvedPosts, targetPost];
        }
      }

      // Keep every session in strict chronological order. The deep-linked
      // target is never promoted; it is only used later for open + scroll.
      resolvedPosts = [...resolvedPosts].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setSessionsData(resolvedPosts);
      setLoading(false);
    };

    fetchAnalytics();
  }, [session, targetPostId]);

  const optimalSession = useMemo(() => computeOptimalSession(sessionsData), [sessionsData]);
  const timeOfDayTrends = useMemo(() => computeTimeOfDayTrends(sessionsData), [sessionsData]);
  const attentionProgression = useMemo(() => computeAttentionProgression(sessionsData), [sessionsData]);
  const tips = useMemo(
    () => generateTips({ optimalSession, timeOfDayTrends, sessions: sessionsData }),
    [optimalSession, timeOfDayTrends, sessionsData]
  );

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

  // Render summaries in the exact chronological order held in sessionsData.
  // targetPostId must NEVER participate in ordering; it only controls which
  // existing accordion opens and gets scrolled into view.
  const summarySessions = sessionsData;

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
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Personalized Insights</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  The easiest steps you can take, based on your current recorded habits, to improve your productivity.
                </p>
              </div>

              <div className="mt-5">
                {tips.map((tip, i) => {
                  const presentation = tipPresentation(tip);
                  const copy = splitTipBody(tip.body);

                  let hero = null;
                  if (tip.title === 'Right-size your sessions' && optimalSession.hasEnoughData) {
                    hero = `${optimalSession.recommendedMinutes} min`;
                  } else if (tip.title === 'Protect your peak hours' && timeOfDayTrends.length > 0) {
                    hero = timeOfDayTrends[0].range;
                  } else if (tip.title === 'Trending upward') {
                    hero = 'Improving';
                  } else if (tip.title === 'Stretch, don’t strain') {
                    hero = 'Recent dip';
                  }

                  return (
                    <article
                      key={`${tip.title}-${i}`}
                      className={`${i === 0 ? '' : 'border-t border-slate-200/80'} py-5`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-slate-900">
                          {tip.title}
                        </h3>

                        {hero && (
                          <span className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                            {hero}
                          </span>
                        )}
                      </div>

                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        {presentation.action}
                      </p>

                      {(copy.insight || copy.detail) && (
                        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">
                          {copy.insight}
                          {copy.detail ? ` ${copy.detail}` : ''}
                        </p>
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

          {/* Session Summaries */}
          <section>
            <div className="flex items-end justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Session Summaries</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Open any session to inspect its attention timeline and distraction log.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {summarySessions.map((sessionData) => {
                const isTarget = String(sessionData.id) === String(targetPostId);
                return (
                  <SessionAccordion
                    key={sessionData.id}
                    sessionData={sessionData}
                    defaultOpen={shouldOpenTarget && isTarget}
                    shouldScroll={shouldOpenTarget && isTarget}
                  />
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}