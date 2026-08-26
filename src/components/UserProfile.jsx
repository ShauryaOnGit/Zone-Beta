// src/components/UserProfile.jsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { computeFairScore } from '../lib/focusAnalytics';
import FeedCard from '../FeedCard';
import { feedCardThemes } from '../feedCardThemes';

function getInitials(name) {
  const value = String(name || '').trim();
  if (!value) return '?';

  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
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

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}


function formatTimeSince(dateStr) {
  const then = new Date(dateStr);
  if (isNaN(then)) return null;

  const now = new Date();
  const diffMs = now - then;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`;
}


function parseSessionLength(value) {
  if (value == null) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? seconds : null;
  }

  const parts = text.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
}

function formatAverageSessionLength(totalSeconds) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return '—';

  const roundedMinutes = Math.round(totalSeconds / 60);

  if (roundedMinutes < 1) return '<1m';
  if (roundedMinutes < 60) return `${roundedMinutes}m`;

  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}

export default function UserProfile() {
  const navigate = useNavigate();
  const { userId } = useParams();

  const [currentUserId, setCurrentUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [userPosts, setUserPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [lastFocusedAt, setLastFocusedAt] = useState(null);
  const [averageFocusScore, setAverageFocusScore] = useState(null);
  const [averageSessionLengthSeconds, setAverageSessionLengthSeconds] = useState(null);

  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true);
      setPostsLoading(true);
      setError('');
      setNotFound(false);

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        navigate('/auth');
        return;
      }

      // If viewing your own profile via this route, send to the editable Profile page instead
      if (userId === session.user.id) {
        navigate('/profile', { replace: true });
        return;
      }

      setCurrentUserId(session.user.id);

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('username, created_at, avatar_url')
        .eq('user_id', userId)
        .single();

      let resolvedAvatarUrl = null;

      if (profileError || !data) {
        setNotFound(true);
        setLoading(false);
        setPostsLoading(false);
        return;
      }

      setProfile(data);
      resolvedAvatarUrl = data?.avatar_url;
      setLoading(false);

      // Fetch this user's PUBLIC feed posts for display.
      const { data: postsData, error: postsError } = await supabase
        .from('feed_posts')
        .select('*')
        .eq('user_id', userId)
        .eq('is_private', false)
        .order('created_at', { ascending: false });

      // Fetch ALL of this user's posts separately so private sessions still
      // contribute to their overall average focus score.
      const { data: scorePostsData, error: scorePostsError } = await supabase
        .from('feed_posts')
        .select('focus_score, score_timeline, time_elapsed')
        .eq('user_id', userId);

      if (scorePostsError) {
        console.error('Error fetching focus scores:', scorePostsError);
      } else {
        const validScores = (scorePostsData || [])
          .map((p) => computeFairScore(p.score_timeline) ?? parseFloat(p.focus_score))
          .filter((n) => n != null && !isNaN(n));

        setAverageFocusScore(
          validScores.length > 0
            ? Math.round(validScores.reduce((sum, n) => sum + n, 0) / validScores.length)
            : null
        );

        const validSessionLengths = (scorePostsData || [])
          .map((p) => parseSessionLength(p.time_elapsed))
          .filter((seconds) => seconds != null && Number.isFinite(seconds));

        setAverageSessionLengthSeconds(
          validSessionLengths.length > 0
            ? validSessionLengths.reduce((sum, seconds) => sum + seconds, 0) / validSessionLengths.length
            : null
        );
      }

      if (postsError) {
        console.error('Error fetching user posts:', postsError);
      } else {
        const posts = postsData || [];
        const postIds = posts.map((p) => p.id);

        setLastFocusedAt(posts.length > 0 ? posts[0].created_at : null);

        // Fetch reactions for this user's posts
        let reactionsMap = {};
        if (postIds.length > 0) {
          const { data: reactionsData, error: reactionsError } = await supabase
            .from('card_reactions')
            .select('card_id, user_id, emoji')
            .in('card_id', postIds);

          if (reactionsError) {
            console.error('Error fetching reactions:', reactionsError);
          } else if (reactionsData) {
            reactionsData.forEach((r) => {
              if (!reactionsMap[r.card_id]) {
                reactionsMap[r.card_id] = {};
              }
              if (!reactionsMap[r.card_id][r.emoji]) {
                reactionsMap[r.card_id][r.emoji] = {
                  emoji: r.emoji,
                  count: 0,
                  userHasReacted: false,
                };
              }

              reactionsMap[r.card_id][r.emoji].count += 1;

              if (session.user?.id && r.user_id === session.user.id) {
                reactionsMap[r.card_id][r.emoji].userHasReacted = true;
              }
            });
          }
        }

        const formatted = posts.map((post) => {
          const dateObj = new Date(post.created_at);
          const formattedDate = isNaN(dateObj)
            ? 'Just now'
            : dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ' , ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          const postReactions = Object.values(reactionsMap[post.id] || {});

          return {
            id: `live-${post.id}`,
            rawId: post.id,
            userId: post.user_id,
            userName: data.username || 'Fellow User',
            userAvatar: resolvedAvatarUrl || initialsAvatarDataUrl(data.username || 'User'),
            date: formattedDate,
            title: post.title,
            goal: post.task_name || post.title,
            timeElapsed: post.time_elapsed,
            focusScore: String(computeFairScore(post.score_timeline) ?? post.focus_score),
            themeId: post.theme_id,
            bgImage: post.bg_image || undefined,
            initialReactions: postReactions,
          };
        });

        setUserPosts(formatted);
      }

      setPostsLoading(false);
    };

    loadProfile();
  }, [userId, navigate]);

  const handleUserClick = (clickedUserId) => {
    if (!clickedUserId) return;
    if (clickedUserId === currentUserId) {
      navigate('/profile');
    } else {
      navigate(`/profile/${clickedUserId}`);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-sm border border-slate-200 p-6 shadow-sm">
        <p className="text-sm text-slate-500">Loading profile...</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mb-8">
        <button
          onClick={() => navigate(-1)}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 mb-4 cursor-pointer"
        >
          &larr; Back
        </button>
        <div className="bg-white rounded-sm border border-slate-200 p-6 shadow-sm">
          <p className="text-sm text-slate-500">This user could not be found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <button
        onClick={() => navigate(-1)}
        className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 mb-4 cursor-pointer"
      >
        &larr; Back
      </button>

      <h1 className="mt-2 text-3xl font-semibold pb-6 text-slate-900">
        Profile
      </h1>

      {error && (
        <div className="mb-6 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="rounded-md border border-[#D0D7DE] bg-white p-7 shadow-sm text-slate-900 overflow-hidden">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-5 min-w-0">
            <div className="relative shrink-0">
              <img
                src={profile?.avatar_url || initialsAvatarDataUrl(profile?.username || 'User')}
                alt="Profile"
                className="w-20 h-20 rounded-full object-cover border border-[#D0D7DE] bg-white"
              />
            </div>

            <div className="min-w-0">
              <p className="text-2xl font-bold text-slate-900 truncate">
                {profile?.username || '—'}
              </p>
            </div>
          </div>

          <div className="shrink-0 grid grid-cols-2 gap-x-8 md:gap-x-10">
            

            <div className="text-center min-w-[140px]">
              <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-slate-500 mb-2">
                Avg Session Length
              </p>
              <p className="text-5xl font-black tracking-tight text-slate-900 leading-none">
                {postsLoading
                  ? '—'
                  : formatAverageSessionLength(averageSessionLengthSeconds)}
              </p>
            </div>
            <div className="text-center min-w-[140px]">
              <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-slate-500 mb-2">
                Avg Focus Score
              </p>
              <p className="text-5xl font-black tracking-tight text-slate-900 leading-none">
                {postsLoading
                  ? '—'
                  : averageFocusScore !== null
                  ? averageFocusScore
                  : '—'}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-500">
          <span>
            Last focused{' '}
            <strong className="font-semibold text-slate-800">
              {postsLoading
                ? 'Loading...'
                : lastFocusedAt
                ? formatTimeSince(lastFocusedAt)
                : "Hasn't started focusing yet"}
            </strong>
          </span>

          <span>
            Member since{' '}
            <strong className="font-semibold text-slate-800">
              {profile?.created_at
                ? new Date(profile.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : '—'}
            </strong>
          </span>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          {profile?.username ? `${profile.username}'s Feed Cards` : 'Feed Cards'}
        </h2>

        {postsLoading && (
          <p className="text-sm text-slate-500">Loading posts...</p>
        )}

        {!postsLoading && userPosts.length === 0 && (
          <p className="text-sm text-slate-500">This user hasn't posted anything yet.</p>
        )}

        <div className="columns-1 md:columns-2 gap-6 space-y-3">
          {userPosts.map((card) => {
            const theme = feedCardThemes.find((t) => t.id === card.themeId) ?? feedCardThemes[0];
            return (
              <div key={card.id} className="relative group break-inside-avoid mb-6">
                <FeedCard
                  {...card}
                  cardId={card.rawId}
                  currentUserId={currentUserId}
                  supabase={supabase}
                  onUserClick={handleUserClick}
                  bgGradient={theme.gradient}
                  fadeColor={theme.fadeColor}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}