// src/components/Friends.jsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

function ProfileActionCard({ profile, navigate, children }) {
  return (
    <div className="w-full rounded-sm border border-[#D0D7DE] bg-white p-6 space-y-5 shadow-sm">
      <div
        className="flex items-center gap-4 cursor-pointer group/user w-full"
        onClick={() => navigate(`/profile/${profile.user_id}`)}
      >
        <img
          src={profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.user_id}`}
          alt={profile.username}
          className="w-14 h-14 rounded-full object-cover border border-slate-200 bg-white group-hover/user:opacity-80 transition-opacity flex-shrink-0"
        />
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-600 mb-1">Username</p>
          <p className="mt-1 text-base font-semibold text-slate-900 group-hover/user:underline truncate">
            {profile.username || '—'}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

// Batch-fetches the average focus score for a set of user IDs in a single
// query, since Supabase's JS client doesn't support server-side GROUP BY/AVG
// without a custom RPC. Returns { [userId]: number | null }.
async function fetchAverageFocusScores(userIds) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from('feed_posts')
    .select('user_id, focus_score')
    .in('user_id', uniqueIds);

  if (error) {
    console.error('Error fetching focus scores for average:', error);
    return {};
  }

  const sums = {};
  const counts = {};
  (data || []).forEach((row) => {
    const score = parseFloat(row.focus_score);
    if (isNaN(score)) return;
    sums[row.user_id] = (sums[row.user_id] || 0) + score;
    counts[row.user_id] = (counts[row.user_id] || 0) + 1;
  });

  const averages = {};
  uniqueIds.forEach((id) => {
    averages[id] = counts[id] ? Math.round(sums[id] / counts[id]) : null;
  });
  return averages;
}

export default function Friends() {
  const navigate = useNavigate();

  const [currentUserId, setCurrentUserId] = useState(null);

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState('');

  // friendStatusMap: { [otherUserId]: 'none' | 'pending_sent' | 'pending_received' | 'friends' }
  const [friendStatusMap, setFriendStatusMap] = useState({});
  const [friendRowIdMap, setFriendRowIdMap] = useState({}); // { [otherUserId]: friends.id }
  const [actioningId, setActioningId] = useState(null);
  const [confirmingUnfriendId, setConfirmingUnfriendId] = useState(null);

  // Incoming requests + accepted friends list
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [friendsList, setFriendsList] = useState([]);
  const [isLoadingRelations, setIsLoadingRelations] = useState(true);
  const [relationsError, setRelationsError] = useState('');

  const debounceRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/auth');
        return;
      }
      setCurrentUserId(session.user.id);
    };
    init();
  }, [navigate]);

  useEffect(() => {
    if (currentUserId) {
      loadRelations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  const loadRelations = async () => {
    setIsLoadingRelations(true);
    setRelationsError('');

    try {
      const { data: rows, error: relError } = await supabase
        .from('friends')
        .select('id, requester_id, addressee_id, status')
        .or(`requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`);

      if (relError) throw relError;

      const allRows = rows || [];

      const pendingReceivedRows = allRows.filter(
        (r) => r.status === 'pending' && r.addressee_id === currentUserId
      );
      const acceptedRows = allRows.filter((r) => r.status === 'accepted');

      const otherIdsNeeded = [
        ...new Set([
          ...pendingReceivedRows.map((r) => r.requester_id),
          ...acceptedRows.map((r) => (r.requester_id === currentUserId ? r.addressee_id : r.requester_id)),
        ]),
      ];

      let profilesById = {};
      if (otherIdsNeeded.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, username, avatar_url, created_at')
          .in('user_id', otherIdsNeeded);

        if (profilesError) throw profilesError;

        profilesById = Object.fromEntries((profilesData || []).map((p) => [p.user_id, p]));
      }

      const averageScoresById = await fetchAverageFocusScores(otherIdsNeeded);

      setIncomingRequests(
        pendingReceivedRows
          .map((r) => ({
            friendRowId: r.id,
            ...profilesById[r.requester_id],
            averageFocusScore: averageScoresById[r.requester_id] ?? null,
          }))
          .filter((p) => p.user_id)
      );

      setFriendsList(
        acceptedRows
          .map((r) => {
            const otherId = r.requester_id === currentUserId ? r.addressee_id : r.requester_id;
            return {
              friendRowId: r.id,
              ...profilesById[otherId],
              averageFocusScore: averageScoresById[otherId] ?? null,
            };
          })
          .filter((p) => p.user_id)
      );

      // Also seed the status map so search results reflect current relationships
      const statusMap = {};
      const rowIdMap = {};
      allRows.forEach((row) => {
        const otherId = row.requester_id === currentUserId ? row.addressee_id : row.requester_id;
        rowIdMap[otherId] = row.id;
        if (row.status === 'accepted') {
          statusMap[otherId] = 'friends';
        } else if (row.status === 'pending') {
          statusMap[otherId] = row.requester_id === currentUserId ? 'pending_sent' : 'pending_received';
        }
      });
      setFriendStatusMap((prev) => ({ ...prev, ...statusMap }));
      setFriendRowIdMap((prev) => ({ ...prev, ...rowIdMap }));
    } catch (err) {
      console.error('Error loading friend relations:', err);
      setRelationsError('Could not load your friends. Please try again.');
    } finally {
      setIsLoadingRelations(false);
    }
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      runSearch(query.trim());
    }, 350);

    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, currentUserId]);

  const runSearch = async (term) => {
    if (!currentUserId) return;

    setIsSearching(true);
    setHasSearched(true);
    setSearchError('');

    try {
      const { data, error: searchErr } = await supabase
        .from('profiles')
        .select('user_id, username, avatar_url, created_at')
        .ilike('username', `%${term}%`)
        .neq('user_id', currentUserId)
        .limit(20);

      if (searchErr) throw searchErr;

      const profiles = data || [];
      const otherIds = profiles.map((p) => p.user_id);
      const averageScoresById = await fetchAverageFocusScores(otherIds);

      setResults(
        profiles.map((p) => ({
          ...p,
          averageFocusScore: averageScoresById[p.user_id] ?? null,
        }))
      );

      if (otherIds.length > 0) {
        const { data: friendRows, error: friendError } = await supabase
          .from('friends')
          .select('id, requester_id, addressee_id, status')
          .or(
            otherIds
              .map(
                (id) =>
                  `and(requester_id.eq.${currentUserId},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${currentUserId})`
              )
              .join(',')
          );

        if (friendError) {
          console.error('Error fetching friend statuses:', friendError);
        } else {
          const statusMap = {};
          const rowIdMap = {};
          (friendRows || []).forEach((row) => {
            const otherId = row.requester_id === currentUserId ? row.addressee_id : row.requester_id;
            rowIdMap[otherId] = row.id;
            if (row.status === 'accepted') {
              statusMap[otherId] = 'friends';
            } else if (row.status === 'pending') {
              statusMap[otherId] = row.requester_id === currentUserId ? 'pending_sent' : 'pending_received';
            }
          });
          setFriendStatusMap((prev) => ({ ...prev, ...statusMap }));
          setFriendRowIdMap((prev) => ({ ...prev, ...rowIdMap }));
        }
      }
    } catch (err) {
      console.error('Error searching users:', err);
      setSearchError('Could not search users. Please try again.');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddFriend = async (targetUserId) => {
    if (!currentUserId) return;
    setActioningId(targetUserId);

    try {
      const { data, error: insertError } = await supabase
        .from('friends')
        .insert({ requester_id: currentUserId, addressee_id: targetUserId, status: 'pending' })
        .select('id')
        .single();

      if (insertError) throw insertError;

      setFriendStatusMap((prev) => ({ ...prev, [targetUserId]: 'pending_sent' }));
      setFriendRowIdMap((prev) => ({ ...prev, [targetUserId]: data.id }));
    } catch (err) {
      console.error('Failed to send friend request:', err);
      alert('Could not send friend request. Please try again.');
    } finally {
      setActioningId(null);
    }
  };

  const handleCancelRequest = async (targetUserId) => {
    const friendRowId = friendRowIdMap[targetUserId];
    if (!friendRowId) return;
    setActioningId(targetUserId);

    try {
      const { data: deletedRows, error: deleteError } = await supabase
        .from('friends')
        .delete()
        .eq('id', friendRowId)
        .select('id');

      if (deleteError) throw deleteError;
      if (!deletedRows || deletedRows.length === 0) {
        throw new Error('Delete affected 0 rows — likely blocked by RLS policy.');
      }

      setFriendStatusMap((prev) => ({ ...prev, [targetUserId]: 'none' }));
      setFriendRowIdMap((prev) => {
        const next = { ...prev };
        delete next[targetUserId];
        return next;
      });
    } catch (err) {
      console.error('Failed to cancel friend request:', err);
      alert('Could not cancel the request. Please try again.');
    } finally {
      setActioningId(null);
    }
  };

  const handleAcceptRequest = async (requesterUserId, friendRowId) => {
    setActioningId(requesterUserId);

    try {
      const { error: updateError } = await supabase
        .from('friends')
        .update({ status: 'accepted' })
        .eq('id', friendRowId);

      if (updateError) throw updateError;

      setFriendStatusMap((prev) => ({ ...prev, [requesterUserId]: 'friends' }));
      setIncomingRequests((prev) => prev.filter((r) => r.user_id !== requesterUserId));
      setFriendsList((prev) => {
        const already = prev.some((f) => f.user_id === requesterUserId);
        if (already) return prev;
        const fromIncoming = incomingRequests.find((r) => r.user_id === requesterUserId);
        return fromIncoming ? [...prev, fromIncoming] : prev;
      });
    } catch (err) {
      console.error('Failed to accept friend request:', err);
      alert('Could not accept the request. Please try again.');
    } finally {
      setActioningId(null);
    }
  };

  const handleDeclineRequest = async (requesterUserId, friendRowId) => {
    setActioningId(requesterUserId);

    try {
      const { data: deletedRows, error: deleteError } = await supabase
        .from('friends')
        .delete()
        .eq('id', friendRowId)
        .select('id');

      if (deleteError) throw deleteError;
      if (!deletedRows || deletedRows.length === 0) {
        throw new Error('Delete affected 0 rows — likely blocked by RLS policy.');
      }

      setFriendStatusMap((prev) => {
        const next = { ...prev };
        delete next[requesterUserId];
        return next;
      });
      setIncomingRequests((prev) => prev.filter((r) => r.user_id !== requesterUserId));
    } catch (err) {
      console.error('Failed to decline friend request:', err);
      alert('Could not decline the request. Please try again.');
    } finally {
      setActioningId(null);
    }
  };

  const handleUnfriend = async (targetUserId) => {
    console.log('[Friends] handleUnfriend called for', targetUserId);

    const friendRowId = friendRowIdMap[targetUserId];
    if (!friendRowId) {
      console.warn('[Friends] No friend row id found for', targetUserId, friendRowIdMap);
      return;
    }

    setActioningId(targetUserId);
    setConfirmingUnfriendId(null);

    try {
      const { data: deletedRows, error: deleteError } = await supabase
        .from('friends')
        .delete()
        .eq('id', friendRowId)
        .select('id');

      console.log('[Friends] unfriend delete result:', { deletedRows, deleteError });

      if (deleteError) throw deleteError;

      // Supabase/Postgrest does not error on a 0-row delete — if RLS silently
      // blocked it (or the row was already gone), deletedRows will be empty.
      if (!deletedRows || deletedRows.length === 0) {
        throw new Error('Delete affected 0 rows — likely blocked by RLS policy.');
      }

      setFriendStatusMap((prev) => ({ ...prev, [targetUserId]: 'none' }));
      setFriendRowIdMap((prev) => {
        const next = { ...prev };
        delete next[targetUserId];
        return next;
      });
      setFriendsList((prev) => prev.filter((f) => f.user_id !== targetUserId));
    } catch (err) {
      console.error('Failed to unfriend:', err);
      alert('Could not remove this friend. Please try again.');
    } finally {
      setActioningId(null);
    }
  };

  const renderActionButton = (profile) => {
    const status = friendStatusMap[profile.user_id] || 'none';
    const isActioning = actioningId === profile.user_id;

    if (status === 'friends') {
      if (confirmingUnfriendId === profile.user_id) {
        return (
          <div className="flex gap-2">
            <button
              onClick={() => handleUnfriend(profile.user_id)}
              disabled={isActioning}
              className="flex-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-md py-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isActioning ? 'Removing...' : 'Confirm Unfriend'}
            </button>
            <button
              onClick={() => setConfirmingUnfriendId(null)}
              disabled={isActioning}
              className="flex-1 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md py-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        );
      }

      return (
        <button
          onClick={() => setConfirmingUnfriendId(profile.user_id)}
          disabled={isActioning}
          className="w-full text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-md py-2 transition-colors cursor-pointer disabled:opacity-50"
        >
          Unfriend
        </button>
      );
    }

    if (status === 'pending_sent') {
      return (
        <button
          onClick={() => handleCancelRequest(profile.user_id)}
          disabled={isActioning}
          className="w-full text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-md py-2 transition-colors cursor-pointer disabled:opacity-50"
        >
          {isActioning ? 'Cancelling...' : 'Cancel Request'}
        </button>
      );
    }

    if (status === 'pending_received') {
      const friendRowId = friendRowIdMap[profile.user_id];
      return (
        <div className="flex gap-2">
          <button
            onClick={() => handleAcceptRequest(profile.user_id, friendRowId)}
            disabled={isActioning}
            className="flex-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md py-2 transition-colors cursor-pointer disabled:opacity-50"
          >
            Accept
          </button>
          <button
            onClick={() => handleDeclineRequest(profile.user_id, friendRowId)}
            disabled={isActioning}
            className="flex-1 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md py-2 transition-colors cursor-pointer disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      );
    }

    return (
      <button
        onClick={() => handleAddFriend(profile.user_id)}
        disabled={isActioning}
        className="w-full text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md py-2 transition-colors cursor-pointer disabled:opacity-50"
      >
        {isActioning ? 'Sending...' : 'Add Friend'}
      </button>
    );
  };

  return (
    <div className="mb-8">
      <h1 className="mt-2 text-3xl font-semibold pb-6 text-slate-900">Friends</h1>

      {relationsError && (
        <div className="mb-6 text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2 max-w-md">
          {relationsError}
        </div>
      )}

      {/* --- Incoming Friend Requests --- */}
      {!isLoadingRelations && incomingRequests.length > 0 && (
        <div className="mb-10">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            Friend Requests <span className="text-sm font-normal text-slate-500">({incomingRequests.length})</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {incomingRequests.map((profile) => (
              <ProfileActionCard key={profile.user_id} profile={profile} navigate={navigate}>
                {renderActionButton(profile)}
              </ProfileActionCard>
            ))}
          </div>
        </div>
      )}

      {/* --- Search --- */}
      <div className="max-w-md mb-8">
        <div className="relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search usernames..."
            className="w-full pl-10 pr-4 py-3 rounded-sm border border-[#D0D7DE] bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 shadow-sm"
          />
        </div>
      </div>

      {searchError && (
        <div className="mb-6 text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2 max-w-md">
          {searchError}
        </div>
      )}

      {isSearching && <p className="text-sm text-slate-500">Searching...</p>}

      {!isSearching && hasSearched && results.length === 0 && (
        <p className="text-sm text-slate-500">No users found matching "{query}".</p>
      )}

      {hasSearched && results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
          {results.map((profile) => (
            <ProfileActionCard key={profile.user_id} profile={profile} navigate={navigate}>
              {renderActionButton(profile)}
            </ProfileActionCard>
          ))}
        </div>
      )}

      {/* --- Your Friends --- */}
      {!query.trim() && (
        <div>
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            Your Friends {!isLoadingRelations && <span className="text-sm font-normal text-slate-500">({friendsList.length})</span>}
          </h2>

          {isLoadingRelations && <p className="text-sm text-slate-500">Loading your friends...</p>}

          {!isLoadingRelations && friendsList.length === 0 && (
            <p className="text-sm text-slate-500">
              You haven't added any friends yet. Search for a username above to get started.
            </p>
          )}

          {!isLoadingRelations && friendsList.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {friendsList.map((profile) => (
                <ProfileActionCard key={profile.user_id} profile={profile} navigate={navigate}>
                  {renderActionButton(profile)}
                </ProfileActionCard>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}