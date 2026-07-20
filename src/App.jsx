import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Feed from './components/Feed';
import Profile from './components/Profile';
import UpcomingEvents from './components/UpcomingEvents';
import AuthPage from './AuthPage';
import { supabase } from './lib/supabaseClient';

function Layout({ session, onSignOut }) {
  const location = useLocation();
  const showSidebar = location.pathname !== '/groups';
  const [focusModeActive, setFocusModeActive] = useState(false);

  const handleStartFocus = () => {
    setFocusModeActive(true);
  };

  const handleStopFocus = () => {
    setFocusModeActive(false);
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      <Sidebar
        focusModeActive={focusModeActive}
        onStartFocus={handleStartFocus}
        onStopFocus={handleStopFocus}
        onSignOut={onSignOut}
        user={session?.user}
      />
      <main className="flex-1 overflow-y-auto p-10">
        <div className="flex gap-10 max-w-7xl mx-auto">
          <div className="flex-1">
            <Routes>
              <Route path="/" element={<Feed />} />
              <Route path="/profile" element={<Profile />} />
            </Routes>
          </div>
          {showSidebar && <UpcomingEvents />}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();
      setSession(currentSession);
      setLoadingSession(false);
    };

    initAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((_, currentSession) => {
      setSession(currentSession);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (loadingSession) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 text-slate-700">
        Loading...
      </div>
    );
  }

  if (!session) {
    return <AuthPage onSignedIn={setSession} />;
  }

  return (
    <BrowserRouter>
      <Layout session={session} onSignOut={handleSignOut} />
    </BrowserRouter>
  );
}
