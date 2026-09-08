import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import ZoneLogo from './ZoneLogo';
import { supabase } from '../lib/supabaseClient';

function getInitials(name) {
  const value = String(name || '').trim();
  if (!value) return '?';

  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function SidebarLink({ to, end = false, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex h-10 items-center rounded-md px-3 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-slate-50 text-slate-900'
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
      {children}
    </p>
  );
}

export default function Sidebar({
  focusModeActive,
  onStartFocus,
  onStopFocus,
  onSignOut,
  user,
}) {
  const [sidebarProfile, setSidebarProfile] = useState(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const accountMenuRef = useRef(null);

  const displayName =
    sidebarProfile?.username ||
    user?.user_metadata?.username ||
    user?.username ||
    user?.email?.split('@')?.[0] ||
    'Guest';

  const avatarUrl =
    sidebarProfile?.avatar_url ||
    user?.user_metadata?.avatar_url ||
    user?.avatar_url ||
    null;

  useEffect(() => {
    const handlePinnedTaskFocusRequest = () => {
      if (!focusModeActive) {
        onStartFocus?.();
      }
    };

    window.addEventListener(
      'zone:start-focus-request',
      handlePinnedTaskFocusRequest
    );

    return () => {
      window.removeEventListener(
        'zone:start-focus-request',
        handlePinnedTaskFocusRequest
      );
    };
  }, [focusModeActive, onStartFocus]);

  useEffect(() => {
    const userId = user?.id;

    if (!userId) {
      setSidebarProfile(null);
      return;
    }

    let cancelled = false;

    const loadSidebarProfile = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Could not load sidebar profile:', error);
        return;
      }

      if (!cancelled) {
        setSidebarProfile(data || null);
      }
    };

    loadSidebarProfile();

    const channel = supabase
      .channel(`sidebar-profile-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setSidebarProfile((previous) => ({
            ...(previous || {}),
            ...(payload.new || {}),
          }));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target)
      ) {
        setShowAccountMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-slate-100 bg-white px-5 py-6">
      <div>
        <div className="px-2">
          <ZoneLogo animated={false} theme="light" size={20} />
        </div>

        <button
          type="button"
          onClick={focusModeActive ? onStopFocus : onStartFocus}
          className={`mt-6 h-11 w-full rounded-md px-4 text-sm font-semibold text-white transition-colors cursor-pointer ${
            focusModeActive
              ? 'bg-rose-600 hover:bg-rose-500'
              : 'bg-slate-900 hover:bg-slate-800'
          }`}
        >
          {focusModeActive ? 'End Focus Session' : 'Start Focusing'}
        </button>

        <nav className="mt-8 space-y-7">
          <div className="space-y-1.5">
            <SectionLabel>Work</SectionLabel>
            <div className="space-y-1">
              <SidebarLink to="/" end>
                Feed
              </SidebarLink>
              <SidebarLink to="/history">
                History
              </SidebarLink>
            </div>
          </div>

          <div className="space-y-1.5">
            <SectionLabel>Community</SectionLabel>
            <div className="space-y-1">
              <SidebarLink to="/friends">
                Friends
              </SidebarLink>
              <SidebarLink to="/groups">
                Groups
              </SidebarLink>
            </div>
          </div>

          <div className="space-y-1.5">
            <SectionLabel>Insights</SectionLabel>
            <div className="space-y-1">
              <SidebarLink to="/analytics">
                Analytics
              </SidebarLink>
            </div>
          </div>
        </nav>
      </div>

      <div
        ref={accountMenuRef}
        className="relative mt-auto border-t border-slate-200 pt-4"
      >
        {showAccountMenu && (
          <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 overflow-hidden rounded-md border border-[#D0D7DE] bg-white p-1 shadow-lg">
            <NavLink
              to="/profile"
              onClick={() => setShowAccountMenu(false)}
              className="flex h-10 items-center rounded-md px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              Profile
            </NavLink>

            <button
              type="button"
              onClick={() => {
                setShowAccountMenu(false);
                onSignOut?.();
              }}
              className="flex h-10 w-full items-center rounded-md px-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
            >
              Sign out
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowAccountMenu((previous) => !previous)}
          className="flex h-12 w-full items-center gap-3 rounded-md px-2 text-left cursor-pointer"
          aria-expanded={showAccountMenu}
          aria-label="Open account menu"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full border border-[#D0D7DE] bg-slate-100 object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#D0D7DE] bg-slate-100 text-[11px] font-semibold text-slate-600">
              {getInitials(displayName)}
            </div>
          )}

          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">
            {displayName}
          </span>

          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </span>
        </button>
      </div>
    </aside>
  );
}
