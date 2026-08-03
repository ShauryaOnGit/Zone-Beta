// src/components/Profile.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

function EditPostModal({ post, userId, onClose, onSaved }) {
  const [title, setTitle] = useState(post.title || '');
  const [selectedTheme, setSelectedTheme] = useState(post.themeId || feedCardThemes[0].id);
  const [imageFile, setImageFile] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmingClose, setConfirmingClose] = useState(false);

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

        const { data } = supabase.storage.from('feed_images').getPublicUrl(filePath);
        bgImageUrl = data.publicUrl;
      }

      const { error: updateError } = await supabase
        .from('feed_posts')
        .update({
          title: title.trim(),
          theme_id: selectedTheme,
          bg_image: bgImageUrl,
        })
        .eq('id', post.rawId);

      if (updateError) throw updateError;

      onSaved(post.rawId, { title: title.trim(), themeId: selectedTheme, bgImage: bgImageUrl });
    } catch (err) {
      console.error('Failed to update post:', err);
      setError('Could not save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0F172A] text-white flex flex-col z-50 overflow-y-auto p-10">
      <div className="max-w-3xl mx-auto w-full bg-[#1E293B] rounded-md p-8 shadow-2xl border border-[rgba(255,255,255,0.1)]">
        <h2 className="text-3xl font-bold mb-6">Edit Post</h2>

        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.1em] text-[rgba(255,255,255,0.6)] mb-2">Title</p>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full h-[48px] px-[16px] rounded-md bg-[#0F172A] border-[1.5px] border-[rgba(255,255,255,0.12)] text-white text-[15px] focus:outline-none focus:border-[rgba(99,102,241,0.6)] transition-colors"
          />
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

        <div className="mb-10">
          <p className="text-xs uppercase tracking-[0.1em] text-[rgba(255,255,255,0.6)] mb-4">
            {post.bgImage ? 'Replace Photo' : 'Add a Photo (Optional)'}
          </p>
          {post.bgImage && !imageFile && (
            <img
              src={post.bgImage}
              alt="Current"
              className="w-full max-h-48 object-cover rounded-md mb-4 border border-[rgba(255,255,255,0.08)]"
            />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setImageFile(e.target.files[0])}
            className="block w-full text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-500/20 file:text-indigo-300 hover:file:bg-indigo-500/30 file:cursor-pointer cursor-pointer"
          />
        </div>

        {error && <p className="text-[#E11D48] mb-4 text-sm">{error}</p>}

        <div className="flex justify-end gap-4 items-center">
          {confirmingClose ? (
            <div className="bg-slate-900/95 border border-white/20 p-2.5 rounded-md shadow-sm flex items-center gap-2 backdrop-blur-md animate-in fade-in zoom-in duration-150">
              <span className="text-xs text-white font-medium pl-1">Discard changes?</span>
              <button
                onClick={onClose}
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
              disabled={isSaving}
              className="px-6 py-3 rounded-md font-semibold text-white bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.15)] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-3 rounded-md font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 active:scale-95 transition-all cursor-pointer shadow-lg shadow-indigo-900/20"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
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
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [lastFocusedAt, setLastFocusedAt] = useState(null);
  const [averageFocusScore, setAverageFocusScore] = useState(null);
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
        .select('username, created_at, avatar_url')
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
          .map((p) => parseFloat(p.focus_score))
          .filter((n) => !isNaN(n));
        setAverageFocusScore(
          validScores.length > 0
            ? Math.round(validScores.reduce((sum, n) => sum + n, 0) / validScores.length)
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
            userName: 'You',
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

        setMyPosts(formatted);
      }

      setPostsLoading(false);
    };

    loadProfile();
  }, [navigate]);

  const handleDeletePost = async (rawId) => {
    setIsDeleting(true);
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
      alert('Could not delete the post. Please try again.');
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

      <div className="rounded-sm border border-[#D0D7DE] bg-slate-50 p-6 space-y-5 max-w-md shadow-sm">
        <div className="flex items-center gap-4">
          <div className="relative">
            <img
              src={profile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id}`}
              alt="Profile"
              className="w-16 h-16 rounded-full object-cover border border-slate-200 bg-white"
            />
            {isUploadingAvatar && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <span className="text-white text-[10px]">...</span>
              </div>
            )}
          </div>
          <div>
            <label className="inline-block text-xs font-semibold text-indigo-600 hover:text-indigo-500 cursor-pointer">
              {profile?.avatar_url ? 'Change photo' : 'Upload photo'}
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                disabled={isUploadingAvatar}
                className="hidden"
              />
            </label>
            {avatarError && (
              <p className="text-xs text-red-600 mt-1">{avatarError}</p>
            )}
          </div>
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
          <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Email</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{user?.email || '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Last Focused</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {postsLoading
              ? 'Loading...'
              : lastFocusedAt
              ? formatTimeSince(lastFocusedAt)
              : "Haven't started focusing yet"}
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
                <FeedCard
                  {...card}
                  cardId={card.rawId}
                  currentUserId={user?.id}
                  supabase={supabase}
                  bgGradient={theme.gradient}
                  fadeColor={theme.fadeColor}
                  onUserClick={undefined}
                />

                <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
                  {confirmingDeleteId === card.rawId ? (
                    <div className="bg-slate-900/95 border border-white/20 p-2.5 rounded-md shadow-xl flex items-center gap-2 backdrop-blur-md animate-in fade-in zoom-in duration-150">
                      <span className="text-xs text-white font-medium pl-1">Delete card?</span>
                      <button
                        onClick={() => handleDeletePost(card.rawId)}
                        disabled={isDeleting}
                        className="bg-rose-600 hover:bg-rose-500 text-white text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isDeleting ? '...' : 'Yes'}
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteId(null)}
                        disabled={isDeleting}
                        className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => setEditingPost(card)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-indigo-600 text-white p-2 rounded-full shadow-lg backdrop-blur-sm cursor-pointer"
                        title="Edit your feed card"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteId(card.rawId)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-rose-600 text-white p-2 rounded-full shadow-lg backdrop-blur-sm cursor-pointer"
                        title="Delete your feed card"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </>
                  )}
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
    </div>
  );
}