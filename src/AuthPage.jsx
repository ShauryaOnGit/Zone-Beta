import { useState } from 'react';
import { supabase } from './lib/supabaseClient';

export default function AuthPage({ onSignedIn }) {
  const [view, setView] = useState('signup');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const resetMessages = () => {
    setError('');
    setMessage('');
  };

  const handleSignUp = async () => {
    resetMessages();
    if (!username.trim()) {
      setError('Pick a username.');
      return;
    }

    setLoading(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username: username.trim() },
      },
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message || 'Something went wrong creating your account.');
      return;
    }

    if (data?.session) {
      onSignedIn(data.session);
      return;
    }

    setMessage('A confirmation link has been sent to your email. After verifying, sign in to continue.');
    setView('signin');
  };

  const handleSignIn = async () => {
    resetMessages();
    setLoading(true);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message || 'Something went wrong signing you in.');
      return;
    }

    if (data?.session) {
      onSignedIn(data.session);
    }
  };

  const handleSubmit = () => (view === 'signup' ? handleSignUp() : handleSignIn());

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 px-4">
      <div className="w-full max-w-sm">
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
          {message && (
            <div className="mb-4 text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              {message}
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
              disabled={loading || !email || !password || (view === 'signup' && !username.trim())}
              className="w-full mt-1 bg-blue-600 hover:cursor-pointer hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg py-2.5 shadow-sm transition-colors"
            >
              {loading ? 'Please wait...' : view === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </div>
        </div>

        <p className="text-center text-sm text-slate-500 mt-5">
          {view === 'signup' ? (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setView('signin');
                  resetMessages();
                }}
                className="font-semibold text-blue-600 hover:text-blue-700 hover:cursor-pointer"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setView('signup');
                  resetMessages();
                }}
                className="font-semibold text-blue-600 hover:cursor-pointer hover:text-blue-700"
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