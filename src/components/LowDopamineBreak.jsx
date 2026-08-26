// src/components/LowDopamineBreak.jsx
//
// A minimal, slow-moving breathing animation with a countdown. Extracted
// out of Analytics.jsx (where it's used for the manual "Take a break"
// button) so FocusSession.jsx can also offer it as an OPTIONAL break
// during an active session, without duplicating the component.
//
// This is always opt-in — nothing auto-launches this screen. See the
// nudge banner in FocusSession.jsx for why.
import { useState, useEffect, useRef } from 'react';

export default function LowDopamineBreak({ durationSeconds = 300, onComplete, onSkip }) {
  const [remaining, setRemaining] = useState(durationSeconds);
  const [phase, setPhase] = useState('in'); // 'in' | 'out'
  const finishedRef = useRef(false);

  useEffect(() => {
    const tick = setInterval(() => {
      setRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (remaining > 0 || finishedRef.current) return;
    finishedRef.current = true;
    onComplete?.();
  }, [remaining, onComplete]);

  useEffect(() => {
    // ~4s inhale, ~4s exhale, matches the CSS animation duration below
    const breath = setInterval(() => {
      setPhase((p) => (p === 'in' ? 'out' : 'in'));
    }, 4000);
    return () => clearInterval(breath);
  }, []);

  const shortenBreak = (seconds) => {
    setRemaining((prev) => Math.max(0, prev - seconds));
  };

  const endBreak = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    if (onSkip) {
      onSkip();
    } else {
      onComplete?.();
    }
  };

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col items-center justify-center text-white select-none">
      <style>{`
        @keyframes zoneBreathe {
          0%   { transform: scale(0.72); opacity: 0.55; }
          50%  { transform: scale(1);    opacity: 0.9; }
          100% { transform: scale(0.72); opacity: 0.55; }
        }
      `}</style>

      <div
        className="w-40 h-40 rounded-full bg-indigo-500/30 border border-indigo-400/40"
        style={{ animation: 'zoneBreathe 8s ease-in-out infinite' }}
      />

      <p className="mt-10 text-sm tracking-[0.2em] uppercase text-[rgba(255,255,255,0.5)]">
        {phase === 'in' ? 'Breathe in' : 'Breathe out'}
      </p>

      <p className="mt-4 text-3xl font-semibold tabular-nums text-[rgba(255,255,255,0.85)]">
        {mins}:{secs.toString().padStart(2, '0')}
      </p>

      <div className="mt-8 flex items-center gap-2">
        {[
          { label: '−10 sec', seconds: 10 },
          { label: '−30 sec', seconds: 30 },
          { label: '−1 min', seconds: 60 },
        ].map((option) => (
          <button
            key={option.seconds}
            type="button"
            onClick={() => shortenBreak(option.seconds)}
            disabled={remaining <= 0}
            className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {option.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={endBreak}
        className="mt-6 rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
      >
        End break
      </button>
    </div>
  );
}