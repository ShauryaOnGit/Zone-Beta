// src/App.jsx
import { useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Feed from './components/Feed';
import Calendar from './components/Calendar';
import UpcomingEvents from './components/UpcomingEvents';

function Layout() {
  const location = useLocation();
  const showSidebar = location.pathname !== '/groups';

  // Restored Focus Session State
  const [focusModeActive, setFocusModeActive] = useState(false);

  const handleStartFocus = () => {
    // Add your python backend fetch logic here if needed
    setFocusModeActive(true);
  };

  const handleStopFocus = () => {
    // Add your python backend fetch logic here if needed
    setFocusModeActive(false);
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      <Sidebar 
        focusModeActive={focusModeActive} 
        onStartFocus={handleStartFocus} 
        onStopFocus={handleStopFocus} 
      />
      <main className="flex-1 overflow-y-auto p-10">
        <div className="flex gap-10 max-w-7xl mx-auto">
          <div className="flex-1">
            <Routes>
              <Route path="/" element={<Feed />} />
              <Route path="/calendar" element={<Calendar />} />
            </Routes>
          </div>
          {showSidebar && <UpcomingEvents />}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}