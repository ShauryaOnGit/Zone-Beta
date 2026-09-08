import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  useNavigate,
  useParams,
} from 'react-router-dom';

import { supabase } from '../lib/supabaseClient';
import LiveGroupCard from './LiveGroupCard';
import ConfirmModal from './ConfirmModal';

const HEARTBEAT_STALE_AFTER_MS =
  45_000;

const GROUP_AVATAR_BUCKET = 'group_avatars';
const MAX_GROUP_AVATAR_BYTES = 5 * 1024 * 1024;

function getGroupInitial(name) {
  const value = String(name || '').trim();
  return value ? value[0].toUpperCase() : 'G';
}

function getUserInitials(name) {
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

function userInitialsAvatarDataUrl(name) {
  const initials = getUserInitials(name);

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

function GroupAvatar({
  group,
  editable = false,
  uploading = false,
  onPhotoChange,
}) {
  const avatar = group?.avatar_url ? (
    <img
      src={group.avatar_url}
      alt={`${group.name || 'Group'} profile`}
      className="h-16 w-16 rounded-full border border-[#D0D7DE] bg-slate-100 object-cover"
    />
  ) : (
    <div
      className="flex h-16 w-16 items-center justify-center rounded-full border border-[#D0D7DE] bg-slate-100 text-xl font-semibold text-slate-600"
      aria-hidden="true"
    >
      {getGroupInitial(group?.name)}
    </div>
  );

  if (!editable) {
    return (
      <div className="h-16 w-16 shrink-0">
        {avatar}
      </div>
    );
  }

  return (
    <div className="relative h-16 w-16 shrink-0 group">
      <label
        className={`relative block h-16 w-16 overflow-hidden rounded-full ${
          uploading
            ? 'cursor-wait'
            : 'cursor-pointer'
        }`}
        title={
          group?.avatar_url
            ? 'Change group photo'
            : 'Set group photo'
        }
      >
        {avatar}

        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/45 opacity-0 transition-opacity group-hover:opacity-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
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

        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/55">
            <span className="text-[10px] font-semibold text-white">
              ...
            </span>
          </div>
        )}

        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={uploading}
          onChange={(event) => {
            const file =
              event.target.files?.[0];

            event.target.value = '';

            if (file) {
              onPhotoChange?.(file);
            }
          }}
          className="hidden"
        />
      </label>
    </div>
  );
}

