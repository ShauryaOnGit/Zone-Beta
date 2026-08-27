import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { feedCardThemes } from '../feedCardThemes';
import { computeFairScore } from '../lib/focusAnalytics';

function scoreToCoverOpacity(score) {
  const clamped = Math.max(0, Math.min(100, score));
  const inverted = (100 - clamped) / 100;
  return inverted * 0.82;
}

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

export function History({ session }) {
  const location = useLocation();
  const targetPostId = location.state?.targetPostId ?? null;
  const [sessionsData, setSessionsData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user?.id) {
      setSessionsData([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchHistory = async () => {
      setLoading(true);

      const { data: posts, error: postsError } = await supabase
        .from('feed_posts')
        .select('id, task_name, focus_score, time_elapsed, score_timeline, created_at, theme_id, distracted_logs')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (postsError) {
        console.error('Failed to load session history:', postsError);
        if (!cancelled) {
          setSessionsData([]);
          setLoading(false);
        }
        return;
      }

      let resolvedPosts = posts || [];

      if (
        targetPostId &&
        !resolvedPosts.some((post) => String(post.id) === String(targetPostId))
      ) {
        const { data: targetPost, error: targetError } = await supabase
          .from('feed_posts')
          .select('id, task_name, focus_score, time_elapsed, score_timeline, created_at, theme_id, distracted_logs')
          .eq('user_id', session.user.id)
          .eq('id', targetPostId)
          .maybeSingle();

        if (targetError) {
          console.error('Failed to load requested history session:', targetError);
        } else if (targetPost) {
          resolvedPosts = [...resolvedPosts, targetPost];
        }
      }

      resolvedPosts = [...resolvedPosts].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      if (!cancelled) {
        setSessionsData(resolvedPosts);
        setLoading(false);
      }
    };

    fetchHistory();

    return () => {
      cancelled = true;
    };
  }, [session, targetPostId]);

  if (loading) {
    return (
      <div className="bg-white rounded-sm border border-slate-200 p-6 shadow-sm">
        <p className="text-sm text-slate-500">Loading history...</p>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="mb-8">
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">History</h1>
        <p className="mt-2 text-sm text-slate-500">
          Review your past focus sessions, attention timelines, and distraction logs.
        </p>
      </div>

      {sessionsData.length === 0 ? (
        <div className="rounded-sm border border-[#D0D7DE] bg-slate-50 p-6 shadow-sm">
          <p className="text-sm text-slate-500">Complete a focus session to build your history.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sessionsData.map((sessionData) => {
            const isTarget = String(sessionData.id) === String(targetPostId);

            return (
              <SessionAccordion
                key={sessionData.id}
                sessionData={sessionData}
                defaultOpen={Boolean(targetPostId) && isTarget}
                shouldScroll={Boolean(targetPostId) && isTarget}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
