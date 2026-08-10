// src/components/UserProfile.jsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import FeedCard from '../FeedCard';
import { feedCardThemes } from '../feedCardThemes';

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
        .select('focus_score')
        .eq('user_id', userId);

      if (scorePostsError) {
        console.error('Error fetching focus scores:', scorePostsError);
      } else {
        const validScores = (scorePostsData || [])
          .map((p) => parseFloat(p.focus_score))
          .filter((n) => !isNaN(n));

        setAverageFocusScore(
          validScores.length > 0
            ? Math.round(validScores.reduce((sum, n) => sum + n, 0) / validScores.length)
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
            userAvatar: resolvedAvatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.user_id}`,
            date: formattedDate,
            title: post.title,
            timeElapsed: post.time_elapsed,
            focusScore: String(post.focus_score),
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
        {profile?.username || 'Profile'}
      </h1>

      {error && (
        <div className="mb-6 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="rounded-sm border border-[#D0D7DE] bg-slate-50 p-6 space-y-5 max-w-md shadow-sm">
        <div className="flex items-center gap-4">
          <img
            src={profile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`}
            alt="Profile"
            className="w-16 h-16 rounded-full object-cover border border-slate-200 bg-white"
          />
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Username</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{profile?.username || '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Avg Focus Score</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {postsLoading
              ? 'Loading...'
              : averageFocusScore !== null
              ? averageFocusScore
              : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Last Focused</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {postsLoading
              ? 'Loading...'
              : lastFocusedAt
              ? formatTimeSince(lastFocusedAt)
              : "Hasn't started focusing yet"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Member since</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {profile?.created_at
              ? new Date(profile.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : '—'}
          </p>
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