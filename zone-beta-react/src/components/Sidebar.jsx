import { NavLink } from 'react-router-dom';

export default function Sidebar({ focusModeActive, onStartFocus, onStopFocus }) {
  return (
    <aside className="w-72 h-screen bg-white border-r border-slate-100 p-6 flex flex-col justify-between">
      <div className="space-y-8">
        <h1 className="text-xl font-bold text-slate-900">ZoneBeta</h1>
        <nav className="space-y-1">
          <NavLink to="/" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-lg font-medium ${isActive ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>Home</NavLink>
          <NavLink to="/Calendar" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-lg font-medium ${isActive ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>Calendar</NavLink>
        </nav>
        <button onClick={focusModeActive ? onStopFocus : onStartFocus} className={`w-full text-white text-sm font-semibold py-3 px-4 rounded-xl ${focusModeActive ? "bg-rose-600" : "bg-slate-900"}`}>
          {focusModeActive ? "End Focus Session" : "Start Focus Session"}
        </button>
      </div>
    </aside>
  );
}