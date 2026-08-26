import { useState, useRef, useEffect } from 'react';
import { Command } from '@tauri-apps/plugin-shell';
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import ZoneLogo, { ZoneEye } from './ZoneLogo';
import { supabase } from '../lib/supabaseClient';
import { feedCardThemes } from '../feedCardThemes';
import LowDopamineBreak from './LowDopamineBreak';
import { computeOptimalSession } from '../lib/focusAnalytics';

const MINI_SIZE = { width: 280, height: 130 };

const OPTIMAL_BREAKS_STORAGE_PREFIX = 'zone:optimal-breaks:';


function formatActivityTime(totalSeconds) {
  const total = Number(totalSeconds);
  if (!Number.isFinite(total) || total < 0) return '—';

  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function buildSessionActivity(logs, distractionLogs) {
  const items = [];

  const distractionByElapsed = new Map(
    (distractionLogs || []).map((log) => [Number(log.elapsed_seconds), log])
  );

  for (const raw of logs || []) {
    const line = String(raw || '').trim();
    if (!line) continue;

    try {
      if (line.includes('TELEMETRY:')) {
        const payload = JSON.parse(line.split('TELEMETRY:')[1].trim());
        const elapsed = Number(payload.elapsed);

        if (payload.status === 'ON_TASK') {
          items.push({
            key: `focus-${elapsed}-${items.length}`,
            elapsed,
            type: 'focused',
            label: 'Focused',
            detail: 'Activity matched your goal.',
            score: payload.score,
          });
        } else if (payload.status === 'DISTRACTED') {
          const distraction = distractionByElapsed.get(elapsed);
          const sink =
            distraction?.sink && String(distraction.sink).toLowerCase() !== 'n/a'
              ? String(distraction.sink)
              : null;

          items.push({
            key: `distracted-${elapsed}-${items.length}`,
            elapsed,
            type: 'distracted',
            label: 'Distracted',
            detail:
              distraction?.explanation ||
              'Activity did not match your goal.',
            sink,
            score: payload.score,
          });
        }

        continue;
      }

      if (line.includes('AD_NEUTRAL:')) {
        const payload = JSON.parse(line.split('AD_NEUTRAL:')[1].trim());
        items.push({
          key: `ad-${payload.elapsed_seconds}-${items.length}`,
          elapsed: Number(payload.elapsed_seconds),
          type: 'ad',
          label: 'Ad ignored',
          detail: payload.reason || 'A YouTube ad was detected and excluded from your score.',
          score: payload.score,
        });
        continue;
      }

      if (line.includes('NEUTRAL_SAMPLE:')) {
        const payload = JSON.parse(line.split('NEUTRAL_SAMPLE:')[1].trim());
        items.push({
          key: `neutral-${payload.elapsed_seconds}-${items.length}`,
          elapsed: Number(payload.elapsed_seconds),
          type: 'neutral',
          label: 'Unclear',
          detail: payload.reason || 'Zone could not confidently classify this check.',
          score: payload.score,
        });
      }
    } catch {
      // Raw technical output stays available below; malformed debug lines
      // should never break the readable activity timeline.
    }
  }

  return items.sort((a, b) => (a.elapsed || 0) - (b.elapsed || 0));
}


function FocusOverview({ goal, elapsedTime, logs, distractionLogs, focusScore, scoreTimeline, onClose }) {
  const [selectedTheme, setSelectedTheme] = useState(feedCardThemes[0].id);
  const [imageFile, setImageFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingType, setSubmittingType] = useState(null); // 'public' | 'private' | null
  const [error, setError] = useState('');
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const formatTime = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const activityItems = buildSessionActivity(logs, distractionLogs);
  const focusedChecks = activityItems.filter((item) => item.type === 'focused').length;
  const distractedChecks = activityItems.filter((item) => item.type === 'distracted').length;
  const ignoredAds = activityItems.filter((item) => item.type === 'ad').length;

  const handleSaveSession = async (isPrivate = false) => {
    setIsSubmitting(true);
    setSubmittingType(isPrivate ? 'private' : 'public');
    setError('');
    let imageUrl = null;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be logged in to save your session.");

      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `${session.user.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('feed_images') 
          .upload(filePath, imageFile);

        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from('feed_images').getPublicUrl(filePath);
        imageUrl = data.publicUrl;
      }

      const { error: insertError } = await supabase.from('feed_posts').insert({
        user_id: session.user.id,
        title: goal,
        task_name: goal, // Added for Pro Analytics compatibility
        time_elapsed: formatTime(elapsedTime),
        focus_score: focusScore,
        score_timeline: scoreTimeline, // Injects the telemetry data here
        theme_id: selectedTheme,
        bg_image: imageUrl,
        logs: logs.join('\n'),
        distracted_logs: distractionLogs,
        is_private: isPrivate,
      });

      if (insertError) throw insertError;

      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
      setSubmittingType(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900 text-white flex flex-col z-50 overflow-y-auto p-10">
      <div className="max-w-3xl mx-auto w-full bg-[#1E293B] rounded-md p-8 shadow-2xl border border-[rgba(255,255,255,0.1)]">
        <h2 className="text-3xl font-bold mb-6">Session Complete</h2>
        
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="bg-slate-900 p-6 rounded-md border border-[rgba(255,255,255,0.05)]">
            <p className="text-xs uppercase tracking-[0.1em] text-[rgba(255,255,255,0.6)] mb-2">Time Elapsed</p>
            <p className="text-4xl font-semibold">{formatTime(elapsedTime)}</p>
          </div>
          <div className="bg-slate-900 p-6 rounded-md border border-[rgba(255,255,255,0.05)]">
            <p className="text-xs uppercase tracking-[0.1em] text-[rgba(255,255,255,0.6)] mb-2">Focus Score</p>
            <p className="text-4xl font-semibold text-indigo-400">{focusScore}</p>
          </div>
        </div>

        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.1em] text-[rgba(255,255,255,0.6)] mb-4">Choose Card Theme</p>
          <div className="flex gap-4 flex-wrap">
            {feedCardThemes.map((theme) => (
              <button
                key={theme.id}
                onClick={() => setSelectedTheme(theme.id)}
                className={`w-12 h-12 rounded-full border-2 transition-transform cursor-pointer active:scale-95 ${selectedTheme === theme.id ? 'border-white scale-110 outline outline-2 outline-offset-2 outline-indigo-400' : 'border-transparent hover:scale-105'}`}
                style={{ background: theme.gradient }}
                title={theme.name}
              />
            ))}
          </div>
        </div>

        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.1em] text-[rgba(255,255,255,0.6)] mb-4">Add a Photo (Optional)</p>
          <input 
            type="file" 
            accept="image/*"
            onChange={(e) => setImageFile(e.target.files[0])}
            className="block w-full text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-500/20 file:text-indigo-300 hover:file:bg-indigo-500/30 cursor-pointer"
          />
        </div>

        <div className="mb-10">
          <div className="flex items-end justify-between gap-4 mb-3">
            <div>
              <p className="text-xs uppercase tracking-[0.1em] text-[rgba(255,255,255,0.6)]">Session Activity</p>
              <p className="text-xs text-slate-400 mt-1">A simple timeline of what Zone detected.</p>
            </div>

            {activityItems.length > 0 && (
              <span className="text-[11px] font-medium text-slate-400">
                {activityItems.length} check{activityItems.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {activityItems.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-white/10 bg-slate-900/55">
              <div className="flex items-center gap-4 border-b border-white/10 px-4 py-2.5 text-[11px] text-slate-400">
                <span>{focusedChecks} focused</span>
                <span>{distractedChecks} distracted</span>
                {ignoredAds > 0 && <span>{ignoredAds} ad{ignoredAds === 1 ? '' : 's'} ignored</span>}
              </div>

              <div className="max-h-64 overflow-y-auto">
                {activityItems.map((item, index) => {
                  const statusClasses = {
                    focused: 'bg-emerald-400 text-emerald-300',
                    distracted: 'bg-rose-400 text-rose-300',
                    ad: 'bg-amber-300 text-amber-200',
                    neutral: 'bg-slate-400 text-slate-300',
                  };

                  const statusClass = statusClasses[item.type] || statusClasses.neutral;
                  const [dotClass, textClass] = statusClass.split(' ');

                  return (
                    <div
                      key={item.key}
                      className={`flex gap-3 px-4 py-3 ${
                        index === 0 ? '' : 'border-t border-white/[0.07]'
                      }`}
                    >
                      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${textClass}`}>{item.label}</span>
                          {item.sink && (
                            <span className="rounded-sm border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                              {item.sink}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs leading-5 text-slate-400">{item.detail}</p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-xs font-medium tabular-nums text-slate-300">
                          {formatActivityTime(item.elapsed)}
                        </p>
                        {item.score !== undefined && (
                          <p className="mt-0.5 text-[10px] text-slate-500">score {item.score}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-white/10 bg-slate-900/55 px-4 py-5 text-sm text-slate-400">
              No activity checks were captured.
            </div>
          )}

          {logs.length > 0 && (
            <details className="mt-3 group">
              <summary className="w-fit cursor-pointer select-none text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-300">
                Technical logs
              </summary>
              <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-white/[0.08] bg-black/25 p-3 font-mono text-[10px] leading-5 text-slate-500">
                {logs.map((log, i) => (
                  <div key={i} className="break-words">{log}</div>
                ))}
              </div>
            </details>
          )}
        </div>

        {error && <p className="text-[#E11D48] mb-4">{error}</p>}

        <div className="flex justify-end gap-3 items-center flex-wrap">
          {confirmingDiscard ? (
            <div className="bg-slate-900/95 border border-white/20 p-2.5 rounded-md shadow-sm flex items-center gap-2 backdrop-blur-md animate-in fade-in zoom-in duration-150">
              <span className="text-xs text-white font-medium pl-1">Discard session?</span>
              <button
                onClick={onClose}
                className="bg-rose-600 hover:bg-rose-500 text-white text-xs px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmingDiscard(false)}
                className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer"
              >
                No
              </button>
            </div>
          ) : (
            <button 
              onClick={() => setConfirmingDiscard(true)}
              className="px-5 py-3 rounded-md font-semibold text-white bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.15)] transition-colors cursor-pointer"
            >
              Discard
            </button>
          )}

          {/* Save Privately Button */}
          <button 
            onClick={() => handleSaveSession(true)}
            disabled={isSubmitting}
            className="px-5 py-3 rounded-md font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-2"
            title="Save session to your profile without posting to the public feed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {isSubmitting && submittingType === 'private' ? 'Saving...' : 'Save Privately'}
          </button>

          {/* Publish Publicly Button */}
          <button 
            onClick={() => handleSaveSession(false)}
            disabled={isSubmitting}
            className="px-6 py-3 rounded-md font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors shadow-lg shadow-indigo-900/20 cursor-pointer"
          >
            {isSubmitting && submittingType === 'public' ? 'Publishing...' : 'Publish to Feed'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FocusSession({ onStopFocus }) {
  const [goal, setGoal] = useState(() => {
    try {
      const pendingGoal = sessionStorage.getItem('zone:pending-focus-goal') || '';
      if (pendingGoal) {
        sessionStorage.removeItem('zone:pending-focus-goal');
      }
      return pendingGoal;
    } catch (err) {
      console.warn('Could not load pinned task into FocusSession:', err);
      return '';
    }
  });
  const [savedEvents, setSavedEvents] = useState([]);
  const [intendedTime, setIntendedTime] = useState('25');
  const [showTooltip, setShowTooltip] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const [isMini, setIsMini] = useState(false);
  
  const [elapsedTime, setElapsedTime] = useState(0);

  const [isCompleted, setIsCompleted] = useState(false);
  const [logs, setLogs] = useState([]);
  const [distractionLogs, setDistractionLogs] = useState([]);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [focusScore, setFocusScore] = useState(0);
  
  // Array to capture time-series telemetry data for the Pro Dashboard
  const [scoreTimeline, setScoreTimeline] = useState([]);

  // Pro-only: a personalized session-length recommendation derived from
  // past sessions (see computeOptimalSession in lib/focusAnalytics), used
  // to default the "Intended time" picker and to power the in-session
  // nudge below. Never forces anything — see nudge state further down.
  const [optimalSession, setOptimalSession] = useState({ hasEnoughData: false });
  const hasManuallySetTime = useRef(false); // don't clobber a user's own choice

  // Optional algorithm-timed breaks. Analytics stores the user's preference;
  // when a focus session begins we snapshot both the preference and the current
  // recommendation so the threshold cannot move mid-session.
  const [optimalBreaksEnabled, setOptimalBreaksEnabled] = useState(false);
  const [showBreak, setShowBreak] = useState(false);
  const [breakIntervalSeconds, setBreakIntervalSeconds] = useState(null);
  const [focusBlockElapsed, setFocusBlockElapsed] = useState(0);

  const breakIntervalSecondsRef = useRef(null);
  const focusBlockStartRef = useRef(null);
  const isBreakActiveRef = useRef(false);

  const childRef = useRef(null);
  const savedWindowState = useRef(null);
  const timerRef = useRef(null);
  const finalScoreResolverRef = useRef(null);
  // Real wall-clock start time (ms). setInterval only counts ticks, and
  // ticks get throttled or fully paused by full-screen video, a
  // backgrounded window, and especially system sleep — the sidecar keeps
  // tracking on a real OS clock the whole time, so the displayed timer
  // needs to be derived from a real timestamp too, not from counting
  // ticks, or it silently falls behind.
  const sessionStartRef = useRef(null);

  useEffect(() => {
    return () => {
      childRef.current?.kill().catch(() => {});
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // The interval itself is what makes the timer self-correct on every
  // tick, but ticks don't fire at all while the machine is asleep — so
  // the number on screen can sit stale until the next natural 1s tick
  // lands after waking. Recomputing immediately on visibility/focus
  // return closes that last gap.
  useEffect(() => {
    const resync = () => {
      if (sessionStartRef.current == null) return;

      const now = Date.now();
      setElapsedTime(Math.floor((now - sessionStartRef.current) / 1000));

      if (!isBreakActiveRef.current && focusBlockStartRef.current != null) {
        setFocusBlockElapsed(Math.floor((now - focusBlockStartRef.current) / 1000));
      }
    };

    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    return () => {
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
    };
  }, []);

  useEffect(() => {
    const loadSavedEvents = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error: fetchError } = await supabase
        .from('upcoming_events')
        .select('id, title')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('Error fetching upcoming events:', fetchError);
      } else {
        setSavedEvents(data || []);
      }
    };

    loadSavedEvents();
  }, []);

  useEffect(() => {
    const loadRecommendation = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_pro, optimal_breaks_enabled')
        .eq('user_id', session.user.id)
        .single();

      if (!profile?.is_pro) return;

      setOptimalBreaksEnabled(Boolean(profile.optimal_breaks_enabled));

      const { data: posts, error: postsError } = await supabase
        .from('feed_posts')
        .select('score_timeline, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (postsError || !posts) return;

      const recommendation = computeOptimalSession(posts);
      setOptimalSession(recommendation);

      // Only prefill — never override a length the user already picked.
      if (recommendation.hasEnoughData && !hasManuallySetTime.current) {
        setIntendedTime(String(recommendation.recommendedMinutes));
      }
    };

    loadRecommendation();
  }, []);

  const formatTime = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleSubmitGoal = async (e) => {
    e.preventDefault();
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) return;

    try {
      const command = Command.sidecar('bin/backend');
      
      command.stdout.on('data', (line) => {
        setLogs((prev) => [...prev, line]);

        if (line.includes('DISTRACTION_LOG:')) {
          try {
            const jsonString = line.split('DISTRACTION_LOG:')[1].trim();
            const distraction = JSON.parse(jsonString);
            const normalizedSink =
              typeof distraction?.sink === 'string' && distraction.sink.trim()
                ? distraction.sink.trim()
                : 'n/a';

            setDistractionLogs((prev) => [
              ...prev,
              { ...distraction, sink: normalizedSink },
            ]);
          } catch (err) {
            console.error('Failed to parse distraction log:', err);
          }
        }

        // Catch the new telemetry output and save it to our state array
        if (line.includes('TELEMETRY:')) {
          try {
            const jsonString = line.split('TELEMETRY:')[1].trim();
            const point = JSON.parse(jsonString);
            
            setScoreTimeline((prev) => [...prev, point]);
            
            // Keep the live score updated
            if (point.score !== undefined) {
              setFocusScore(point.score);
            }
          } catch (err) {
            console.error("Failed to parse telemetry:", err);
          }
        }

        if (line.includes('CURRENT_SCORE:')) {
          const score = parseInt(line.split(':')[1].trim(), 10);
          if (!isNaN(score)) setFocusScore(score);
        }

        if (line.includes('FINAL_SCORE:')) {
          const score = parseInt(line.split(':')[1].trim(), 10);
          if (!isNaN(score)) {
            setFocusScore(score);
            finalScoreResolverRef.current?.(score);
            finalScoreResolverRef.current = null;
          }
        }
      });

      const child = await command.spawn();
      childRef.current = child;

      await child.write(`${trimmedGoal}\n`);

      setSubmitted(true);
      setElapsedTime(0);

      const now = Date.now();
      sessionStartRef.current = now;
      focusBlockStartRef.current = now;
      isBreakActiveRef.current = false;
      setFocusBlockElapsed(0);

      const snappedBreakInterval =
        optimalBreaksEnabled && optimalSession.hasEnoughData
          ? optimalSession.recommendedMinutes * 60
          : null;

      breakIntervalSecondsRef.current = snappedBreakInterval;
      setBreakIntervalSeconds(snappedBreakInterval);

      timerRef.current = setInterval(() => {
        // Total session time remains one continuous wall-clock session.
        const current = Date.now();
        setElapsedTime(Math.floor((current - sessionStartRef.current) / 1000));

        // Break eligibility uses only the current focus block. During a break
        // this clock freezes; after RESUME it starts again from zero.
        if (!isBreakActiveRef.current && focusBlockStartRef.current != null) {
          setFocusBlockElapsed(
            Math.floor((current - focusBlockStartRef.current) / 1000)
          );
        }
      }, 1000);

    } catch (err) {
      console.error('Failed to start focus tracker:', err);
      setError('Could not start the focus tracker. Check the logs.');
    }
  };

  const handleStartOptimalBreak = async () => {
    const interval = breakIntervalSecondsRef.current;
    if (!childRef.current || !interval || focusBlockElapsed < interval || isBreakActiveRef.current) {
      return;
    }

    try {
      // Keep the same process alive so the sidecar retains its score counters,
      // caches, and prior session context. It simply stops capturing frames.
      await childRef.current.write('PAUSE\n');
      isBreakActiveRef.current = true;

      if (isMini) {
        await exitMiniMode();
      }

      setShowBreak(true);
    } catch (err) {
      console.error('Failed to pause focus tracker for break:', err);
      setError('Could not pause tracking for the break.');
    }
  };

  const handleFinishOptimalBreak = async () => {
    try {
      await childRef.current?.write('RESUME\n');
    } catch (err) {
      console.error('Failed to resume focus tracker after break:', err);
      setError('Could not resume tracking after the break.');
    } finally {
      isBreakActiveRef.current = false;
      focusBlockStartRef.current = Date.now();
      setFocusBlockElapsed(0);
      setShowBreak(false);
    }
  };

  const handleStop = async () => {
    try {
      const finalScorePromise = new Promise((resolve) => {
        finalScoreResolverRef.current = resolve;
      });

      await childRef.current?.write('STOP\n');

      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 15000));
      const result = await Promise.race([finalScorePromise, timeoutPromise]);

      if (result === null) {
        console.warn('Sidecar did not report FINAL_SCORE in time — forcing kill.');
        await childRef.current?.kill().catch(() => {});
      }
    } catch (err) {
      console.error('Failed to stop focus tracker:', err);
    } finally {
      finalScoreResolverRef.current = null;
      childRef.current = null;
      isBreakActiveRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (isMini) await exitMiniMode();
      setIsCompleted(true);
    }
  };

  const handleClose = async () => {
    if (childRef.current) {
      await handleStop();
    } else {
      if (isMini) await exitMiniMode();
      onStopFocus();
    }
  };

  const enterMiniMode = async () => {
    if (!submitted) return;
    const win = getCurrentWindow();
    try {
      const [size, position] = await Promise.all([win.outerSize(), win.outerPosition()]);
      savedWindowState.current = { size, position };

      await win.setResizable(false);
      await win.setSize(new LogicalSize(MINI_SIZE.width, MINI_SIZE.height));

      const monitor = await currentMonitor();
      if (monitor) {
        const { width: screenW, height: screenH } = monitor.size;
        const scale = monitor.scaleFactor || 1;
        
        await win.setPosition(
          new LogicalPosition(
            (screenW / scale - MINI_SIZE.width) / 2,
            (screenH / scale - MINI_SIZE.height) / 2
          )
        );
      }

      await win.setAlwaysOnTop(true);
      setIsMini(true);
    } catch (err) {
      console.error('Failed to enter mini mode:', err);
    }
  };

  const exitMiniMode = async () => {
    const win = getCurrentWindow();
    try {
      await win.setAlwaysOnTop(false);
      await win.setResizable(true);

      if (savedWindowState.current) {
        await win.setSize(savedWindowState.current.size);
        await win.setPosition(savedWindowState.current.position);
      }
      setIsMini(false);
    } catch (err) {
      console.error('Failed to exit mini mode:', err);
    }
  };

  const toggleMiniMode = () => {
    isMini ? exitMiniMode() : enterMiniMode();
  };

  if (isCompleted) {
    return (
      <FocusOverview 
        goal={goal}
        elapsedTime={elapsedTime}
        logs={logs}
        distractionLogs={distractionLogs}
        focusScore={focusScore}
        scoreTimeline={scoreTimeline} // Passing the telemetry data down to the save function
        onClose={onStopFocus}
      />
    );
  }

  const hasIntendedTime = intendedTime !== 'none';
  const totalSecondsIntended = hasIntendedTime ? parseInt(intendedTime, 10) * 60 : 0;
  const progressPercent = hasIntendedTime && totalSecondsIntended > 0 
    ? Math.min(100, (elapsedTime / totalSecondsIntended) * 100) 
    : 0;

  const breakAvailable =
    Boolean(breakIntervalSeconds) && focusBlockElapsed >= breakIntervalSeconds;
  const secondsUntilBreak = breakIntervalSeconds
    ? Math.max(0, breakIntervalSeconds - focusBlockElapsed)
    : 0;

  return (
    <div className="fixed inset-0 bg-slate-900 text-white flex flex-col z-50 select-none overflow-hidden">
      {!isMini && (
        <div className="relative flex items-center justify-between w-full h-[56px] px-[20px] shrink-0 z-10">
          <div className="flex items-center">
            {submitted ? (
              <button
                onClick={toggleMiniMode}
                className="text-[rgba(255,255,255,0.75)] hover:text-white hover:bg-white/10 rounded-md p-[10px] -ml-[10px] transition-colors cursor-pointer flex items-center justify-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            ) : (
              <div className="w-[20px]" />
            )}
          </div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center pointer-events-none">
            <ZoneLogo animated={false} size={20} />
          </div>
          <div className="flex items-center">
            {confirmingClose ? (
              <div className="bg-slate-900/95 border border-white/20 p-2.5 rounded-md shadow-sm flex items-center gap-2 backdrop-blur-md animate-in fade-in zoom-in duration-150">
                <span className="text-xs text-white font-medium pl-1">End session?</span>
                <button
                  onClick={handleClose}
                  className="bg-rose-600 hover:bg-rose-500 text-white text-xs px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer"
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmingClose(false)}
                  className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingClose(true)}
                className="text-[rgba(255,255,255,0.75)] hover:text-white hover:bg-white/10 rounded-md p-[10px] -mr-[10px] transition-colors cursor-pointer flex items-center justify-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`flex-1 flex w-full ${isMini ? 'px-3 py-2.5 flex-col justify-center' : 'flex-col items-center px-[24px]'}`}>
        {!submitted ? (
          <div className="flex flex-col items-center w-full max-w-[440px] mx-auto my-auto">
            <form onSubmit={handleSubmitGoal} className="w-full flex flex-col items-start">
              <label className="text-[17px] font-medium text-[rgba(255,255,255,0.85)] mb-[20px]">
                What's your goal for this session?
              </label>
              <input
                type="text"
                autoFocus
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Solving linear algebra problems."
                className="w-full h-[48px] px-[16px] rounded-md bg-[#1E293B] border-[1.5px] border-[rgba(255,255,255,0.12)] text-white text-[15px] placeholder:text-[rgba(255,255,255,0.35)] focus:outline-none focus:border-[rgba(99,102,241,0.6)] transition-colors mb-[20px]"
              />

              {savedEvents.length > 0 && (
                <div className="mb-[20px] -mt-2 w-full">
                  <p className="mb-2 text-[11px] font-medium text-[rgba(255,255,255,0.42)]">
                    From your Pinned Tasks — tasks you saved for quick access.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {savedEvents.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => setGoal(ev.title)}
                        className="text-xs px-3 py-1.5 rounded-md bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.12)] border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.75)] hover:text-white transition-colors cursor-pointer"
                      >
                        {ev.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-[10px] mb-[28px] relative w-full">
                <span className="text-[14px] text-[rgba(255,255,255,0.6)]">Intended time</span>
                
                <select
                  value={intendedTime === 'custom' || !['25','45','60','90','none'].includes(intendedTime) ? 'custom' : intendedTime}
                  onChange={(e) => {
                    hasManuallySetTime.current = true;
                    if (e.target.value === 'custom') {
                      setIntendedTime('30');
                    } else {
                      setIntendedTime(e.target.value);
                    }
                  }}
                  className="bg-[#1E293B] border border-[rgba(255,255,255,0.12)] text-white text-xs rounded-md px-2 py-1.5 focus:outline-none focus:border-[rgba(99,102,241,0.6)] cursor-pointer"
                >
                  <option value="25">25 min</option>
                  <option value="45">45 min</option>
                  <option value="60">60 min</option>
                  <option value="90">90 min</option>
                  <option value="custom">Custom</option>
                  <option value="none">None</option>
                </select>

                {(intendedTime === 'custom' || !['25','45','60','90','none'].includes(intendedTime)) && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="1"
                      max="999"
                      value={intendedTime === 'custom' ? '30' : intendedTime}
                      onChange={(e) => {
                        hasManuallySetTime.current = true;
                        const val = e.target.value;
                        if (val === '' || parseInt(val) > 0) {
                          setIntendedTime(val || '1');
                        }
                      }}
                      className="w-14 h-[30px] px-2 rounded-md bg-[#1E293B] border border-[rgba(255,255,255,0.12)] text-white text-xs focus:outline-none focus:border-[rgba(99,102,241,0.6)]"
                    />
                    <span className="text-[13px] text-[rgba(255,255,255,0.5)]">min</span>
                  </div>
                )}

                <div 
                  className="relative flex items-center cursor-pointer text-[rgba(255,255,255,0.6)] hover:text-white"
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                >
                  <span className="text-[14px]">ⓘ</span>
                  {showTooltip && (
                    <div className="absolute left-6 bottom-0 w-64 p-2.5 bg-slate-800 text-slate-200 text-xs rounded-md shadow-xl border border-slate-700 z-50">
                      Zone won’t stop you from doing more work. This is just a helpful indicator.
                    </div>
                  )}
                </div>
              </div>
              {optimalSession.hasEnoughData && !hasManuallySetTime.current && (
                <p className="text-xs text-[rgba(255,255,255,0.4)] -mt-4 mb-6">
                  Set to your recommended {optimalSession.recommendedMinutes} min, based on your past sessions.
                </p>
              )}
              {error && <p className="text-[#E11D48] text-sm mb-4">{error}</p>}
              <button
                type="submit"
                disabled={!goal.trim()}
                className="w-full h-[48px] px-[32px] bg-[#E11D48] hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all text-white text-[16px] font-semibold rounded-md shadow-lg shadow-rose-900/20 active:scale-[0.98] flex items-center justify-center"
              >
                Start Tracking
              </button>
            </form>
          </div>
        ) : isMini ? (
          <div className="flex flex-col w-full h-full justify-center">
            <div className="flex items-center w-full gap-2.5">
              <div className="shrink-0">
                <ZoneEye animated={true} size={22} />
              </div>
              <div className="text-[26px] font-bold text-white tracking-tight tabular-nums leading-none shrink-0">
                {formatTime(elapsedTime)}
              </div>
              <div className="text-[13px] font-medium text-[rgba(255,255,255,0.55)] truncate min-w-0" title={goal}>
                {goal}
              </div>
              <button
                onClick={toggleMiniMode}
                className="ml-auto text-[rgba(255,255,255,0.6)] hover:text-white hover:bg-white/10 rounded-md p-1.5 transition-all cursor-pointer shrink-0 flex items-center justify-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            </div>
            {hasIntendedTime && (
              <div className="w-full bg-[rgba(255,255,255,0.10)] h-[3.5px] rounded-full overflow-hidden mt-2.5 shrink-0">
                <div className="bg-indigo-400/90 h-full transition-all duration-500 ease-linear rounded-full" style={{ width: `${progressPercent}%` }} />
              </div>
            )}

            {breakIntervalSeconds && (
              <button
                type="button"
                onClick={handleStartOptimalBreak}
                disabled={!breakAvailable}
                className="mt-2 w-full h-[25px] rounded-md border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.08)] text-[10px] font-semibold text-[rgba(255,255,255,0.80)] hover:bg-[rgba(255,255,255,0.12)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {breakAvailable ? 'Take 5 min break' : `Break in ${formatTime(secondsUntilBreak)}`}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center w-full max-w-lg mx-auto my-auto">
            <div className="text-[64px] font-bold text-white tracking-[-0.02em] tabular-nums leading-none">
              {formatTime(elapsedTime)}
            </div>
            {hasIntendedTime && (
              <div className="w-[220px] bg-[rgba(255,255,255,0.08)] h-[4px] rounded-full overflow-hidden mt-[16px]">
                <div className="bg-indigo-400 h-full transition-all duration-500 ease-linear" style={{ width: `${progressPercent}%` }} />
              </div>
            )}
            <div className={`${hasIntendedTime ? 'h-[12px]' : 'h-[16px]'}`} />
            <div className="text-[15px] font-medium text-[rgba(255,255,255,0.65)] max-w-[260px] truncate text-center" title={goal}>
              {goal}
            </div>
            <div className="h-[28px]" />

            {breakIntervalSeconds && (
              <button
                type="button"
                onClick={handleStartOptimalBreak}
                disabled={!breakAvailable}
                className="h-[42px] min-w-[220px] px-[24px] rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.08)] text-sm font-semibold text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.12)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {breakAvailable ? 'Take 5 min break' : `Break in ${formatTime(secondsUntilBreak)}`}
              </button>
            )}

            <div className={breakIntervalSeconds ? 'h-[12px]' : 'h-[20px]'} />
            <button
              onClick={handleStop}
              className="h-[48px] min-w-[220px] px-[32px] bg-[#E11D48] hover:bg-rose-600 text-white text-[16px] font-semibold rounded-md shadow-lg shadow-rose-900/20 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
            >
              End Focus Session
            </button>
          </div>
        )}
      </div>

      {showBreak && (
        <LowDopamineBreak
          durationSeconds={5 * 60}
          onComplete={handleFinishOptimalBreak}
          onSkip={handleFinishOptimalBreak}
        />
      )}
    </div>
  );
}