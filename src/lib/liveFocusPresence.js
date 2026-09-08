import { supabase } from './supabaseClient';

function unwrapRpcRow(data) {
  if (Array.isArray(data)) {
    return data[0] ?? null;
  }

  return data ?? null;
}

export async function startLiveFocusPresence(taskName) {
  const { data, error } = await supabase.rpc(
    'zone_start_live_focus',
    {
      p_task_name: taskName,
    }
  );

  if (error) throw error;

  return unwrapRpcRow(data);
}

export async function updateLiveFocusPresence(
  sessionId,
  focusScore = null
) {
  if (!sessionId) return;

  const { error } = await supabase.rpc(
    'zone_update_live_focus',
    {
      p_session_id: sessionId,
      p_focus_score:
        Number.isFinite(Number(focusScore))
          ? Number(focusScore)
          : null,
    }
  );

  if (error) throw error;
}

export async function endLiveFocusPresence(
  sessionId,
  focusScore = null
) {
  if (!sessionId) return;

  const { error } = await supabase.rpc(
    'zone_end_live_focus',
    {
      p_session_id: sessionId,
      p_focus_score:
        Number.isFinite(Number(focusScore))
          ? Number(focusScore)
          : null,
    }
  );

  if (error) throw error;
}