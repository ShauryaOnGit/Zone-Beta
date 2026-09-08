import { useEffect, useMemo, useRef, useState } from 'react';

const LIVE_THEMES = [
  {
    key: 'blue',
    name: 'blue',
    gradient:
      'radial-gradient(circle 340px at 50% 0%, #eef8ff 0%, #cceaff 34%, #9fd7ff 68%, #7fc3f3 100%)',
  },
  {
    key: 'pink',
    name: 'pink',
    gradient:
      'radial-gradient(circle 340px at 50% 0%, #fff1f4 0%, #ffd0db 34%, #ff9eb8 68%, #fb6c96 100%)',
  },
  {
    key: 'yellow',
    name: 'yellow',
    gradient:
      'radial-gradient(circle 340px at 50% 0%, #fff8df 0%, #ffe9ad 34%, #ffd36a 68%, #ffc23b 100%)',
  },
  {
    key: 'green',
    name: 'green',
    gradient:
      'radial-gradient(circle 340px at 50% 0%, #eaffef 0%, #c7f7d2 34%, #83ed9d 68%, #45df69 100%)',
  },
  {
    key: 'purple',
    name: 'purple',
    gradient:
      'radial-gradient(circle 340px at 50% 0%, #fff0ff 0%, #f5caf4 34%, #e890e8 68%, #dc5cdd 100%)',
  },
];

const COLOR_PREVIEW_MS = 1600;
const COLOR_FADE_MS = 420;

function hashString(value) {
  const text = String(value || '');

  let hash = 0;

  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getDefaultThemeIndex(userId) {
  return (
    hashString(userId) %
    LIVE_THEMES.length
  );
}

function getThemeIndex(colorKey, userId) {
  const explicitIndex =
    LIVE_THEMES.findIndex(
      (theme) =>
        theme.key === colorKey
    );

  return explicitIndex >= 0
    ? explicitIndex
    : getDefaultThemeIndex(userId);
}

function PaletteIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 4-4 4h-1.8a1.8 1.8 0 0 0-1.5 2.8l.3.5A1.8 1.8 0 0 1 13.5 22H12Z" />
      <circle cx="7.5" cy="10.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="6.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="7.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12" r=".7" fill="currentColor" stroke="none" />
    </svg>
  );
}

