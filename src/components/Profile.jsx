// src/components/Profile.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        navigate('/auth');
        return;
      }

      setUser(session.user);

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('username, created_at')
        .eq('user_id', session.user.id)
        .single();

      if (profileError) {
        setError('Could not load your profile.');
      } else {
        setProfile(data);
      }

      setLoading(false);
    };

    loadProfile();
  }, [navigate]);

  if (loading) {
    return (
      <div className="bg-white rounded-sm border border-slate-200 p-6 shadow-sm">
        <p className="text-sm text-slate-500">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-sm border border-[#D0D7DE] p-6">
      <div className="mb-8">
        <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Profile</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Your account</h1>
        <p className="text-sm text-slate-500">View your account details below.</p>
      </div>

      {error && (
        <div className="mb-6 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="rounded-sm border border-[#D0D7DE] bg-slate-50 p-6 space-y-5 max-w-md shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Username</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{profile?.username || '—'}</p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Email</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{user?.email || '—'}</p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Member since</p>
          <p className="mt-1 text-sm text-slate-600">
            {profile?.created_at
              ? new Date(profile.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}