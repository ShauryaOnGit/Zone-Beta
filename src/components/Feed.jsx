import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import FeedCard from '../FeedCard';
import { feedCardThemes } from '../feedCardThemes';
import { supabase } from '../lib/supabaseClient';
import { computeFairScore } from '../lib/focusAnalytics';
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
export default function Feed() {
  const navigate = useNavigate();
  const [livePosts, setLivePosts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [editingPost, setEditingPost] = useState(null);

  // --- Notification States ---
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const dropdownRef = useRef(null);

  // Close notifications dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    fetchUserDataAndPosts();
  }, []);

  // Set up Supabase Realtime subscription for instant reaction alerts
  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel('realtime_reactions')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'card_reactions' },
        () => {
          fetchUserDataAndPosts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  // Refresh the feed live when friendships change (accept/unfriend/new request resolved)
  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel('realtime_friends')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friends' },
        () => {
          fetchUserDataAndPosts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  const fetchUserDataAndPosts = async () => {
    try {
      // 1. Get current logged-in user
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id || null;
      if (userId) {
        setCurrentUserId(userId);
      }

      // 2. Fetch this user's accepted friend IDs, then fetch only their posts + own posts
      let visibleUserIds = userId ? [userId] : [];

      if (userId) {
        const { data: friendRows, error: friendRowsError } = await supabase
          .from('friends')
          .select('requester_id, addressee_id, status')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
          .eq('status', 'accepted');

        if (friendRowsError) {
          console.error('Error fetching friend list for feed filtering:', friendRowsError);
        } else {
          const friendIds = (friendRows || []).map((r) =>
            r.requester_id === userId ? r.addressee_id : r.requester_id
          );
          visibleUserIds = [...new Set([userId, ...friendIds])];
        }
      }

      // 3. Fetch live posts — only from the current user and their accepted
      // friends, and only ones that were posted publicly. "Save Privately"
      // promises a session won't post to the feed, so private posts are
      // excluded here even when they belong to the viewer themselves —
      // they still show up on that user's own Profile page.
      let postsQuery = supabase
        .from('feed_posts')
        .select('*')
        .eq('is_private', false)
        .order('created_at', { ascending: false });

      postsQuery = userId ? postsQuery.in('user_id', visibleUserIds) : postsQuery.eq('user_id', '__none__');

      const { data, error } = await postsQuery;

      if (error) throw error;

      const posts = data || [];
      const postIds = posts.map((p) => p.id);

      // 4. Fetch usernames & avatars for all authors in one batched query
      const authorIds = [...new Set(posts.map((p) => p.user_id))];
      let usernameMap = {};
      let avatarMap = {};

      if (authorIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, username, avatar_url')
          .in('user_id', authorIds);

        if (profilesError) {
          console.error('Error fetching usernames:', profilesError);
        } else {
          usernameMap = Object.fromEntries(
            (profilesData || []).map((p) => [p.user_id, p.username])
          );
          avatarMap = Object.fromEntries(
            (profilesData || []).map((p) => [p.user_id, p.avatar_url])
          );
        }
      }

      // 5. Fetch reactions for all loaded posts
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

            if (userId && r.user_id === userId) {
              reactionsMap[r.card_id][r.emoji].userHasReacted = true;
            }
          });

          // 6. Build Notifications for Reactions on Current User's Posts
          if (userId) {
            const userOwnPosts = posts.filter((p) => p.user_id === userId);
            const userOwnPostIds = userOwnPosts.map((p) => p.id);
            const postTitleMap = Object.fromEntries(userOwnPosts.map((p) => [p.id, p.title]));

            // Find reactions made on current user's posts by OTHER users
            const ownPostReactions = reactionsData.filter(
              (r) => userOwnPostIds.includes(r.card_id) && r.user_id !== userId
            );

            if (ownPostReactions.length > 0) {
              const reactorIds = [...new Set(ownPostReactions.map((r) => r.user_id))];

              const { data: reactorProfiles } = await supabase
                .from('profiles')
                .select('user_id, username, avatar_url')
                .in('user_id', reactorIds);

              const reactorUsernames = Object.fromEntries(
                (reactorProfiles || []).map((p) => [p.user_id, p.username])
              );
              const reactorAvatars = Object.fromEntries(
                (reactorProfiles || []).map((p) => [p.user_id, p.avatar_url])
              );

              const formattedNotifications = ownPostReactions.map((r, index) => ({
                id: `${r.card_id}_${r.user_id}_${r.emoji}`,
                username: reactorUsernames[r.user_id] || 'Someone',
                avatar:
                  reactorAvatars[r.user_id] ||
                  initialsAvatarDataUrl(reactorUsernames[r.user_id] || 'Someone'),
                postTitle: postTitleMap[r.card_id] || 'your post',
                emoji: r.emoji,
              }));

              setNotifications(formattedNotifications);

              // Check localStorage for previously seen notification IDs
              const seenIds = JSON.parse(
                localStorage.getItem(`seen_reactions_${userId}`) || '[]'
              );
              const hasUnseen = formattedNotifications.some((n) => !seenIds.includes(n.id));

              setHasUnread(hasUnseen);
            } else {
              setNotifications([]);
              setHasUnread(false);
            }
          }
        }
      }

      // 7. Format posts
      const formattedPosts = posts.map((post) => {
        const dateObj = new Date(post.created_at);
        const formattedDate = isNaN(dateObj)
          ? 'Just now'
          : dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) +
            ' , ' +
            dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const isOwnPost = post.user_id === userId;
        const postReactions = Object.values(reactionsMap[post.id] || {});

        return {
          id: `live-${post.id}`,
          rawId: post.id,
          userId: post.user_id,
          userName: usernameMap[post.user_id] || (isOwnPost ? 'You' : 'Fellow User'),
          userAvatar:
            avatarMap[post.user_id] ||
            initialsAvatarDataUrl(
              usernameMap[post.user_id] || (isOwnPost ? 'You' : 'Fellow User')
            ),
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

      setLivePosts(formattedPosts);
    } catch (err) {
      console.error('Error fetching live feed data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePost = async (rawId) => {
    setIsDeleting(true);
    setDeleteError('');

    try {
      const { error } = await supabase.from('feed_posts').delete().eq('id', rawId);

      if (error) throw error;

      setLivePosts((prev) => prev.filter((p) => p.rawId !== rawId));
      setConfirmingDeleteId(null);
    } catch (err) {
      console.error('Failed to delete post:', err);
      setDeleteError('Could not delete this card. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePostUpdated = (rawId, updates) => {
    setLivePosts((prev) =>
      prev.map((p) => (p.rawId === rawId ? { ...p, ...updates } : p))
    );
    setEditingPost(null);
  };

  const handleOpenSummary = (rawId) => {
    navigate('/history', {
      state: { targetPostId: rawId, openSessionSummary: true },
    });
  };

  const handleUserClick = (clickedUserId) => {
    if (!clickedUserId) return;
    if (clickedUserId === currentUserId) {
      navigate('/profile');
    } else {
      navigate(`/profile/${clickedUserId}`);
    }
  };

  const toggleNotifications = () => {
    const nextState = !showNotifications;
    setShowNotifications(nextState);

    // When opening the notifications panel, mark all current items as seen
    if (nextState && currentUserId) {
      const currentIds = notifications.map((n) => n.id);
      localStorage.setItem(`seen_reactions_${currentUserId}`, JSON.stringify(currentIds));
      setHasUnread(false);
    }
  };

  const mockFeedData = [];
  const allFeedCards = [...livePosts, ...mockFeedData];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Top Header with Title and Notification Bell */}
      <div className="flex justify-between items-center mb-8 relative">
        <h2 className="mt-2 text-3xl font-semibold text-slate-900">Feed</h2>

        {/* Bell Icon Dropdown Trigger */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={toggleNotifications}
            className="relative p-2 mt-2 text-black hover:text-black hover:bg-slate-100 rounded-full transition-colors cursor-pointer"
            title="Notifications"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>

            {/* Red Badge Indicator */}
            {hasUnread && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-rose-500 rounded-full ring-2 ring-white animate-pulse" />
            )}
          </button>

          {/* Notifications Dropdown Panel */}
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white/95 backdrop-blur-md rounded-md shadow-xl border border-slate-200 z-50 p-3 text-slate-800 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 px-1">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Reactions Activity
                </h4>
                <span className="text-[10px] font-semibold bg-slate-100 px-2 py-0.5 rounded-full text-slate-600">
                  {notifications.length}
                </span>
              </div>

              {notifications.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  No reactions on your posts yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-xl transition-colors border border-transparent hover:border-slate-100"
                    >
                      {/* Reactor Profile Picture */}
                      <img
                        src={n.avatar}
                        alt={n.username}
                        className="w-9 h-9 rounded-full border border-slate-200 object-cover shrink-0"
                      />

                      {/* Content details */}
                      <div className="flex-1 text-xs leading-snug min-w-0">
                        <p className="truncate">
                          <span className="font-bold text-slate-900">{n.username}</span> reacted to{' '}
                          <span className="font-medium text-slate-700 italic">"{n.postTitle}"</span>
                        </p>
                      </div>

                      {/* Emoji Badge */}
                      <div className="text-lg shrink-0 bg-slate-100 p-1 rounded-full w-8 h-8 flex items-center justify-center border border-slate-200/60 shadow-xs">
                        {n.emoji}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isLoading && (
        <p className="text-slate-500 text-sm mb-4">Syncing live session cards...</p>
      )}

      {/* Feed Cards Column */}
      <div className="columns-1 md:columns-2 gap-6 space-y-3">
        {allFeedCards.map((card) => {
          const theme = feedCardThemes.find((t) => t.id === card.themeId) ?? feedCardThemes[0];
          const isOwner = card.userId && card.userId === currentUserId;

          return (
            <div key={card.id} className="relative group break-inside-avoid mb-6">
              <div>
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

              {/* Edit + Delete Buttons */}
              {isOwner && (
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
                        >
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
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editingPost && (
        <EditPostModal
          post={editingPost}
          userId={currentUserId}
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