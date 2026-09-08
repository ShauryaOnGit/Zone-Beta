import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';



function getGroupInitial(name) {
  const value = String(name || '').trim();
  return value ? value[0].toUpperCase() : 'G';
}

function GroupAvatar({ group, size = 'md' }) {
  const sizeClass =
    size === 'sm'
      ? 'h-10 w-10 text-sm'
      : 'h-12 w-12 text-base';

  if (group?.avatar_url) {
    return (
      <img
        src={group.avatar_url}
        alt={`${group.name || 'Group'} profile`}
        className={`${sizeClass} shrink-0 rounded-full border border-[#D0D7DE] object-cover bg-slate-100`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full border border-[#D0D7DE] bg-slate-100 font-semibold text-slate-600`}
      aria-hidden="true"
    >
      {getGroupInitial(group?.name)}
    </div>
  );
}

function CreateGroupModal({
  onClose,
  onCreated,
  userId,
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const createGroup = async (event) => {
    event.preventDefault();

    const trimmed = name.trim();

    if (!trimmed || !userId) return;

    setSaving(true);
    setError('');

    try {
      const { data, error: insertError } =
        await supabase
          .from('groups')
          .insert({
            name: trimmed,
            owner_id: userId,
          })
          .select('id, name, owner_id, created_at, avatar_url, avatar_path')
          .single();

      if (insertError) throw insertError;

      onCreated(data);
    } catch (err) {
      console.error(
        'Failed to create group:',
        err
      );

      setError(
        err.message ||
          'Could not create the group.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"
      onMouseDown={onClose}
    >
      <form
        onSubmit={createGroup}
        onMouseDown={(event) =>
          event.stopPropagation()
        }
        className="w-full max-w-md rounded-md border border-[#D0D7DE] bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Create a group
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              You can invite friends after creating it.
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

        <label className="mt-6 block text-xs font-semibold text-slate-700">
          Group name
        </label>

        <input
          autoFocus
          value={name}
          maxLength={80}
          onChange={(event) =>
            setName(event.target.value)
          }
          placeholder="e.g. Design Study Group"
          className="mt-2 h-11 w-full rounded-md border border-[#D0D7DE] bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />

        {error && (
          <p className="mt-3 text-xs text-rose-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 rounded-md border border-[#D0D7DE] bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={
              saving || !name.trim()
            }
            className="h-10 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
          >
            {saving
              ? 'Creating...'
              : 'Create group'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Groups({ session }) {
  const navigate = useNavigate();

  const userId = session?.user?.id;

  const [groups, setGroups] = useState([]);
  const [invites, setInvites] = useState([]);

  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] =
    useState(false);

  const [actioningInvite, setActioningInvite] =
    useState(null);

  const [error, setError] = useState('');

  const loadGroups = useCallback(async () => {
    if (!userId) return;

    setLoading(true);
    setError('');

    try {
      const {
        data: memberships,
        error: membershipError,
      } = await supabase
        .from('group_members')
        .select('group_id, role, joined_at')
        .eq('user_id', userId);

      if (membershipError) {
        throw membershipError;
      }

      const membershipRows =
        memberships || [];

      const groupIds =
        membershipRows.map(
          (row) => row.group_id
        );

      let groupRows = [];
      let counts = {};

      if (groupIds.length > 0) {
        const {
          data,
          error: groupsError,
        } = await supabase
          .from('groups')
          .select(
            'id, name, owner_id, created_at, avatar_url, avatar_path'
          )
          .in('id', groupIds)
          .order('created_at', {
            ascending: false,
          });

        if (groupsError) throw groupsError;

        groupRows = data || [];

        const {
          data: memberRows,
          error: countError,
        } = await supabase
          .from('group_members')
          .select('group_id')
          .in('group_id', groupIds);

        if (countError) throw countError;

        (memberRows || []).forEach(
          (row) => {
            counts[row.group_id] =
              (counts[row.group_id] || 0) +
              1;
          }
        );
      }

      const membershipMap =
        Object.fromEntries(
          membershipRows.map((row) => [
            row.group_id,
            row,
          ])
        );

      setGroups(
        groupRows.map((group) => ({
          ...group,
          role:
            membershipMap[group.id]
              ?.role || 'member',
          memberCount:
            counts[group.id] || 1,
        }))
      );

      const {
        data: inviteRows,
        error: inviteError,
      } = await supabase
        .from('group_invites')
        .select(
          'id, group_id, inviter_id, created_at'
        )
        .eq('invitee_id', userId)
        .eq('status', 'pending')
        .order('created_at', {
          ascending: false,
        });

      if (inviteError) throw inviteError;

      const pending =
        inviteRows || [];

      if (pending.length === 0) {
        setInvites([]);
        return;
      }

      const invitedGroupIds = [
        ...new Set(
          pending.map(
            (invite) => invite.group_id
          )
        ),
      ];

      const {
        data: invitedGroups,
        error: invitedGroupsError,
      } = await supabase
        .from('groups')
        .select('id, name, avatar_url')
        .in('id', invitedGroupIds);

      if (invitedGroupsError) {
        throw invitedGroupsError;
      }

      const groupMap =
        Object.fromEntries(
          (invitedGroups || []).map(
            (group) => [
              group.id,
              group,
            ]
          )
        );

      const inviterIds = [
        ...new Set(
          pending.map(
            (invite) =>
              invite.inviter_id
          )
        ),
      ];

      let profileMap = {};

      if (inviterIds.length > 0) {
        const {
          data: profiles,
          error: profileError,
        } = await supabase
          .from('profiles')
          .select(
            'user_id, username, avatar_url'
          )
          .in('user_id', inviterIds);

        if (profileError) {
          throw profileError;
        }

        profileMap = Object.fromEntries(
          (profiles || []).map(
            (profile) => [
              profile.user_id,
              profile,
            ]
          )
        );
      }

      setInvites(
        pending.map((invite) => ({
          ...invite,
          group:
            groupMap[invite.group_id],
          inviter:
            profileMap[
              invite.inviter_id
            ],
        }))
      );
    } catch (err) {
      console.error(
        'Failed to load groups:',
        err
      );

      setError(
        'Could not load your groups.'
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!userId) return undefined;

    const channel = supabase
      .channel(
        `zone-group-invites-${userId}`
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_invites',
          filter: `invitee_id=eq.${userId}`,
        },
        () => {
          loadGroups();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadGroups, userId]);

  const acceptInvite = async (
    invite
  ) => {
    setActioningInvite(invite.id);

    try {
      const { error: rpcError } =
        await supabase.rpc(
          'zone_accept_group_invite',
          {
            p_invite_id: invite.id,
          }
        );

      if (rpcError) throw rpcError;

      await loadGroups();

      navigate(
        `/groups/${invite.group_id}`
      );
    } catch (err) {
      console.error(
        'Failed to accept invite:',
        err
      );

      setError(
        'Could not join that group.'
      );
    } finally {
      setActioningInvite(null);
    }
  };

  const declineInvite = async (
    invite
  ) => {
    setActioningInvite(invite.id);

    try {
      const { error: rpcError } =
        await supabase.rpc(
          'zone_decline_group_invite',
          {
            p_invite_id: invite.id,
          }
        );

      if (rpcError) throw rpcError;

      await loadGroups();
    } catch (err) {
      console.error(
        'Failed to decline invite:',
        err
      );

      setError(
        'Could not decline that invite.'
      );
    } finally {
      setActioningInvite(null);
    }
  };

  return (
    <div className="mb-8">
      <div className="flex items-end justify-between gap-6 pb-7">
        <div>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">
            Groups
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Focus alongside your friends in real time.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            setShowCreate(true)
          }
          className="h-10 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 cursor-pointer"
        >
          Create group
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {invites.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-baseline gap-2">
            <h2 className="text-xl font-semibold text-slate-900">
              Invites
            </h2>

            <span className="text-sm text-slate-400">
              ({invites.length})
            </span>
          </div>

          <div className="space-y-3">
            {invites.map((invite) => {
              const busy =
                actioningInvite ===
                invite.id;

              return (
                <div
                  key={invite.id}
                  className="flex items-center justify-between gap-5 rounded-md border border-[#D0D7DE] bg-white px-5 py-4 shadow-sm"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <GroupAvatar
                      group={invite.group}
                      size="sm"
                    />

                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">
                        {invite.group
                          ?.name ||
                          'Group'}
                      </p>

                      <p className="mt-1 text-sm text-slate-500">
                        {invite.inviter
                          ?.username ||
                          'A friend'}{' '}
                        invited you.
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        declineInvite(
                          invite
                        )
                      }
                      disabled={busy}
                      className="h-9 rounded-md border border-[#D0D7DE] bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                    >
                      Decline
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        acceptInvite(
                          invite
                        )
                      }
                      disabled={busy}
                      className="h-9 rounded-md bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                    >
                      {busy
                        ? 'Joining...'
                        : 'Join'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="mb-4 flex items-baseline gap-2">
          <h2 className="text-xl font-semibold text-slate-900">
            Your groups
          </h2>

          {!loading && (
            <span className="text-sm text-slate-400">
              ({groups.length})
            </span>
          )}
        </div>

        {loading && (
          <p className="text-sm text-slate-500">
            Loading groups...
          </p>
        )}

        {!loading &&
          groups.length === 0 && (
            <div className="rounded-md border border-[#D0D7DE] bg-white px-6 py-10 text-center shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">
                No groups yet
              </h3>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                Create one and invite your
                friends, or join when a
                friend sends you an invite.
              </p>
            </div>
          )}

        {!loading &&
          groups.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() =>
                    navigate(
                      `/groups/${group.id}`
                    )
                  }
                  className="flex items-center gap-4 rounded-md border border-[#D0D7DE] bg-white p-5 text-left shadow-sm transition-colors hover:bg-slate-50 cursor-pointer"
                >
                  <GroupAvatar group={group} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-slate-900">
                        {group.name}
                      </h3>
                    </div>

                    <p className="mt-1 text-sm text-slate-500">
                      {group.memberCount}{' '}
                      {group.memberCount ===
                      1
                        ? 'member'
                        : 'members'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
      </section>

      {showCreate && (
        <CreateGroupModal
          userId={userId}
          onClose={() =>
            setShowCreate(false)
          }
          onCreated={(group) => {
            setShowCreate(false);

            navigate(
              `/groups/${group.id}`
            );
          }}
        />
      )}
    </div>
  );
}