// components/FocusSession.jsx
import { useState, useRef, useEffect } from 'react';
import { Command } from '@tauri-apps/plugin-shell';
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import ZoneLogo, { ZoneEye } from './ZoneLogo';
import { supabase } from '../lib/supabaseClient';
import { feedCardThemes } from '../feedCardThemes';

const MINI_SIZE = { width: 280, height: 110 }; 

function FocusOverview({ goal, elapsedTime, logs, focusScore, onClose }) {
  const [selectedTheme, setSelectedTheme] = useState(feedCardThemes[0].id);
  const [imageFile, setImageFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const formatTime = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handlePublish = async () => {
    setIsSubmitting(true);
    setError('');
    let imageUrl = null;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be logged in to post.");

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
        time_elapsed: formatTime(elapsedTime),
        focus_score: focusScore,
        theme_id: selectedTheme,
        bg_image: imageUrl,
        logs: logs.join('\n'),
      });

      if (insertError) throw insertError;

      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0F172A] text-white flex flex-col z-50 overflow-y-auto p-10">
      <div className="max-w-3xl mx-auto w-full bg-[#1E293B] rounded-md p-8 shadow-2xl border border-[rgba(255,255,255,0.1)]">
        <h2 className="text-3xl font-bold mb-6">Session Complete</h2>
        
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="bg-[#0F172A] p-6 rounded-md border border-[rgba(255,255,255,0.05)]">
            <p className="text-xs uppercase tracking-[0.1em] text-[rgba(255,255,255,0.6)] mb-2">Time Elapsed</p>
            <p className="text-4xl font-semibold">{formatTime(elapsedTime)}</p>
          </div>
          <div className="bg-[#0F172A] p-6 rounded-md border border-[rgba(255,255,255,0.05)]">
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
          <p className="text-xs uppercase tracking-[0.1em] text-[rgba(255,255,255,0.6)] mb-4">Activity Logs</p>
          <div className="bg-black/50 p-4 rounded-md h-48 overflow-y-auto font-mono text-xs text-green-400 border border-[rgba(255,255,255,0.05)]">
            {logs.length > 0 ? logs.map((log, i) => <div key={i}>{log}</div>) : <div className="text-slate-500">No logs captured.</div>}
          </div>
        </div>

        {error && <p className="text-[#E11D48] mb-4">{error}</p>}

        <div className="flex justify-end gap-4 items-center">
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
              className="px-6 py-3 rounded-md font-semibold text-white bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.15)] transition-colors cursor-pointer"
            >
              Discard
            </button>
          )}
          <button 
            onClick={handlePublish}
            disabled={isSubmitting}
            className="px-6 py-3 rounded-md font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors shadow-lg shadow-indigo-900/20 cursor-pointer"
          >
            {isSubmitting ? 'Publishing...' : 'Publish to Feed'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FocusSession({ onStopFocus }) {
  const [goal, setGoal] = useState('');
  const [savedEvents, setSavedEvents] = useState([]);
  const [intendedTime, setIntendedTime] = useState('25');
  const [showTooltip, setShowTooltip] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const [isMini, setIsMini] = useState(false);
  
  const [elapsedTime, setElapsedTime] = useState(0);

  const [isCompleted, setIsCompleted] = useState(false);
  const [logs, setLogs] = useState([]);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [focusScore, setFocusScore] = useState(0);
  
  const childRef = useRef(null);
  const savedWindowState = useRef(null);
  const timerRef = useRef(null);
  const finalScoreResolverRef = useRef(null);

  useEffect(() => {
    return () => {
      childRef.current?.kill().catch(() => {});
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Fetch the user's saved "upcoming events" so they can be offered as
  // quick-select prompts instead of retyping the same goal every time.
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
      timerRef.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Failed to start focus tracker:', err);
      setError('Could not start the focus tracker. Check the logs.');
    }
  };

  const handleStop = async () => {
    try {
      // Ask the sidecar to stop cooperatively so it can finish its current
      // loop iteration and print FINAL_SCORE before exiting. A hard
      // child.kill() (especially on Windows) terminates the process
      // immediately and skips Python's atexit hook entirely, so FINAL_SCORE
      // would never be printed at all.
      const finalScorePromise = new Promise((resolve) => {
        finalScoreResolverRef.current = resolve;
      });

      await childRef.current?.write('STOP\n');

      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 15000));
      const result = await Promise.race([finalScorePromise, timeoutPromise]);

      // If the sidecar didn't wind down on its own in time, force it closed
      // as a fallback so we don't leave a zombie process running.
      if (result === null) {
        console.warn('Sidecar did not report FINAL_SCORE in time — forcing kill.');
        await childRef.current?.kill().catch(() => {});
      }
    } catch (err) {
      console.error('Failed to stop focus tracker:', err);
    } finally {
      finalScoreResolverRef.current = null;
      childRef.current = null;
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
        focusScore={focusScore}
        onClose={onStopFocus}
      />
    );
  }

  const hasIntendedTime = intendedTime !== 'none';
  const totalSecondsIntended = hasIntendedTime ? parseInt(intendedTime, 10) * 60 : 0;
  const progressPercent = hasIntendedTime && totalSecondsIntended > 0 
    ? Math.min(100, (elapsedTime / totalSecondsIntended) * 100) 
    : 0;

  return (
    <div className="fixed inset-0 bg-[#0F172A] text-white flex flex-col z-50 select-none overflow-hidden">
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
                <div className="flex flex-wrap gap-2 mb-[20px] -mt-2 w-full">
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
              )}

              <div className="flex items-center gap-[10px] mb-[28px] relative w-full">
                <span className="text-[14px] text-[rgba(255,255,255,0.6)]">Intended time</span>
                
                <select
                  value={intendedTime === 'custom' || !['25','45','60','90','none'].includes(intendedTime) ? 'custom' : intendedTime}
                  onChange={(e) => {
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
            <div className="h-[48px]" />
            <button
              onClick={handleStop}
              className="h-[48px] min-w-[220px] px-[32px] bg-[#E11D48] hover:bg-rose-600 text-white text-[16px] font-semibold rounded-md shadow-lg shadow-rose-900/20 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
            >
              End Focus Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}