function InviteFriendsModal({
  groupId,
  currentUserId,
  memberIds,
  onClose,
}) {
  const [friends, setFriends] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [actioningId, setActioningId] =
    useState(null);

  const [error, setError] =
    useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');

      try {
        const {
          data: relationRows,
          error: relationError,
        } = await supabase
          .from('friends')
          .select(
            'requester_id, addressee_id, status'
          )
          .eq('status', 'accepted')
          .or(
            `requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`
          );

        if (relationError) {
          throw relationError;
        }

        const friendIds = [
          ...new Set(
            (relationRows || []).map(
              (row) =>
                row.requester_id ===
                currentUserId
                  ? row.addressee_id
                  : row.requester_id
            )
          ),
        ];

        if (friendIds.length === 0) {
          setFriends([]);
          return;
        }

        const {
          data: profiles,
          error: profileError,
        } = await supabase
          .from('profiles')
          .select(
            'user_id, username, avatar_url'
          )
          .in('user_id', friendIds);

        if (profileError) {
          throw profileError;
        }

        const {
          data: inviteRows,
          error: inviteError,
        } = await supabase
          .from('group_invites')
          .select('invitee_id')
          .eq('group_id', groupId)
          .eq('status', 'pending');

        if (inviteError) {
          throw inviteError;
        }

        const pendingIds = new Set(
          (inviteRows || []).map(
            (row) => row.invitee_id
          )
        );

        const memberSet =
          new Set(memberIds);

        setFriends(
          (profiles || [])
            .filter(
              (profile) =>
                !memberSet.has(
                  profile.user_id
                )
            )
            .map((profile) => ({
              ...profile,
              invited:
                pendingIds.has(
                  profile.user_id
                ),
            }))
        );
      } catch (err) {
        console.error(
          'Failed to load friends for invite:',
          err
        );

        setError(
          'Could not load your friends.'
        );
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [
    currentUserId,
    groupId,
    memberIds,
  ]);

  const sendInvite = async (
    friendId
  ) => {
    setActioningId(friendId);
    setError('');

    try {
      const { error: insertError } =
        await supabase
          .from('group_invites')
          .insert({
            group_id: groupId,
            inviter_id:
              currentUserId,
            invitee_id: friendId,
          });

      if (insertError) {
        throw insertError;
      }

      setFriends((previous) =>
        previous.map((friend) =>
          friend.user_id === friendId
            ? {
                ...friend,
                invited: true,
              }
            : friend
        )
      );
    } catch (err) {
      console.error(
        'Failed to invite friend:',
        err
      );

      setError(
        err.code === '23505'
          ? 'That friend is already invited.'
          : 'Could not send the invite.'
      );
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(event) =>
          event.stopPropagation()
        }
        className="max-h-[75vh] w-full max-w-lg overflow-hidden rounded-md border border-[#D0D7DE] bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Invite friends
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Only your accepted friends can
              be invited.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          >
            ×
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-4">
          {error && (
            <div className="mb-4 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          {loading && (
            <p className="px-2 py-4 text-sm text-slate-500">
              Loading friends...
            </p>
          )}

          {!loading &&
            friends.length === 0 && (
              <p className="px-2 py-4 text-sm text-slate-500">
                There are no friends left to
                invite.
              </p>
            )}

          <div className="space-y-1">
            {friends.map((friend) => (
              <div
                key={friend.user_id}
                className="flex items-center justify-between gap-4 rounded-md px-2 py-3 hover:bg-slate-50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <img
                    src={
                      friend.avatar_url ||
                      userInitialsAvatarDataUrl(
                        friend.username ||
                          'Zone user'
                      )
                    }
                    alt={
                      friend.username ||
                      'Zone user'
                    }
                    className="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover"
                  />

                  <p className="truncate text-sm font-semibold text-slate-800">
                    {friend.username ||
                      'Zone user'}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={
                    friend.invited ||
                    actioningId ===
                      friend.user_id
                  }
                  onClick={() =>
                    sendInvite(
                      friend.user_id
                    )
                  }
                  className="h-9 min-w-[74px] rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-400 cursor-pointer"
                >
                  {friend.invited
                    ? 'Invited'
                    : actioningId ===
                        friend.user_id
                      ? 'Sending...'
                      : 'Invite'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GroupDetail({
  session,
}) {
  const navigate = useNavigate();
  const { groupId } = useParams();

  const currentUserId =
    session?.user?.id;

  const [group, setGroup] =
    useState(null);

  const [members, setMembers] =
    useState([]);

  const [liveSessions, setLiveSessions] =
    useState({});

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const [showInvite, setShowInvite] =
    useState(false);

  const [showGroupMenu, setShowGroupMenu] =
    useState(false);

  const [showLeaveConfirm, setShowLeaveConfirm] =
    useState(false);

  const [leavingGroup, setLeavingGroup] =
    useState(false);

  const [leaveError, setLeaveError] =
    useState('');

  const [uploadingGroupPhoto, setUploadingGroupPhoto] =
    useState(false);

  const [photoError, setPhotoError] =
    useState('');

  const [cardColorError, setCardColorError] =
    useState('');

  const [now, setNow] = useState(
    Date.now()
  );

  const memberIds = useMemo(
    () =>
      members.map(
        (member) => member.user_id
      ),
    [members]
  );

  const isSessionLive = useCallback(
    (liveSession) => {
      if (!liveSession) return false;

      if (liveSession.ended_at) {
        return false;
      }

      const heartbeat = new Date(
        liveSession.last_heartbeat_at
      ).getTime();

      if (!Number.isFinite(heartbeat)) {
        return false;
      }

      return (
        now - heartbeat <
        HEARTBEAT_STALE_AFTER_MS
      );
    },
    [now]
  );

  const loadGroup = useCallback(
    async () => {
      if (!groupId || !currentUserId) {
        return;
      }

      setLoading(true);
      setError('');

      try {
        const {
          data: groupData,
          error: groupError,
        } = await supabase
          .from('groups')
          .select(
            'id, name, owner_id, created_at, avatar_url, avatar_path'
          )
          .eq('id', groupId)
          .single();

        if (groupError) {
          throw groupError;
        }

        const {
          data: memberRows,
          error: memberError,
        } = await supabase
          .from('group_members')
          .select(
            'user_id, role, joined_at'
          )
          .eq('group_id', groupId)
          .order('joined_at', {
            ascending: true,
          });

        if (memberError) {
          throw memberError;
        }

        const rows = memberRows || [];

        const ids = rows.map(
          (row) => row.user_id
        );

        let profileMap = {};

        if (ids.length > 0) {
          const {
            data: profiles,
            error: profileError,
          } = await supabase
            .from('profiles')
            .select(
              'user_id, username, avatar_url, group_card_color'
            )
            .in('user_id', ids);

          if (profileError) {
            throw profileError;
          }

          profileMap =
            Object.fromEntries(
              (profiles || []).map(
                (profile) => [
                  profile.user_id,
                  profile,
                ]
              )
            );
        }

        setGroup(groupData);

        setMembers(
          rows.map((row) => ({
            ...row,
            ...(profileMap[
              row.user_id
            ] || {}),
          }))
        );

        if (ids.length > 0) {
          const {
            data: activeRows,
            error: activeError,
          } = await supabase
            .from(
              'live_focus_sessions'
            )
            .select(
              'id, user_id, task_name, started_at, ended_at, live_focus_score, last_heartbeat_at'
            )
            .in('user_id', ids)
            .is('ended_at', null)
            .order('started_at', {
              ascending: false,
            });

          if (activeError) {
            throw activeError;
          }

          const next = {};

          (activeRows || []).forEach(
            (row) => {
              if (!next[row.user_id]) {
                next[row.user_id] =
                  row;
              }
            }
          );

          setLiveSessions(next);
        } else {
          setLiveSessions({});
        }
      } catch (err) {
        console.error(
          'Failed to load group:',
          err
        );

        setError(
          'This group could not be loaded. You may no longer be a member.'
        );
      } finally {
        setLoading(false);
      }
    },
    [currentUserId, groupId]
  );

  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

  useEffect(() => {
    const interval = setInterval(
      () => setNow(Date.now()),
      5_000
    );

    return () =>
      clearInterval(interval);
  }, []);

  useEffect(() => {
    if (
      !currentUserId ||
      memberIds.length === 0
    ) {
      return undefined;
    }

    const visibleMemberIds =
      new Set(memberIds);

    const channel = supabase
      .channel(
        `zone-live-group-${groupId}`
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table:
            'live_focus_sessions',
        },
        (payload) => {
          const row = payload.new;

          if (
            !row?.user_id ||
            !visibleMemberIds.has(
              row.user_id
            )
          ) {
            return;
          }

          setLiveSessions(
            (previous) => {
              const next = {
                ...previous,
              };

              if (row.ended_at) {
                delete next[row.user_id];
              } else {
                next[row.user_id] =
                  row;
              }

              return next;
            }
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    currentUserId,
    groupId,
    memberIds,
  ]);

  const handleGroupPhotoUpload = async (file) => {
    if (
      !file ||
      !group?.id ||
      group.owner_id !== currentUserId ||
      uploadingGroupPhoto
    ) {
      return;
    }

    setPhotoError('');

    const allowedTypes = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);

    if (!allowedTypes.has(file.type)) {
      setPhotoError(
        'Use a JPG, PNG, WebP, or GIF image.'
      );
      return;
    }

    if (file.size > MAX_GROUP_AVATAR_BYTES) {
      setPhotoError(
        'Group photo must be 5 MB or smaller.'
      );
      return;
    }

    setUploadingGroupPhoto(true);

    const rawExtension =
      file.name
        ?.split('.')
        .pop()
        ?.toLowerCase() || 'jpg';

    const safeExtension =
      rawExtension.replace(
        /[^a-z0-9]/g,
        ''
      ) || 'jpg';

    const newPath =
      `${group.id}/avatar-${Date.now()}.${safeExtension}`;

    try {
      const { error: uploadError } =
        await supabase.storage
          .from(GROUP_AVATAR_BUCKET)
          .upload(newPath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType:
              file.type || undefined,
          });

      if (uploadError) {
        throw uploadError;
      }

      const { data: publicUrlData } =
        supabase.storage
          .from(GROUP_AVATAR_BUCKET)
          .getPublicUrl(newPath);

      const avatarUrl =
        publicUrlData?.publicUrl;

      if (!avatarUrl) {
        throw new Error(
          'Could not create the group photo URL.'
        );
      }

      const {
        data: updatedGroup,
        error: updateError,
      } = await supabase
        .from('groups')
        .update({
          avatar_url: avatarUrl,
          avatar_path: newPath,
        })
        .eq('id', group.id)
        .eq('owner_id', currentUserId)
        .select(
          'id, name, owner_id, created_at, avatar_url, avatar_path'
        )
        .single();

      if (updateError) {
        await supabase.storage
          .from(GROUP_AVATAR_BUCKET)
          .remove([newPath]);

        throw updateError;
      }

      const previousPath =
        group.avatar_path;

      setGroup(updatedGroup);

      if (
        previousPath &&
        previousPath !== newPath
      ) {
        const { error: removeOldError } =
          await supabase.storage
            .from(GROUP_AVATAR_BUCKET)
            .remove([previousPath]);

        if (removeOldError) {
          console.warn(
            'Could not remove previous group photo:',
            removeOldError
          );
        }
      }
    } catch (err) {
      console.error(
        'Failed to update group photo:',
        err
      );

      setPhotoError(
        err?.message ||
          'Could not update the group photo.'
      );
    } finally {
      setUploadingGroupPhoto(false);
    }
  };

  const handleOwnCardColorChange = async (
    colorKey
  ) => {
    if (!currentUserId) return;

    const ownMember =
      members.find(
        (member) =>
          member.user_id ===
          currentUserId
      );

    const previousColor =
      ownMember?.group_card_color ||
      null;

    setCardColorError('');

    setMembers((previous) =>
      previous.map((member) =>
        member.user_id ===
        currentUserId
          ? {
              ...member,
              group_card_color:
                colorKey,
            }
          : member
      )
    );

    try {
      const {
        data: updatedProfile,
        error: updateError,
      } = await supabase
        .from('profiles')
        .update({
          group_card_color:
            colorKey,
        })
        .eq(
          'user_id',
          currentUserId
        )
        .select(
          'user_id, group_card_color'
        )
        .single();

      if (updateError) {
        throw updateError;
      }

      if (!updatedProfile) {
        throw new Error(
          'Supabase did not save the card colour.'
        );
      }
    } catch (err) {
      console.error(
        'Failed to update group card colour:',
        err
      );

      setMembers((previous) =>
        previous.map((member) =>
          member.user_id ===
          currentUserId
            ? {
                ...member,
                group_card_color:
                  previousColor,
              }
            : member
        )
      );

      setCardColorError(
        'Could not save your card colour.'
      );
    }
  };

  const handleLeaveGroup = async () => {
    if (
      !group?.id ||
      !currentUserId ||
      leavingGroup
    ) {
      return;
    }

    setLeavingGroup(true);
    setLeaveError('');

    try {
      const {
        error: leaveGroupError,
      } = await supabase.rpc(
        'zone_leave_group',
        {
          p_group_id: group.id,
        }
      );

      if (leaveGroupError) {
        throw leaveGroupError;
      }

      setShowLeaveConfirm(false);
      setShowGroupMenu(false);

      navigate('/groups', {
        replace: true,
      });
    } catch (err) {
      console.error(
        'Failed to leave group:',
        err
      );

      setLeaveError(
        err?.message ||
          'Could not leave the group.'
      );
    } finally {
      setLeavingGroup(false);
    }
  };

  const orderedMembers = useMemo(() => {
    return [...members].sort(
      (a, b) => {
        const aLive = isSessionLive(
          liveSessions[a.user_id]
        );

        const bLive = isSessionLive(
          liveSessions[b.user_id]
        );

        if (aLive !== bLive) {
          return aLive ? -1 : 1;
        }

        return String(
          a.username || ''
        ).localeCompare(
          String(b.username || '')
        );
      }
    );
  }, [
    isSessionLive,
    liveSessions,
    members,
  ]);

  const liveCount = useMemo(
    () =>
      members.filter((member) =>
        isSessionLive(
          liveSessions[
            member.user_id
          ]
        )
      ).length,
    [
      isSessionLive,
      liveSessions,
      members,
    ]
  );

  if (loading) {
    return (
      <div className="py-6 text-sm text-slate-500">
        Loading group...
      </div>
    );
  }

  if (error || !group) {
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            navigate('/groups')
          }
          className="mb-5 text-sm font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
        >
          ← Groups
        </button>

        <div className="rounded-md border border-[#D0D7DE] bg-white p-6 text-sm text-slate-600">
          {error ||
            'Group not found.'}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-10">
      <button
        type="button"
        onClick={() =>
          navigate('/groups')
        }
        className="mb-5 text-sm font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
      >
        ← Groups
      </button>

      <div className="mb-8">
        <div className="flex items-end justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <GroupAvatar
              group={group}
              editable={
                group.owner_id ===
                currentUserId
              }
              uploading={
                uploadingGroupPhoto
              }
              onPhotoChange={
                handleGroupPhotoUpload
              }
            />

            <div className="min-w-0">
              <h1 className="truncate text-3xl font-semibold text-slate-900">
                {group.name}
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                {members.length}{' '}
                {members.length === 1
                  ? 'member'
                  : 'members'}{' '}
                ·{' '}
                <span className="font-medium text-slate-700">
                  {liveCount} focusing now
                </span>
              </p>
            </div>
          </div>

          <div className="flex h-10 shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setShowInvite(true)
              }
              className="h-10 rounded-md border border-[#D0D7DE] bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Invite friends
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setShowGroupMenu(
                    (previous) =>
                      !previous
                  )
                }
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-[#D0D7DE] bg-white text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
                aria-label="Group options"
                title="Group options"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
              </button>

              {showGroupMenu && (
                <>
                  <button
                    type="button"
                    aria-label="Close group menu"
                    onClick={() =>
                      setShowGroupMenu(false)
                    }
                    className="fixed inset-0 z-20 cursor-default"
                  />

                  <div className="absolute right-0 top-12 z-30 w-44 overflow-hidden rounded-md border border-[#D0D7DE] bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setShowGroupMenu(false);
                        setLeaveError('');
                        setShowLeaveConfirm(true);
                      }}
                      className="flex w-full items-center px-3 py-2.5 text-left text-sm font-medium text-rose-600 hover:bg-rose-50 cursor-pointer"
                    >
                      Leave group
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {photoError && (
          <p className="mt-3 text-sm text-rose-600">
            {photoError}
          </p>
        )}

        {cardColorError && (
          <p className="mt-3 text-sm text-rose-600">
            {cardColorError}
          </p>
        )}

        {leaveError && !showLeaveConfirm && (
          <p className="mt-3 text-sm text-rose-600">
            {leaveError}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-3">
        {orderedMembers.map(
          (member) => {
            const liveSession =
              liveSessions[
                member.user_id
              ];

            const live =
              isSessionLive(
                liveSession
              );

            return (
              <LiveGroupCard
                key={member.user_id}
                member={member}
                liveSession={
                  live
                    ? liveSession
                    : null
                }
                isLive={live}
                now={now}
                isOwnCard={
                  member.user_id ===
                  currentUserId
                }
                onColorChange={
                  member.user_id ===
                  currentUserId
                    ? handleOwnCardColorChange
                    : undefined
                }
                onUserClick={(
                  userId
                ) =>
                  navigate(
                    userId ===
                      currentUserId
                      ? '/profile'
                      : `/profile/${userId}`
                  )
                }
              />
            );
          }
        )}
      </div>

      {showLeaveConfirm && (
        <ConfirmModal
          title={`Leave ${group.name}?`}
          description={
            group.owner_id === currentUserId
              ? members.length > 1
                ? 'A remaining member will be chosen at random as the new owner. You will need another invite to rejoin.'
                : 'You are the last member, so the empty group will disappear after you leave.'
              : 'You will need another invite to rejoin this group.'
          }
          confirmLabel="Leave group"
          busyLabel="Leaving..."
          busy={leavingGroup}
          error={leaveError}
          onConfirm={handleLeaveGroup}
          onCancel={() => {
            setShowLeaveConfirm(false);
            setLeaveError('');
          }}
        />
      )}

      {showInvite && (
        <InviteFriendsModal
          groupId={group.id}
          currentUserId={
            currentUserId
          }
          memberIds={memberIds}
          onClose={() =>
            setShowInvite(false)
          }
        />
      )}
    </div>
  );
}