function formatElapsed(startedAt, now) {
  if (!startedAt) return '00:00';

  const start = new Date(startedAt).getTime();

  if (!Number.isFinite(start)) return '00:00';

  const seconds = Math.max(
    0,
    Math.floor((now - start) / 1000)
  );

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(
    (seconds % 3600) / 60
  );
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getInitials(name) {
  const value = String(name || '').trim();

  if (!value) return '?';

  const parts = value
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 1) {
    return parts[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return `${parts[0][0] || ''}${
    parts[parts.length - 1][0] || ''
  }`.toUpperCase();
}

function initialsAvatarDataUrl(name) {
  const initials = getInitials(name);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <rect width="160" height="160" rx="80" fill="#E2E8F0"/>
      <text
        x="80"
        y="84"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="Arial, Helvetica, sans-serif"
        font-size="58"
        font-weight="700"
        fill="#334155"
      >${initials}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    svg
  )}`;
}

export default function LiveGroupCard({
  member,
  liveSession,
  isLive,
  now,
  onUserClick,
  isOwnCard = false,
  onColorChange,
}) {
  const initialThemeIndex = useMemo(
    () =>
      getThemeIndex(
        member.group_card_color,
        member.user_id
      ),
    [
      member.group_card_color,
      member.user_id,
    ]
  );

  const [
    selectedThemeIndex,
    setSelectedThemeIndex,
  ] = useState(initialThemeIndex);

  const [
    previewThemeIndex,
    setPreviewThemeIndex,
  ] = useState(null);

  const [
    previewVisible,
    setPreviewVisible,
  ] = useState(false);

  const previewTimeoutRef = useRef(null);
  const previewCleanupTimeoutRef =
    useRef(null);

  useEffect(() => {
    setSelectedThemeIndex(
      getThemeIndex(
        member.group_card_color,
        member.user_id
      )
    );
  }, [
    member.group_card_color,
    member.user_id,
  ]);

  useEffect(() => {
    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(
          previewTimeoutRef.current
        );
      }

      if (
        previewCleanupTimeoutRef.current
      ) {
        clearTimeout(
          previewCleanupTimeoutRef.current
        );
      }
    };
  }, []);

  const selectedTheme =
    LIVE_THEMES[selectedThemeIndex];

  const previewTheme =
    previewThemeIndex == null
      ? null
      : LIVE_THEMES[previewThemeIndex];

  const gradient =
    selectedTheme.gradient;

  const cycleColor = () => {
    if (!isOwnCard) return;

    const nextIndex =
      (selectedThemeIndex + 1) %
      LIVE_THEMES.length;

    const nextTheme =
      LIVE_THEMES[nextIndex];

    setSelectedThemeIndex(nextIndex);

    if (!isLive) {
      setPreviewThemeIndex(nextIndex);

      if (previewTimeoutRef.current) {
        clearTimeout(
          previewTimeoutRef.current
        );
      }

      if (
        previewCleanupTimeoutRef.current
      ) {
        clearTimeout(
          previewCleanupTimeoutRef.current
        );
      }

      // Mount the new gradient first, then fade it in on the
      // next frame so the browser can animate opacity cleanly.
      setPreviewVisible(false);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPreviewVisible(true);
        });
      });

      previewTimeoutRef.current =
        setTimeout(() => {
          setPreviewVisible(false);

          previewCleanupTimeoutRef.current =
            setTimeout(() => {
              setPreviewThemeIndex(null);
              previewCleanupTimeoutRef.current =
                null;
            }, COLOR_FADE_MS);

          previewTimeoutRef.current =
            null;
        }, COLOR_PREVIEW_MS);
    }

    onColorChange?.(nextTheme.key);
  };

  const avatar =
    member.avatar_url ||
    initialsAvatarDataUrl(
      member.username || 'Zone user'
    );

  const score =
    liveSession?.live_focus_score;

  if (!isLive) {
    const hasPreviewTheme =
      previewTheme != null;

    return (
      <article className="relative min-h-[245px] overflow-hidden rounded-md border border-[#D0D7DE] bg-slate-50 text-slate-500">
        {/* Gradients cannot interpolate smoothly in CSS, so the
            preview is a separate layer that cross-fades over
            the normal inactive card. */}
        {hasPreviewTheme && (
          <div
            className="pointer-events-none absolute inset-0 transition-opacity ease-out"
            style={{
              background:
                previewTheme.gradient,
              opacity:
                previewVisible ? 1 : 0,
              transitionDuration:
                `${COLOR_FADE_MS}ms`,
            }}
          />
        )}

        {isOwnCard && (
          <button
            type="button"
            onClick={cycleColor}
            className={`absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-300 cursor-pointer ${
              previewVisible
                ? 'border-white/60 bg-white/65 text-slate-700 hover:bg-white/85'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }`}
            title={`Switch card colour — currently ${selectedTheme.name}`}
            aria-label={`Switch card colour — currently ${selectedTheme.name}`}
          >
            <PaletteIcon />
          </button>
        )}

        <div className="relative z-10 p-6">
          <button
            type="button"
            onClick={() =>
              onUserClick?.(
                member.user_id
              )
            }
            className="flex w-fit items-center gap-3 text-left group/user cursor-pointer"
          >
            <img
              src={avatar}
              alt={
                member.username ||
                'Zone user'
              }
              className={`h-10 w-10 rounded-full border object-cover transition-all duration-300 group-hover/user:opacity-90 ${
                previewVisible
                  ? 'border-[#D0D7DE] grayscale-0 opacity-100'
                  : 'border-slate-200 grayscale opacity-70'
              }`}
            />

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3
                  className={`truncate text-sm font-bold tracking-wide transition-colors duration-300 group-hover/user:underline ${
                    previewVisible
                      ? 'text-slate-800'
                      : 'text-slate-600'
                  }`}
                >
                  {member.username ||
                    'Zone user'}
                </h3>

                {member.role === 'owner' && (
                  <span className="shrink-0 text-xs font-normal text-slate-400">
                    owner
                  </span>
                )}
              </div>

            </div>
          </button>

          <div className="relative flex min-h-[130px] items-center justify-center">
            <p
              className={`absolute text-lg font-semibold transition-all duration-300 ${
                previewVisible
                  ? 'translate-y-1 opacity-0'
                  : 'translate-y-0 text-slate-300 opacity-100'
              }`}
            >
              Not focusing right now
            </p>

            <p
              className={`absolute text-lg font-semibold text-slate-700 transition-all duration-300 ${
                previewVisible
                  ? 'translate-y-0 opacity-100'
                  : '-translate-y-1 opacity-0'
              }`}
            >
              {hasPreviewTheme
                ? `Your card will appear ${previewTheme.name}`
                : ''}
            </p>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className="relative min-h-[245px] overflow-hidden rounded-md border border-[#D0D7DE] text-slate-900"
      style={{ background: gradient }}
    >
      {isOwnCard && (
        <button
          type="button"
          onClick={cycleColor}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/60 bg-white/65 text-slate-700 transition-colors hover:bg-white/85 cursor-pointer"
          title={`Switch card colour — currently ${selectedTheme.name}`}
          aria-label={`Switch card colour — currently ${selectedTheme.name}`}
        >
          <PaletteIcon />
        </button>
      )}

      <div className="p-6">
        <button
          type="button"
          onClick={() => onUserClick?.(member.user_id)}
          className="flex w-fit items-center gap-3 text-left group/user cursor-pointer"
        >
          <img
            src={avatar}
            alt={member.username || 'Zone user'}
            className="h-10 w-10 rounded-full border border-[#D0D7DE] object-cover transition-opacity group-hover/user:opacity-80"
          />

          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-bold tracking-wide group-hover/user:underline">
                {member.username || 'Zone user'}
              </h3>

              {member.role === 'owner' && (
                <span className="shrink-0 text-xs font-normal text-slate-500">
                  owner
                </span>
              )}
            </div>

            <p className="mt-0.5 text-xs text-slate-600">
              Currently focusing
            </p>
          </div>
        </button>

        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          
        </p>

        <h2 className="mt-1 min-h-[48px] text-[20px] font-extrabold leading-tight">
          {liveSession.task_name}
        </h2>

        <div className="mt-4 flex items-end justify-between gap-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              Time elapsed
            </p>

            <p className="mt-1 text-[30px] font-bold tracking-tight tabular-nums">
              {formatElapsed(
                liveSession.started_at,
                now
              )}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              Live Focus Score
            </p>

            <p className="mt-1 text-lg font-semibold">
              {score == null ? '—' : score}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}