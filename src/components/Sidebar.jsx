import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import {
  LayoutDashboard,
  Search,
  Utensils,
  Target,
  BarChart3,
  MessageSquare,
  LogOut,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

export default function Sidebar({ user, isCollapsed, setIsCollapsed }) {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);

  const mainNavItems = [
    { name: "Dashboard", path: "/", icon: LayoutDashboard },
    { name: "Food Search", path: "/search", icon: Search },
    { name: "Meal Tracker", path: "/tracker", icon: Utensils },
  ];

  const insightsNavItems = [
    { name: "Analytics", path: "/analytics", icon: BarChart3 },
    { name: "Goals & Profile", path: "/goals", icon: Target },
  ];

  const supportNavItems = [
    { name: "Feedback", path: "/feedback", icon: MessageSquare },
  ];

  const getInitials = (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const renderNavItem = (item) => (
    <NavLink
      key={item.path}
      to={item.path}
      end={item.path === '/'}
      title={isCollapsed ? item.name : undefined}
      className={({ isActive }) =>
        `relative flex items-center ${isCollapsed ? 'justify-center px-0' : 'gap-3 px-4'} py-3 rounded-xl text-sm font-medium transition-all duration-300 ${
          isActive ? 'text-white' : 'text-slate-400 hover:text-white hover:bg-white/[0.03]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.div
              layoutId="activeNavBg"
              className="absolute inset-0 bg-gradient-to-r from-accent-purple/15 to-accent-teal/5 border border-accent-purple/20 rounded-xl"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
          <item.icon className={`w-5 h-5 relative z-10 shrink-0 transition-colors duration-300 ${isActive ? 'text-accent-teal' : 'opacity-70'}`} />
          {!isCollapsed && (
            <span className="relative z-10 whitespace-nowrap">{item.name}</span>
          )}
        </>
      )}
    </NavLink>
  );

  return (
    <aside className={`${isCollapsed ? 'w-20 px-3' : 'w-64 px-6'} h-screen fixed top-0 left-0 bg-[#11131a]/40 border-r border-white/[0.06] backdrop-blur-xl flex flex-col py-6 z-40 transition-all duration-300 ease-in-out`}>
      <button 
        onClick={toggleSidebar} 
        className="absolute -right-3.5 top-8 w-7 h-7 bg-[#11131a] border border-white/[0.1] rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors z-50 shadow-md"
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* Brand Logo */}
      <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} pb-8 mb-6 border-b border-white/[0.06]`}>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-purple to-accent-teal flex items-center justify-center shadow-lg shadow-accent-purple/20 shrink-0">
          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2C6.5 6 4 10.5 4 14a8 8 0 0 0 16 0c0-3.5-2.5-8-8-12Z"/>
            <path d="M12 22c-2.2 0-4-1.8-4-4 0-2 1.5-4.5 4-7 2.5 2.5 4 5 4 7 0 2.2-1.8 4-4 4Z" opacity="0.6"/>
          </svg>
        </div>
        {!isCollapsed && (
          <h2 className="text-lg font-bold bg-gradient-to-r from-white to-accent-teal bg-clip-text text-transparent tracking-tight whitespace-nowrap">NutriTrack</h2>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto overflow-x-hidden no-scrollbar">
        {/* Main Section */}
        {!isCollapsed && <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-3 mb-2">Main</span>}
        {isCollapsed && <div className="h-2" />}
        {mainNavItems.map(renderNavItem)}

        {/* Insights Section */}
        {!isCollapsed && <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-3 mt-5 mb-2">Insights</span>}
        {isCollapsed && <div className="h-6" />}
        {insightsNavItems.map(renderNavItem)}

        {/* Support Section */}
        {!isCollapsed && <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-3 mt-5 mb-2">Support</span>}
        {isCollapsed && <div className="h-6" />}
        {supportNavItems.map(renderNavItem)}
      </nav>

      {/* User Footer */}
      <div className={`pt-6 border-t border-white/[0.06] mt-auto flex flex-col gap-4 ${isCollapsed ? 'items-center' : ''}`}>
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center px-0' : 'px-2'}`}>
          {user?.photoURL ? (
            <img src={user.photoURL} alt="Profile" className="w-10 h-10 rounded-full object-cover border border-white/10 shrink-0" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-purple to-accent-pink flex items-center justify-center text-sm font-semibold text-white shrink-0">
              {getInitials(user?.displayName)}
            </div>
          )}
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{user?.displayName || 'NutriTrack User'}</p>
              <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
            </div>
          )}
        </div>

        <button
          onClick={handleSignOut}
          title={isCollapsed ? "Sign Out" : undefined}
          className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold transition-colors duration-200 ${isCollapsed ? 'px-0' : ''}`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!isCollapsed && <span>Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}
