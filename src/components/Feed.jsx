import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import FeedCard from '../FeedCard';
import { feedCardThemes } from '../feedCardThemes';
import { supabase } from '../lib/supabaseClient';

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

export default function Feed() {
  const navigate = useNavigate();
  const [livePosts, setLivePosts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
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

      // 3. Fetch live posts — only from the current user and their accepted friends
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
                  `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.user_id}`,
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
          userName: isOwnPost ? 'You' : usernameMap[post.user_id] || 'Fellow User',
          userAvatar:
            avatarMap[post.user_id] || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.user_id}`,
          date: formattedDate,
          title: post.title,
          timeElapsed: post.time_elapsed,
          focusScore: String(post.focus_score),
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
    try {
      const { error } = await supabase.from('feed_posts').delete().eq('id', rawId);

      if (error) throw error;

      setLivePosts((prev) => prev.filter((p) => p.rawId !== rawId));
      setConfirmingDeleteId(null);
    } catch (err) {
      console.error('Failed to delete post:', err);
      alert('Could not delete the post. Please try again.');
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
            className="relative p-2 mt-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors cursor-pointer"
            title="Notifications"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
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
            <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200 z-50 p-3 text-slate-800 animate-in fade-in zoom-in-95 duration-150">
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
              <FeedCard
                {...card}
                cardId={card.rawId}
                currentUserId={currentUserId}
                supabase={supabase}
                onUserClick={handleUserClick}
                bgGradient={theme.gradient}
                fadeColor={theme.fadeColor}
              />

              {/* Edit + Delete Buttons */}
              {isOwner && (
                <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
                  {confirmingDeleteId === card.rawId ? (
                    <div className="bg-slate-900/95 border border-white/20 p-2.5 rounded-md shadow-sm flex items-center gap-2 backdrop-blur-md animate-in fade-in zoom-in duration-150">
                      <span className="text-xs text-white font-medium pl-1">Delete card?</span>
                      <button
                        onClick={() => handleDeletePost(card.rawId)}
                        disabled={isDeleting}
                        className="bg-rose-600 hover:bg-rose-500 text-white text-xs px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isDeleting ? '...' : 'Yes'}
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteId(null)}
                        disabled={isDeleting}
                        className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer"
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
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
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
                        onClick={() => setConfirmingDeleteId(card.rawId)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-rose-600 text-white p-2 rounded-full shadow-lg backdrop-blur-sm cursor-pointer"
                        title="Delete your feed card"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
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
                  )}
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
    </div>
  );
}