// src/components/UpcomingEvents.jsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import ConfirmModal from './ConfirmModal';

export default function UpcomingEvents() {
  const [userId, setUserId] = useState(null);
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIsLoading(false);
        return;
      }
      setUserId(session.user.id);

      const { data, error: fetchError } = await supabase
        .from('upcoming_events')
        .select('id, title, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('Error fetching upcoming events:', fetchError);
      } else {
        setEvents(data || []);
      }
      setIsLoading(false);
    };

    load();
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newTitle.trim() || !userId) return;

    setIsSaving(true);
    setError('');

    try {
      const { data, error: insertError } = await supabase
        .from('upcoming_events')
        .insert({ user_id: userId, title: newTitle.trim() })
        .select('id, title, created_at')
        .single();

      if (insertError) throw insertError;

      setEvents((prev) => [data, ...prev]);
      setNewTitle('');
      setIsAdding(false);
    } catch (err) {
      console.error('Failed to add event:', err);
      setError('Could not save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePinnedTaskClick = (title) => {
    const trimmedTitle = title?.trim();
    if (!trimmedTitle) return;

    try {
      sessionStorage.setItem('zone:pending-focus-goal', trimmedTitle);
    } catch (err) {
      console.warn('Could not store pinned task for FocusSession:', err);
    }

    window.dispatchEvent(
      new CustomEvent('zone:start-focus-request', { detail: { title: trimmedTitle } })
    );
  };

  const handleDelete = async (id) => {
    if (!id || isDeleting) return;

    setIsDeleting(true);
    setError('');

    try {
      const { error: deleteError } = await supabase
        .from('upcoming_events')
        .delete()
        .eq('id', id)
        .select('id');

      if (deleteError) throw deleteError;

      setEvents((prev) => prev.filter((ev) => ev.id !== id));
      setConfirmingDeleteId(null);
    } catch (err) {
      console.error('Failed to delete event:', err);
      setError('Could not delete. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-72 space-y-4">
      <div className="h-[38px] flex justify-between items-center">
        <h3 className="text-xl font-semibold">Pinned Tasks</h3>
        <button
          onClick={() => {
            setIsAdding((prev) => !prev);
            setError('');
          }}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-white hover:bg-white text-black border border-[#D0D7DE] transition-colors cursor-pointer"
          title="Add a quick note"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-white p-3 rounded-md border border-[#D0D7DE] space-y-2">
          <input
            type="text"
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="e.g. Finish reading chapter 4"
            className="w-full text-sm px-2.5 py-1.5 rounded-md border border-slate-200 focus:outline-none focus:border-slate-400"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSaving || !newTitle.trim()}
              className="flex-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md py-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setNewTitle('');
                setError('');
              }}
              className="flex-1 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md py-1.5 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading && (
        <p className="text-xs text-slate-500">Loading...</p>
      )}

      {!isLoading && events.length === 0 && !isAdding && (
        <p className="text-xs text-slate-500">
          Save tasks you do often and start them with one click.
        </p>
      )}

      {events.map((ev) => (
        <div
          key={ev.id}
          onClick={() => handlePinnedTaskClick(ev.title)}
          className="group bg-white p-4 rounded-md border border-[#D0D7DE] space-y-1 relative cursor-pointer hover:border-slate-400 hover:shadow-sm transition-all"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handlePinnedTaskClick(ev.title);
            }
          }}
          title={`Start a focus session with "${ev.title}"`}
        >
          <p className="font-bold text-sm pr-5">{ev.title}</p>
          <p className="text-xs text-slate-500">
            {new Date(ev.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </p>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingDeleteId(ev.id);
              }}
              className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-rose-600 cursor-pointer"
              title="Remove"
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
        </div>
      ))}

      {confirmingDeleteId && (
        <ConfirmModal
          title="Delete pinned task?"
          description="This pinned task will be permanently removed."
          confirmLabel="Delete task"
          busyLabel="Deleting..."
          busy={isDeleting}
          error={error}
          onConfirm={() => handleDelete(confirmingDeleteId)}
          onCancel={() => {
            setConfirmingDeleteId(null);
            setError('');
          }}
        />
      )}
    </div>
  );
}