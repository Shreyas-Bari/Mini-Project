import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../firebase';
import { collection, getDocs, query, orderBy, limit, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import GlassCard from '../components/GlassCard';
import {
  Users,
  ShieldCheck,
  Activity,
  Database,
  Utensils,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
  Globe,
  Server,
  Zap,
  Eye,
  XCircle,
  Filter,
  ArrowUpDown
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════
   ERROR BOUNDARY — Catches rendering errors in child components
   ══════════════════════════════════════════════════════════════ */
class AdminErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('AdminDashboard Error Boundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center text-center p-8">
          <div className="w-16 h-16 rounded-2xl bg-red-500/15 border border-red-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h3 className="text-xl font-extrabold text-white mb-2">Admin Panel Error</h3>
          <p className="text-sm text-slate-400 max-w-md mb-6">
            An unexpected error occurred while loading the admin panel. This does not affect user-facing features.
          </p>
          <p className="text-xs text-red-400/80 font-mono bg-red-500/5 border border-red-500/10 px-4 py-2 rounded-xl max-w-lg break-all mb-6">
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ══════════════════════════════════════════════════════════════
   METRIC CARD — Reusable stat block for the summary row
   ══════════════════════════════════════════════════════════════ */
function MetricCard({ label, value, subtext, icon: Icon, color, delay = 0 }) {
  const colorMap = {
    teal: { bg: 'bg-accent-teal/10', border: 'border-accent-teal/20', text: 'text-accent-teal', glow: 'shadow-accent-teal/5' },
    purple: { bg: 'bg-accent-purple/10', border: 'border-accent-purple/20', text: 'text-accent-purple', glow: 'shadow-accent-purple/5' },
    pink: { bg: 'bg-accent-pink/10', border: 'border-accent-pink/20', text: 'text-accent-pink', glow: 'shadow-accent-pink/5' },
    green: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', glow: 'shadow-emerald-500/5' },
    amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400', glow: 'shadow-amber-500/5' },
    blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', glow: 'shadow-blue-500/5' },
  };
  const c = colorMap[color] || colorMap.teal;

  return (
    <GlassCard className="!p-5" delay={delay} hover={true}>
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{label}</p>
          <p className="text-2xl font-black text-white leading-none">{value}</p>
          {subtext && <p className={`text-[10px] font-semibold mt-1.5 ${c.text}`}>{subtext}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center shadow-lg ${c.glow}`}>
          <Icon className={`w-5 h-5 ${c.text}`} />
        </div>
      </div>
    </GlassCard>
  );
}

/* ══════════════════════════════════════════════════════════════
   STATUS INDICATOR — Animated dot with label
   ══════════════════════════════════════════════════════════════ */
function StatusIndicator({ status, label }) {
  const statusStyles = {
    healthy: { dot: 'bg-emerald-400', ring: 'ring-emerald-400/30', text: 'text-emerald-400' },
    warning: { dot: 'bg-amber-400', ring: 'ring-amber-400/30', text: 'text-amber-400' },
    error: { dot: 'bg-red-400', ring: 'ring-red-400/30', text: 'text-red-400' },
  };
  const s = statusStyles[status] || statusStyles.healthy;

  return (
    <div className="flex items-center gap-2">
      <span className={`relative flex h-2.5 w-2.5`}>
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${s.dot} opacity-75`} />
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${s.dot} ring-2 ${s.ring}`} />
      </span>
      <span className={`text-xs font-bold uppercase tracking-wider ${s.text}`}>{label}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN ADMIN DASHBOARD COMPONENT
   ══════════════════════════════════════════════════════════════ */
function AdminDashboardContent({ user }) {
  // ── State ──
  const [users, setUsers] = useState([]);
  const [recentFeedback, setRecentFeedback] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingFeedback, setLoadingFeedback] = useState(true);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [feedbackFilter, setFeedbackFilter] = useState('all'); // 'all', 'bug', 'feature', 'general'
  const [userSortField, setUserSortField] = useState('createdAt'); // 'createdAt', 'displayName', 'role'
  const [userSortDir, setUserSortDir] = useState('desc');
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [systemHealth] = useState({
    firestore: 'healthy',
    auth: 'healthy',
    hosting: 'healthy',
    lastSync: new Date().toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  });

  // ── Data Fetching ──
  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      const list = [];
      snapshot.forEach((d) => {
        list.push({ uid: d.id, ...d.data() });
      });
      setUsers(list);
    } catch (err) {
      console.error('Error fetching users:', err);
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchFeedback = async () => {
    setLoadingFeedback(true);
    try {
      const feedbackRef = collection(db, 'feedback');
      const q = query(feedbackRef, orderBy('createdAt', 'desc'), limit(25));
      const snapshot = await getDocs(q);
      const list = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });
      setRecentFeedback(list);
    } catch (err) {
      console.error('Error fetching feedback:', err);
      setRecentFeedback([]);
    } finally {
      setLoadingFeedback(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchUsers(), fetchFeedback()]);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchUsers();
    fetchFeedback();
  }, []);

  // ── Derived Data ──
  const totalUsers = users.length;
  const adminCount = users.filter((u) => u.role === 'admin').length;
  const recentSignups = users.filter((u) => {
    if (!u.createdAt) return false;
    const created = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return created >= weekAgo;
  }).length;

  // Filtered & sorted users
  const filteredUsers = useMemo(() => {
    let result = [...users];

    // Search filter
    if (userSearchQuery.trim()) {
      const q = userSearchQuery.toLowerCase();
      result = result.filter(
        (u) =>
          (u.displayName || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.uid || '').toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      let aVal, bVal;
      if (userSortField === 'displayName') {
        aVal = (a.displayName || '').toLowerCase();
        bVal = (b.displayName || '').toLowerCase();
      } else if (userSortField === 'role') {
        aVal = a.role || 'user';
        bVal = b.role || 'user';
      } else {
        aVal = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        bVal = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      }
      if (aVal < bVal) return userSortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return userSortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [users, userSearchQuery, userSortField, userSortDir]);

  // Filtered feedback
  const filteredFeedback = useMemo(() => {
    if (feedbackFilter === 'all') return recentFeedback;
    return recentFeedback.filter((f) => (f.type || 'general').toLowerCase() === feedbackFilter);
  }, [recentFeedback, feedbackFilter]);

  const toggleSort = (field) => {
    if (userSortField === field) {
      setUserSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setUserSortField(field);
      setUserSortDir('asc');
    }
  };

  // ── Role badge helper ──
  const getRoleBadge = (role) => {
    if (role === 'admin') {
      return (
        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest bg-amber-500/15 text-amber-400 border border-amber-500/20">
          <ShieldCheck className="w-2.5 h-2.5" /> Admin
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest bg-accent-teal/10 text-accent-teal border border-accent-teal/20">
        <Users className="w-2.5 h-2.5" /> User
      </span>
    );
  };

  // ── Feedback type badge ──
  const getFeedbackBadge = (type) => {
    const styles = {
      bug: 'bg-red-500/10 text-red-400 border-red-500/20',
      feature: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      general: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    };
    const cls = styles[(type || 'general').toLowerCase()] || styles.general;
    return (
      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest border ${cls}`}>
        {type || 'General'}
      </span>
    );
  };

  return (
    <div className="space-y-8">
      {/* ── Page Header ── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Admin Dashboard</h1>
            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-full uppercase tracking-widest bg-amber-500/15 text-amber-400 border border-amber-500/20">
              <ShieldCheck className="w-3 h-3" /> Elevated Access
            </span>
          </div>
          <p className="text-slate-400 text-sm">System metrics, user management, and platform health monitoring</p>
        </div>

        <div className="flex items-center gap-3">
          <StatusIndicator status={systemHealth.firestore} label="Systems Online" />
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Metrics Summary Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Users"
          value={loadingUsers ? '—' : totalUsers}
          subtext={loadingUsers ? 'Loading...' : `${recentSignups} new this week`}
          icon={Users}
          color="teal"
          delay={0.05}
        />
        <MetricCard
          label="Admin Accounts"
          value={loadingUsers ? '—' : adminCount}
          subtext="Elevated privilege users"
          icon={ShieldCheck}
          color="amber"
          delay={0.1}
        />
        <MetricCard
          label="Feedback Entries"
          value={loadingFeedback ? '—' : recentFeedback.length}
          subtext="Latest 25 submissions"
          icon={Activity}
          color="purple"
          delay={0.15}
        />
        <MetricCard
          label="Database Health"
          value="Active"
          subtext={`Last sync: ${systemHealth.lastSync}`}
          icon={Database}
          color="green"
          delay={0.2}
        />
      </div>

      {/* ── System Health Panel ── */}
      <GlassCard className="!p-0 overflow-hidden" delay={0.25} hover={false}>
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-accent-teal" />
            <h2 className="text-sm font-extrabold text-white uppercase tracking-wider">Infrastructure Status</h2>
          </div>
          <span className="text-[10px] text-slate-500 font-semibold">Firebase Spark (Free Tier)</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.04]">
          {[
            { name: 'Firestore', status: systemHealth.firestore, icon: Database, desc: 'Document database for user data and logs' },
            { name: 'Authentication', status: systemHealth.auth, icon: ShieldCheck, desc: 'Firebase Auth with Google & Email providers' },
            { name: 'Hosting', status: systemHealth.hosting, icon: Globe, desc: 'Firebase Hosting serving the SPA bundle' },
          ].map((svc) => (
            <div key={svc.name} className="px-6 py-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center shrink-0">
                <svc.icon className="w-5 h-5 text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-white">{svc.name}</p>
                  <StatusIndicator status={svc.status} label={svc.status === 'healthy' ? 'OK' : svc.status} />
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">{svc.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* ── Main Content: Users + Feedback side by side ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* ── User Management Panel (8/12) ── */}
        <div className="xl:col-span-8">
          <GlassCard className="!p-0 overflow-hidden" delay={0.3} hover={false}>
            <div className="px-6 py-4 border-b border-white/[0.06]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-accent-purple" />
                  <h2 className="text-sm font-extrabold text-white uppercase tracking-wider">User Management</h2>
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    ({filteredUsers.length}{userSearchQuery ? ` of ${totalUsers}` : ''})
                  </span>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    className="w-full sm:w-56 bg-white/[0.03] border border-white/[0.08] focus:border-accent-purple focus:ring-1 focus:ring-accent-purple rounded-lg py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Sort controls */}
              <div className="flex items-center gap-2 mt-3">
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Sort:</span>
                {[
                  { field: 'createdAt', label: 'Date Joined' },
                  { field: 'displayName', label: 'Name' },
                  { field: 'role', label: 'Role' },
                ].map((s) => (
                  <button
                    key={s.field}
                    onClick={() => toggleSort(s.field)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      userSortField === s.field
                        ? 'bg-accent-purple/15 text-accent-purple border border-accent-purple/20'
                        : 'bg-white/[0.03] text-slate-500 border border-white/[0.06] hover:text-white'
                    }`}
                  >
                    {s.label}
                    {userSortField === s.field && (
                      <ArrowUpDown className="w-2.5 h-2.5" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* User list */}
            <div className="max-h-[480px] overflow-y-auto">
              {loadingUsers ? (
                <div className="py-16 flex flex-col items-center justify-center text-slate-500 text-xs">
                  <RefreshCw className="w-5 h-5 animate-spin mb-2" />
                  Loading user records...
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-center">
                  <Users className="w-8 h-8 text-slate-600 mb-2" />
                  <p className="text-sm text-slate-400 font-semibold">No users found</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {userSearchQuery ? 'Try a different search term' : 'No user documents in Firestore yet'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {filteredUsers.map((u) => {
                    const isExpanded = expandedUserId === u.uid;
                    const createdDate = u.createdAt?.toDate
                      ? u.createdAt.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                      : 'Unknown';
                    return (
                      <div key={u.uid}>
                        <button
                          onClick={() => setExpandedUserId(isExpanded ? null : u.uid)}
                          className="w-full px-6 py-3.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors text-left"
                        >
                          {/* Avatar */}
                          {u.photoURL ? (
                            <img src={u.photoURL} alt="" className="w-9 h-9 rounded-full object-cover border border-white/10 shrink-0" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent-purple to-accent-pink flex items-center justify-center text-xs font-bold text-white shrink-0">
                              {(u.displayName || 'U')[0].toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-bold text-white truncate">{u.displayName || 'Unnamed User'}</p>
                              {getRoleBadge(u.role)}
                            </div>
                            <p className="text-[11px] text-slate-500 truncate">{u.email || u.uid}</p>
                          </div>
                          <div className="text-right shrink-0 hidden sm:block">
                            <p className="text-[10px] text-slate-500 font-semibold">Joined</p>
                            <p className="text-[11px] text-slate-400 font-bold">{createdDate}</p>
                          </div>
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                          )}
                        </button>

                        {/* Expanded user details */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-6 pb-4 pt-1 ml-[52px]">
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11px]">
                                  <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-3">
                                    <p className="text-slate-500 font-semibold uppercase text-[9px] tracking-widest mb-1">UID</p>
                                    <p className="text-slate-300 font-mono truncate">{u.uid}</p>
                                  </div>
                                  <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-3">
                                    <p className="text-slate-500 font-semibold uppercase text-[9px] tracking-widest mb-1">Provider</p>
                                    <p className="text-slate-300">{u.provider || 'Email/Password'}</p>
                                  </div>
                                  <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-3">
                                    <p className="text-slate-500 font-semibold uppercase text-[9px] tracking-widest mb-1">Streak</p>
                                    <p className="text-slate-300">{u.currentStreak || 0} days</p>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </GlassCard>
        </div>

        {/* ── Feedback Feed Panel (4/12) ── */}
        <div className="xl:col-span-4">
          <GlassCard className="!p-0 overflow-hidden flex flex-col h-[calc(480px+110px)]" delay={0.35} hover={false}>
            <div className="px-5 py-4 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-accent-pink" />
                <h2 className="text-sm font-extrabold text-white uppercase tracking-wider">Feedback Feed</h2>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {['all', 'bug', 'feature', 'general'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setFeedbackFilter(type)}
                    className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-colors ${
                      feedbackFilter === type
                        ? 'bg-accent-pink/15 text-accent-pink border border-accent-pink/20'
                        : 'bg-white/[0.03] text-slate-500 border border-white/[0.06] hover:text-white'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingFeedback ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-500 text-xs">
                  <RefreshCw className="w-4 h-4 animate-spin mb-2" />
                  Loading feedback...
                </div>
              ) : filteredFeedback.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center px-4">
                  <Activity className="w-6 h-6 text-slate-600 mb-2" />
                  <p className="text-xs text-slate-400 font-semibold">No feedback entries</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {feedbackFilter !== 'all' ? `No "${feedbackFilter}" type feedback found` : 'Users have not submitted feedback yet'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {filteredFeedback.map((fb) => {
                    const submittedDate = fb.createdAt?.toDate
                      ? fb.createdAt.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                      : '—';
                    return (
                      <div key={fb.id} className="px-5 py-3.5 hover:bg-white/[0.02] transition-colors">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <p className="text-[11px] font-bold text-white truncate">{fb.userName || fb.userEmail || 'Anonymous'}</p>
                          {getFeedbackBadge(fb.type)}
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">{fb.message || 'No message'}</p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Clock className="w-2.5 h-2.5 text-slate-600" />
                          <span className="text-[9px] text-slate-600 font-semibold">{submittedDate}</span>
                          {fb.rating && (
                            <>
                              <span className="text-slate-700 mx-0.5">·</span>
                              <span className="text-[9px] text-amber-400 font-bold">★ {fb.rating}/5</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   EXPORTED WRAPPER — Error Boundary wraps the dashboard
   ══════════════════════════════════════════════════════════════ */
export default function AdminDashboard({ user }) {
  return (
    <AdminErrorBoundary>
      <AdminDashboardContent user={user} />
    </AdminErrorBoundary>
  );
}
