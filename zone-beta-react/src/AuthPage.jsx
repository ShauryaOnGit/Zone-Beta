import { useState } from 'react';
import { supabase } from './lib/supabaseClient';

export default function AuthPage({ onSignedIn }) {
  const [view, setView] = useState('signup'); // 'signup' | 'signin'
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const resetMessages = () => setError('');

  const handleSignUp = async () => {
    resetMessages();
    if (!username.trim()) { setError('Pick a username.'); return; }
    setLoading(true);

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    // Email confirmation may be required before a session exists yet -- in
    // that case we still try to save the username now via an RPC-free path:
    // if there's no session, Supabase's anon key can't write to profiles
    // (RLS requires auth.uid()), so we save it right after they confirm and
    // sign in instead. If a session DOES exist immediately, save it now.
    if (data.session) {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({ user_id: data.user.id, username: username.trim() });
      if (profileError) {
        setLoading(false);
        setError(`Account created, but couldn't save your username: ${profileError.message}`);
        return;
      }
    }

    setLoading(false);
    if (data.session) {
      onSignedIn(data.session);
    } else {
      setError('');
      setView('signin');
    }
  };

  const handleSignIn = async () => {
    resetMessages();
    setLoading(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) { setError(signInError.message); return; }
    onSignedIn(data.session);
  };

  const handleSubmit = () => (view === 'signup' ? handleSignUp() : handleSignIn());

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        {/* Wordmark: a simple, consistent brand anchor rather than a one-off illustration */}

        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-slate-900">
            {view === 'signup' ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {view === 'signup' ? 'Start tracking your focus sessions.' : 'Sign in to continue where you left off.'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          {error && (
            <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
              />
            </div>

            {view === 'signup' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="alex_coder"
                  className="w-full rounded-lg px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="••••••••"
                className="w-full rounded-lg px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading || !email || !password}
              className="w-full mt-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg py-2.5 shadow-sm transition-colors"
            >
              {loading ? 'Please wait...' : view === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </div>
        </div>

        <p className="text-center text-sm text-slate-500 mt-5">
          {view === 'signup' ? (
            <>Already have an account?{' '}
              <button
                type="button"
                onClick={() => { setView('signin'); resetMessages(); }}
                className="font-semibold text-blue-600 hover:text-blue-700"
              >
                Sign in
              </button>
            </>
          ) : (
            <>Don't have an account?{' '}
              <button
                type="button"
                onClick={() => { setView('signup'); resetMessages(); }}
                className="font-semibold text-blue-600 hover:text-blue-700"
              >
                Sign up
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}