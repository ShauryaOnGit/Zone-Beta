import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import ZoneLogo from './ZoneLogo';

export default function Sidebar({ focusModeActive, onStartFocus, onStopFocus, onSignOut, user }) {
  const displayName = user?.user_metadata?.username || user?.username || 'Guest';

  useEffect(() => {
    const handlePinnedTaskFocusRequest = () => {
      // UpcomingEvents has already placed the task title in sessionStorage.
      // Reuse the same app-level opener as the normal "Start Focus Session" button.
      if (!focusModeActive) {
        onStartFocus?.();
      }
    };

    window.addEventListener('zone:start-focus-request', handlePinnedTaskFocusRequest);
    return () => {
      window.removeEventListener('zone:start-focus-request', handlePinnedTaskFocusRequest);
    };
  }, [focusModeActive, onStartFocus]);

  return (
    <aside className="w-72 h-screen bg-white border-r border-slate-100 p-6 flex flex-col justify-between">
      <div className="space-y-8">
        <div>
          <ZoneLogo animated={false} theme="light" size={20} />
          <p className="text-sm text-slate-500 mt-3">Signed in as <span className="font-semibold text-slate-700">{displayName}</span></p>
        </div>

        <nav className="space-y-1">
          <NavLink to="/" end className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md font-medium ${isActive ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
            Feed
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md font-medium ${isActive ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
            History
          </NavLink>
          <NavLink to="/friends" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md font-medium ${isActive ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
            Friends
          </NavLink>
          <NavLink to="/profile" end className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md font-medium ${isActive ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
            Profile
          </NavLink>
          <NavLink to="/analytics" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md font-medium ${isActive ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}
      >
        <span>Analytics</span>
        
      </NavLink>
        </nav>

        <button onClick={focusModeActive ? onStopFocus : onStartFocus} className={`w-full text-white cursor-pointer text-sm font-semibold py-3 px-4 rounded-md ${focusModeActive ? "bg-rose-600" : "bg-slate-900"}`}>
          {focusModeActive ? 'End Focus Session' : 'Start Focus Session'}
        </button>
      </div>

      <div className="space-y-3">
        <button
          onClick={onSignOut}
          className="w-full text-sm font-semibold cursor-pointer text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md py-3 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}