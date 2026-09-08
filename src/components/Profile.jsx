// src/components/Profile.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { computeFairScore } from '../lib/focusAnalytics';
import FeedCard from '../FeedCard';
import { feedCardThemes } from '../feedCardThemes';
import ConfirmModal from './ConfirmModal';

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




const EDIT_CARD_THEME_IDS = [
  'ocean',
  'blush',
  'amber',
  'meadow',
  'lavender',
];

const editCardThemes = EDIT_CARD_THEME_IDS
  .map((id) => feedCardThemes.find((theme) => theme.id === id))
  .filter(Boolean);

function EditPostModal({ post, userId, onClose, onSaved }) {
  const [title, setTitle] = useState(post.title || '');
  const [selectedTheme, setSelectedTheme] = useState(
    post.themeId || editCardThemes[0]?.id || feedCardThemes[0].id
  );
  const [imageFile, setImageFile] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title cannot be empty.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      let bgImageUrl = post.bgImage;

      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `${userId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('feed_images')
          .upload(filePath, imageFile);

        if (uploadError) throw uploadError;

        const { data } = supabase.storage
          .from('feed_images')
          .getPublicUrl(filePath);

        bgImageUrl = data.publicUrl;
      }

      const { data: updatedPost, error: updateError } = await supabase
        .from('feed_posts')
        .update({
          title: title.trim(),
          theme_id: selectedTheme,
          bg_image: bgImageUrl,
        })
        .eq('id', post.rawId)
        .eq('user_id', userId)
        .select('id, title, theme_id, bg_image')
        .maybeSingle();

      if (updateError) throw updateError;

      if (!updatedPost) {
        throw new Error(
          'Supabase did not update this post. Check the feed_posts UPDATE RLS policy for authenticated owners.'
        );
      }

      onSaved(updatedPost.id, {
        title: updatedPost.title,
        themeId: updatedPost.theme_id,
        bgImage: updatedPost.bg_image || undefined,
      });
    } catch (err) {
      console.error('Failed to persist post update to Supabase:', err);
      setError(
        err?.message?.includes('UPDATE RLS policy')
          ? 'This edit was not saved. Supabase is blocking post updates for this account.'
          : 'Could not save changes. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/25 p-4"
      onMouseDown={() => {
        if (!isSaving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="zone-edit-post-title"
        className="my-auto w-full max-w-2xl overflow-hidden rounded-md border border-[#D0D7DE] bg-white text-slate-900 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-6 py-5">
          <h2
            id="zone-edit-post-title"
            className="text-xl font-semibold text-slate-900"
          >
            Edit card
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Update the title, colour, or photo for this focus card.
          </p>
        </div>

        <div className="space-y-6 px-6 py-5">
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-[#D0D7DE] bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-700">
              Card colour
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {editCardThemes.map((theme) => {
                const selected = selectedTheme === theme.id;

                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setSelectedTheme(theme.id)}
                    className={`h-10 w-10 rounded-full border transition-all duration-200 cursor-pointer ${
                      selected
                        ? 'border-slate-900 ring-2 ring-slate-900/15 ring-offset-2'
                        : 'border-[#D0D7DE] hover:scale-105'
                    }`}
                    style={{ background: theme.gradient }}
                    title={theme.name}
                    aria-label={`${theme.name} card colour`}
                    aria-pressed={selected}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-700">
              {post.bgImage ? 'Replace photo' : 'Add a photo'}
              <span className="ml-1 font-normal text-slate-400">
                optional
              </span>
            </p>

            {post.bgImage && !imageFile && (
              <img
                src={post.bgImage}
                alt="Current card"
                className="mt-3 max-h-44 w-full rounded-md border border-[#D0D7DE] object-cover"
              />
            )}

            {imageFile && (
              <p className="mt-3 truncate text-xs text-slate-500">
                Selected: {imageFile.name}
              </p>
            )}

            <input
              type="file"
              accept="image/*"
              onChange={(event) => setImageFile(event.target.files?.[0] || null)}
              className="mt-3 block w-full text-sm text-slate-500 file:mr-3 file:h-9 file:rounded-md file:border file:border-[#D0D7DE] file:bg-white file:px-3 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-50 file:cursor-pointer cursor-pointer"
            />
          </div>

          {error && (
            <p className="text-sm text-rose-600">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="h-10 rounded-md border border-[#D0D7DE] bg-white px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="h-10 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [myPosts, setMyPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [lastFocusedAt, setLastFocusedAt] = useState(null);
  const [averageFocusScore, setAverageFocusScore] = useState(null);
  const [averageSessionLengthSeconds, setAverageSessionLengthSeconds] = useState(null);
  const [editingPost, setEditingPost] = useState(null);

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        navigate('/auth');
        return;
      }

      setUser(session.user);

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('username, created_at, avatar_url, is_pro')
        .eq('user_id', session.user.id)
        .single();

      let resolvedAvatarUrl = null;
      if (profileError) {
        setError('Could not load your profile.');
      } else {
        setProfile(data);
        resolvedAvatarUrl = data?.avatar_url;
      }

      setLoading(false);

      // 1. Fetch only this user's feed posts
      const { data: postsData, error: postsError } = await supabase
        .from('feed_posts')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (postsError) {
        console.error('Error fetching your posts:', postsError);
      } else {
        const posts = postsData || [];
        const postIds = posts.map((p) => p.id);

        setLastFocusedAt(posts.length > 0 ? posts[0].created_at : null);

        const validScores = posts
          .map((p) => computeFairScore(p.score_timeline) ?? parseFloat(p.focus_score))
          .filter((n) => n != null && !isNaN(n));
        setAverageFocusScore(
          validScores.length > 0
            ? Math.round(validScores.reduce((sum, n) => sum + n, 0) / validScores.length)
            : null
        );

        const validSessionLengths = posts
          .map((p) => parseSessionLength(p.time_elapsed))
          .filter((seconds) => seconds != null && Number.isFinite(seconds));

        setAverageSessionLengthSeconds(
          validSessionLengths.length > 0
            ? validSessionLengths.reduce((sum, seconds) => sum + seconds, 0) / validSessionLengths.length
            : null
        );

        // 2. Fetch reactions for user's posts
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

        // 3. Format posts with reactions attached
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
            userName: data?.username || session.user?.email || 'User',
            userAvatar: resolvedAvatarUrl || initialsAvatarDataUrl(data?.username || session.user?.email || 'User'),
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

        setMyPosts(formatted);
      }

      setPostsLoading(false);
    };

    loadProfile();
  }, [navigate]);

  const handleDeletePost = async (rawId) => {
    setIsDeleting(true);
    setDeleteError('');

    try {
      const { error } = await supabase
        .from('feed_posts')
        .delete()
        .eq('id', rawId);

      if (error) throw error;

      setMyPosts((prev) => prev.filter((p) => p.rawId !== rawId));
      setConfirmingDeleteId(null);
    } catch (err) {
      console.error('Failed to delete post:', err);
      setDeleteError('Could not delete this card. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePostUpdated = (rawId, updates) => {
    setMyPosts((prev) =>
      prev.map((p) => (p.rawId === rawId ? { ...p, ...updates } : p))
    );
    setEditingPost(null);
  };

  const handleOpenSummary = (rawId) => {
    navigate('/history', {
      state: { targetPostId: rawId, openSessionSummary: true },
    });
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarError('');

    if (!file.type.startsWith('image/')) {
      setAvatarError('Please choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be smaller than 5MB.');
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/auth');
        return;
      }

      const fileExt = file.name.split('.').pop();
      const filePath = `${session.user.id}/avatar.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true, cacheControl: '3600' });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const newAvatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: newAvatarUrl })
        .eq('user_id', session.user.id);

      if (updateError) throw updateError;

      setProfile((prev) => ({ ...prev, avatar_url: newAvatarUrl }));
      setMyPosts((prev) => prev.map((p) => ({ ...p, userAvatar: newAvatarUrl })));
    } catch (err) {
      console.error('Failed to upload avatar:', err);
      setAvatarError('Could not upload image. Please try again.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-sm border border-slate-200 p-6 shadow-sm">
        <p className="text-sm text-slate-500">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <h1 className="mt-2 text-3xl font-semibold pb-6 text-slate-900">Profile</h1>
      {error && (
        <div className="mb-6 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="rounded-md border border-[#D0D7DE] bg-white p-7 shadow-sm text-slate-900 overflow-hidden">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-5 min-w-0">
            <div className="relative shrink-0 group">
              <label
                className="relative block w-20 h-20 rounded-full cursor-pointer overflow-hidden"
                title={profile?.avatar_url ? 'Change photo' : 'Upload photo'}
              >
                <img
                  src={profile?.avatar_url || initialsAvatarDataUrl(profile?.username || user?.email || 'You')}
                  alt="Profile"
                  className="w-20 h-20 rounded-full object-cover border border-[#D0D7DE] bg-white"
                />

                <div className="absolute inset-0 rounded-full bg-slate-900/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </div>

                {isUploadingAvatar && (
                  <div className="absolute inset-0 rounded-full bg-slate-900/55 flex items-center justify-center">
                    <span className="text-white text-[10px] font-semibold">...</span>
                  </div>
                )}

                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  disabled={isUploadingAvatar}
                  className="hidden"
                />
              </label>
            </div>

            <div className="min-w-0">
              <p className="text-2xl font-bold text-slate-900 truncate">
                {profile?.username || '—'}
              </p>
              <p className="mt-1 text-sm text-slate-500 truncate">
                {user?.email || '—'}
              </p>

              {avatarError && (
                <p className="mt-2 text-xs text-red-600">{avatarError}</p>
              )}
            </div>
          </div>

          <div className="shrink-0 grid grid-cols-2 gap-x-8 md:gap-x-10">
            <div className="text-center min-w-[140px] flex flex-col items-center">
              <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-slate-500">
                Avg Session Length
              </p>
              <div className="mt-2 h-[58px] flex items-center justify-center overflow-visible">
                <p className="text-5xl font-black tracking-tight text-slate-900 leading-[1.08] pb-[2px]">
                  {postsLoading
                    ? '—'
                    : formatAverageSessionLength(averageSessionLengthSeconds)}
                </p>
              </div>
              <div className="mt-2 min-h-[15px]" aria-hidden="true" />
            </div>
            <div className="text-center min-w-[140px] flex flex-col items-center">
              <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-slate-500">
                Avg Focus Score
              </p>
              <div className="mt-2 h-[58px] flex items-center justify-center overflow-visible">
                <p className="text-5xl font-black tracking-tight text-slate-900 leading-[1.08] pb-[2px]">
                  {postsLoading
                    ? '—'
                    : averageFocusScore !== null
                    ? averageFocusScore
                    : '—'}
                </p>
              </div>
              <div className="mt-2 min-h-[15px] flex items-start justify-center">
                {!postsLoading && profile?.is_pro && averageFocusScore !== null && averageFocusScore > 80 && (
                  <button
                    type="button"
                    onClick={() => navigate('/analytics')}
                    className="text-[10px] font-medium tracking-[0.03em] text-slate-400 leading-[15px] hover:text-slate-600 hover:underline underline-offset-2 transition-colors cursor-pointer"
                  >
                    uses Zone Pro
                  </button>
                )}
              </div>
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
                : "Haven't started focusing yet"}
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
        <h2 className="text-xl font-semibold text-slate-900 mb-4">Your Feed Cards</h2>

        {postsLoading && (
          <p className="text-sm text-slate-500">Loading your posts...</p>
        )}

        {!postsLoading && myPosts.length === 0 && (
          <p className="text-sm text-slate-500">You haven't posted anything yet.</p>
        )}

        <div className="columns-1 md:columns-2 gap-6 space-y-3">
          {myPosts.map((card) => {
            const theme = feedCardThemes.find((t) => t.id === card.themeId) ?? feedCardThemes[0];
            return (
              <div key={card.id} className="relative group break-inside-avoid mb-6">
                <div>
                  <FeedCard
                    {...card}
                    cardId={card.rawId}
                    currentUserId={user?.id}
                    supabase={supabase}
                    bgGradient={theme.gradient}
                    fadeColor={theme.fadeColor}
                    onUserClick={undefined}
                  />
                </div>

                <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
                  <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenSummary(card.rawId);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/60 bg-white/65 text-slate-700 opacity-0 backdrop-blur-sm transition-all duration-200 group-hover:opacity-100 hover:bg-white/85 hover:text-slate-900 cursor-pointer"
                        title="Open session summary"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 3v18h18" />
                          <path d="m7 16 4-4 3 3 5-7" />
                        </svg>
                      </button>
                      
                      <button
                        onClick={() => setEditingPost(card)}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/60 bg-white/65 text-slate-700 opacity-0 backdrop-blur-sm transition-all duration-200 group-hover:opacity-100 hover:bg-white/85 hover:text-slate-900 cursor-pointer"
                        title="Edit your feed card"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          setDeleteError('');
                          setConfirmingDeleteId(card.rawId);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/60 bg-white/65 text-slate-700 opacity-0 backdrop-blur-sm transition-all duration-200 group-hover:opacity-100 hover:bg-white/85 hover:text-slate-900 cursor-pointer"
                        title="Delete your feed card"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editingPost && (
        <EditPostModal
          post={editingPost}
          userId={user?.id}
          onClose={() => setEditingPost(null)}
          onSaved={handlePostUpdated}
        />
      )}

      {confirmingDeleteId && (
        <ConfirmModal
          title="Delete card?"
          description="This card will be permanently removed."
          confirmLabel="Delete card"
          busyLabel="Deleting..."
          busy={isDeleting}
          error={deleteError}
          onConfirm={() => handleDeletePost(confirmingDeleteId)}
          onCancel={() => {
            setConfirmingDeleteId(null);
            setDeleteError('');
          }}
        />
      )}
    </div>
  );
}