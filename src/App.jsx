import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Feed from './components/Feed';
import Profile from './components/Profile';
import UserProfile from './components/UserProfile';
import Friends from './components/Friends';
import UpcomingEvents from './components/UpcomingEvents';
import AuthPage from './AuthPage';
import { Analytics } from './components/Analytics';
import * as GroupsModule from './components/Groups';
import GroupDetail from './components/GroupDetail';
import { History } from './components/History';
import FocusSession from './components/FocusSession';
import { supabase } from './lib/supabaseClient';

const Groups = GroupsModule.default ?? GroupsModule.Groups;

function Layout({ session, onSignOut }) {
  const [focusModeActive, setFocusModeActive] = useState(false);

  const handleStartFocus = () => {
    setFocusModeActive(true);
  };

  const handleStopFocus = () => {
    setFocusModeActive(false);
  };

  // When focus mode is active, replace the whole layout with the focus screen
  if (focusModeActive) {
    return <FocusSession onStopFocus={handleStopFocus} />;
  }

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
        <div
          className="grid max-w-7xl mx-auto gap-10 items-start grid-cols-1 xl:grid-cols-[minmax(0,1fr)_18rem]"
        >
          <div className="min-w-0">
            <Routes>
              <Route path="/" element={<Feed />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/:userId" element={<UserProfile />} />
              <Route path="/friends" element={<Friends />} />
              <Route path="/history" element={<History session={session} />} />
              <Route path="/analytics" element={<Analytics session={session} />} />
              <Route path="/groups" element={<Groups session={session} />} />
              <Route path="/groups/:groupId" element={<GroupDetail session={session} />} />
            </Routes>
          </div>

          <div className="hidden xl:block pt-2">
            <UpcomingEvents />
          </div>
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