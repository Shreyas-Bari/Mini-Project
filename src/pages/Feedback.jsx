import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import GlassCard from '../components/GlassCard';
import {
  MessageSquare,
  Send,
  Bug,
  Lightbulb,
  MessageCircle,
  Clock,
  CheckCircle,
  AlertCircle,
  Sparkles,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

/* ──────────────────────────────────────────────
   Feedback category configuration
   ────────────────────────────────────────────── */
const FEEDBACK_CATEGORIES = [
  {
    key: 'bug',
    label: 'Bug Report',
    desc: 'Report an issue or error you encountered',
    icon: Bug,
    accent: 'accent-pink',
    bg: 'bg-pink-500/10',
    border: 'border-pink-500/20'
  },
  {
    key: 'feature',
    label: 'Feature Request',
    desc: 'Suggest a new feature or improvement',
    icon: Lightbulb,
    accent: 'accent-yellow',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20'
  },
  {
    key: 'general',
    label: 'General Feedback',
    desc: 'Share your thoughts or experience',
    icon: MessageCircle,
    accent: 'accent-blue',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20'
  }
];

/* ──────────────────────────────────────────────
   Status display configuration
   ────────────────────────────────────────────── */
const STATUS_MAP = {
  pending: { label: 'Pending', cls: 'bg-accent-yellow/10 text-accent-yellow border-accent-yellow/20', icon: Clock },
  resolved: { label: 'Resolved', cls: 'bg-accent-green/10 text-accent-green border-accent-green/20', icon: CheckCircle },
  archived: { label: 'Archived', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20', icon: AlertCircle }
};

/* ──────────────────────────────────────────────
   Main Component
   ────────────────────────────────────────────── */
export default function Feedback({ user }) {
  // Form state
  const [category, setCategory] = useState('bug');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Feedback history
  const [feedbackList, setFeedbackList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(true);

  // Banner
  const [banner, setBanner] = useState('');
  const showBanner = (msg) => {
    setBanner(msg);
    setTimeout(() => setBanner(''), 4000);
  };

  /* ────── Load user's past feedback ────── */
  const loadFeedbackHistory = async () => {
    setHistoryLoading(true);
    try {
      const ref = collection(db, 'feedback');
      const q = query(ref, where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setFeedbackList(list);
    } catch (e) {
      console.error('Load feedback error:', e);
      // If the composite index doesn't exist yet, do a simpler query
      try {
        const ref = collection(db, 'feedback');
        const q = query(ref, where('userId', '==', user.uid));
        const snap = await getDocs(q);
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        // Sort client-side
        list.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });
        setFeedbackList(list);
      } catch (fallbackError) {
        console.error('Fallback feedback load error:', fallbackError);
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadFeedbackHistory();
  }, [user.uid]);

  /* ────── Submit feedback ────── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      showBanner('Please fill in both the subject and message fields.');
      return;
    }

    setSubmitting(true);
    try {
      const ref = collection(db, 'feedback');
      await addDoc(ref, {
        userId: user.uid,
        userEmail: user.email || '',
        userName: user.displayName || '',
        category: category,
        subject: subject.trim(),
        message: message.trim(),
        status: 'pending',
        createdAt: serverTimestamp()
      });

      setSubject('');
      setMessage('');
      showBanner('Thank you! Your feedback has been submitted successfully.');
      loadFeedbackHistory();
    } catch (e) {
      console.error('Submit feedback error:', e);
      showBanner('Failed to submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ────── Helpers ────── */
  const getCategoryConfig = (key) => FEEDBACK_CATEGORIES.find((c) => c.key === key) || FEEDBACK_CATEGORIES[2];
  const getStatusConfig = (status) => STATUS_MAP[status] || STATUS_MAP.pending;

  const formatTimestamp = (ts) => {
    if (!ts) return 'Just now';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-8 w-full max-w-4xl mx-auto pb-12 overflow-x-hidden box-border px-1 sm:px-0">
      {/* Page Header */}
      <div className="w-full">
        <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
          <MessageSquare className="w-7 h-7 text-accent-teal shrink-0" />
          Feedback
        </h1>
        <p className="text-slate-400 text-sm mt-1">Report issues, suggest features, or share your experience</p>
      </div>

      {/* Banner */}
      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3.5 rounded-xl bg-accent-teal/10 border border-accent-teal/20 text-accent-teal text-xs font-semibold flex items-center gap-2 w-full"
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span className="flex-1 min-w-0 break-words">{banner}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Submission Form ── */}
      <form onSubmit={handleSubmit} className="space-y-6 w-full">
        {/* Category selector */}
        <GlassCard className="space-y-5 w-full" delay={0.1}>
          <p className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center gap-2 border-b border-white/[0.06] pb-4">
            <MessageSquare className="w-4 h-4 text-accent-teal shrink-0" /> Submit Feedback
          </p>

          <div className="w-full">
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3 ml-1">
              Category
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
              {FEEDBACK_CATEGORIES.map((cat) => {
                const CatIcon = cat.icon;
                const isActive = category === cat.key;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setCategory(cat.key)}
                    className={`relative p-4 rounded-xl border text-left cursor-pointer transition-all duration-300 flex items-start gap-3 w-full ${
                      isActive
                        ? `${cat.bg} ${cat.border} border shadow-md`
                        : 'bg-white/[0.01] border-white/[0.05] hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isActive ? `${cat.bg} text-${cat.accent} border ${cat.border}` : 'bg-white/5 text-slate-500 border border-white/10'
                    }`}>
                      <CatIcon className="w-4.5 h-4.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold leading-none truncate ${isActive ? 'text-white' : 'text-slate-300'}`}>{cat.label}</p>
                      <p className="text-[10px] text-slate-500 mt-1.5 leading-tight">{cat.desc}</p>
                    </div>
                    {isActive && (
                      <div className={`absolute top-3 right-3 w-2 h-2 rounded-full bg-${cat.accent} shadow-[0_0_8px_currentColor] shrink-0`} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subject */}
          <div className="w-full">
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2 ml-1">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief title for your feedback..."
              maxLength={120}
              className="w-full box-border bg-white/[0.03] border border-white/[0.08] focus:border-accent-teal focus:ring-1 focus:ring-accent-teal transition-all rounded-xl py-3 px-4 text-sm text-white placeholder-slate-500 outline-none"
            />
          </div>

          {/* Message body */}
          <div className="w-full">
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2 ml-1">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your feedback in detail..."
              rows={5}
              maxLength={2000}
              className="w-full box-border bg-white/[0.03] border border-white/[0.08] focus:border-accent-teal focus:ring-1 focus:ring-accent-teal transition-all rounded-xl py-3 px-4 text-sm text-white placeholder-slate-500 outline-none resize-none"
            />
            <p className="text-[9px] text-slate-500 mt-1.5 ml-1 font-semibold">
              {message.length} / 2000 characters
            </p>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !subject.trim() || !message.trim()}
            className="w-full py-4 bg-gradient-to-r from-accent-purple to-accent-teal hover:from-accent-purple/90 hover:to-accent-teal/90 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-accent-purple/20 flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {submitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="w-5 h-5 shrink-0" />
                Submit Feedback
              </>
            )}
          </button>
        </GlassCard>
      </form>

      {/* ── Feedback History ── */}
      <GlassCard className="space-y-4 w-full" delay={0.2} hover={false}>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between outline-none focus:outline-none"
        >
          <p className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center gap-2 truncate pr-2">
            <Clock className="w-4 h-4 text-accent-purple shrink-0" /> Your Submission History
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">{feedbackList.length} submissions</span>
            {showHistory ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </div>
        </button>

        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden w-full"
            >
              <div className="pt-4 border-t border-white/[0.06] space-y-3 w-full">
                {historyLoading ? (
                  <div className="py-12 text-center text-slate-500 text-xs animate-pulse">Loading feedback history...</div>
                ) : feedbackList.length === 0 ? (
                  <div className="py-12 text-center w-full">
                    <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 mb-3 mx-auto">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <p className="text-sm font-semibold text-slate-400">No feedback submitted yet</p>
                    <p className="text-xs text-slate-500 mt-1">Your submissions will appear here.</p>
                  </div>
                ) : (
                  feedbackList.map((fb, idx) => {
                    const catConfig = getCategoryConfig(fb.category);
                    const statusConfig = getStatusConfig(fb.status);
                    const CatIcon = catConfig.icon;
                    const StatusIcon = statusConfig.icon;

                    return (
                      <motion.div
                        key={fb.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: idx * 0.04 }}
                        className="bg-white/[0.02] border border-white/[0.04] p-4 rounded-xl hover:bg-white/[0.04] transition-colors w-full box-border"
                      >
                        <div className="flex items-start justify-between gap-3 mb-2 w-full">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${catConfig.bg} text-${catConfig.accent} border ${catConfig.border}`}>
                              <CatIcon className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0 flex-1 pr-2">
                              <p className="text-sm font-bold text-white truncate w-full">{fb.subject}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wider font-semibold truncate w-full">
                                {catConfig.label} · {formatTimestamp(fb.createdAt)}
                              </p>
                            </div>
                          </div>

                          <span className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider border ${statusConfig.cls}`}>
                            <StatusIcon className="w-3 h-3 shrink-0" />
                            {statusConfig.label}
                          </span>
                        </div>

                        <p className="text-xs text-slate-400 leading-relaxed mt-2 sm:pl-[42px] break-words w-full">
                          {fb.message}
                        </p>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </div>
  );
}
