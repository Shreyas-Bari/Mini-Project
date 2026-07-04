import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import { motion } from 'framer-motion';
import { Menu } from 'lucide-react';

import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import Dashboard from './pages/Dashboard';
import FoodSearch from './pages/FoodSearch';
import MealTracker from './pages/MealTracker';
import Goals from './pages/Goals';
import Analytics from './pages/Analytics';
import Feedback from './pages/Feedback';

const getTodayDateString = () => new Date().toLocaleDateString('en-CA');

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeLogDate, setActiveLogDate] = useState(getTodayDateString);
  
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('nutritrack_sidebar_collapsed');
    return saved === 'true';
  });

  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('nutritrack_sidebar_collapsed', isCollapsed);
  }, [isCollapsed]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currUser) => {
      setUser(currUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center relative overflow-hidden">
        <div className="absolute w-[300px] h-[300px] rounded-full bg-accent-purple/10 blur-[100px] -top-20 animate-pulse" />
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-purple to-accent-teal flex items-center justify-center shadow-lg shadow-accent-purple/20 animate-pulse mb-4">
          <svg className="w-8 h-8 text-white animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeDashoffset="0"></circle>
          </svg>
        </div>
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest animate-pulse">Loading NutriTrack...</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route path="/signup" element={user ? <Navigate to="/" /> : <SignUp />} />

        <Route
          path="/*"
          element={
            user ? (
              <div className="min-h-screen bg-canvas text-slate-100 flex relative overflow-hidden">
                {/* Ambient floating orb — Top Left (indigo, brighter, drifting) */}
                <motion.div
                  className="fixed top-[-5%] left-[-5%] w-[600px] h-[600px] rounded-full bg-indigo-600/20 blur-[130px] mix-blend-screen pointer-events-none z-0"
                  animate={{
                    x: [0, 60, -40, 20, 0],
                    y: [0, -70, 40, -30, 0],
                    scale: [1, 1.08, 0.95, 1.03, 1],
                  }}
                  transition={{
                    duration: 20,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />
                {/* Ambient floating orb — Bottom Right (purple, drifting offset) */}
                <motion.div
                  className="fixed bottom-[-5%] right-[-5%] w-[500px] h-[500px] rounded-full bg-purple-600/15 blur-[120px] mix-blend-screen pointer-events-none z-0"
                  animate={{
                    x: [0, -50, 30, -20, 0],
                    y: [0, 50, -60, 25, 0],
                    scale: [1.05, 0.92, 1.1, 0.97, 1.05],
                  }}
                  transition={{
                    duration: 25,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />

                <Sidebar 
                  user={user} 
                  isCollapsed={isCollapsed} 
                  setIsCollapsed={setIsCollapsed} 
                  isMobileDrawerOpen={isMobileDrawerOpen}
                  setIsMobileDrawerOpen={setIsMobileDrawerOpen}
                />
                
                <div className={`flex-1 flex flex-col min-h-screen relative z-10 transition-all duration-300 ease-in-out ${isCollapsed ? 'md:ml-20' : 'md:ml-64'}`}>
                  {/* Mobile Top Header */}
                  <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#11131a]/80 backdrop-blur-xl sticky top-0 z-40">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-purple to-accent-teal flex items-center justify-center shadow-sm shrink-0">
                        <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 2C6.5 6 4 10.5 4 14a8 8 0 0 0 16 0c0-3.5-2.5-8-8-12Z"/>
                          <path d="M12 22c-2.2 0-4-1.8-4-4 0-2 1.5-4.5 4-7 2.5 2.5 4 5 4 7 0 2.2-1.8 4-4 4Z" opacity="0.6"/>
                        </svg>
                      </div>
                      <h2 className="text-base font-bold bg-gradient-to-r from-white to-accent-teal bg-clip-text text-transparent tracking-tight">NutriTrack</h2>
                    </div>
                    <button 
                      onClick={() => setIsMobileDrawerOpen(true)}
                      className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white active:bg-white/10 transition-colors"
                      aria-label="Open navigation menu"
                    >
                      <Menu className="w-5 h-5" />
                    </button>
                  </div>

                  <main className="flex-1 p-4 sm:p-6 md:p-8">
                    <Routes>
                      <Route path="/" element={<Dashboard user={user} />} />
                      <Route
                        path="/search"
                        element={<FoodSearch user={user} activeDate={activeLogDate} setActiveDate={setActiveLogDate} />}
                      />
                      <Route path="/tracker" element={<MealTracker user={user} />} />
                      <Route path="/goals" element={<Goals user={user} />} />
                      <Route path="/analytics" element={<Analytics user={user} />} />
                      <Route path="/feedback" element={<Feedback user={user} />} />
                      <Route path="*" element={<Navigate to="/" />} />
                    </Routes>
                  </main>
                </div>
              </div>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
