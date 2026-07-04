import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, orderBy, limit, query } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import GlassCard from '../components/GlassCard';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, ReferenceLine, AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import { 
  BarChart3, 
  Calendar, 
  TrendingUp, 
  Activity, 
  Award, 
  CheckCircle,
  AlertTriangle,
  Info,
  Scale
} from 'lucide-react';

export default function Analytics({ user }) {
  const [activeTab, setActiveTab] = useState('daily');
  const [goals, setGoals] = useState({
    targetCalories: 2000,
    targetProtein: 140,
    targetCarbs: 250,
    targetFat: 70,
    targetFiber: 30
  });

  const [todayTotals, setTodayTotals] = useState({
    cal: 0, pro: 0, carb: 0, fat: 0, fib: 0, count: 0
  });

  const [multipleDays, setMultipleDays] = useState({});
  const [weightHistory, setWeightHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  // Helper: date string offset
  const dateStringOffset = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };

  const getTodayDateString = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
  };

  const formatShortDate = (ds) => {
    if (!ds) return '';
    const parts = ds.split("-");
    const d = new Date(+parts[0], +parts[1]-1, +parts[2]);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  const formatDayLabel = (ds) => {
    if (!ds) return '';
    const parts = ds.split("-");
    const d = new Date(+parts[0], +parts[1]-1, +parts[2]);
    return d.toLocaleDateString("en-IN", { weekday: "short" });
  };

  const loadAnalyticsData = async () => {
    try {
      // 1. Load user goals
      const userDoc = await getDoc(doc(db, "users", user.uid));
      let userGoals = { targetCalories: 2000, targetProtein: 140, targetCarbs: 250, targetFat: 70, targetFiber: 30 };
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data.goals) userGoals = data.goals;
      }
      setGoals(userGoals);

      // 2. Load last 30 days daily logs
      const daysData = {};
      const promises = [];
      for (let i = 0; i < 30; i++) {
        const ds = dateStringOffset(-i);
        const ref = collection(db, "users", user.uid, "daily_logs", ds, "items");
        promises.push(
          getDocs(ref).then(snap => {
            const items = [];
            snap.forEach(d => items.push(d.data()));
            daysData[ds] = items;
          })
        );
      }
      await Promise.all(promises);
      setMultipleDays(daysData);

      // Today's summary
      const todayStr = getTodayDateString();
      const todayItems = daysData[todayStr] || [];
      let tCal = 0, tP = 0, tC = 0, tF = 0, tFib = 0;
      todayItems.forEach(it => {
        tCal += it.calories || 0;
        tP += it.protein || 0;
        tC += it.carbs || 0;
        tF += it.fat || 0;
        tFib += it.fiber || 0;
      });
      setTodayTotals({
        cal: Math.round(tCal),
        pro: Math.round(tP),
        carb: Math.round(tC),
        fat: Math.round(tF),
        fib: Math.round(tFib),
        count: todayItems.length
      });

      // 3. Load Weight logs
      const weightRef = collection(db, "users", user.uid, "weightLogs");
      const q = query(weightRef, orderBy("date", "desc"), limit(30));
      const weightSnap = await getDocs(q);
      const weights = [];
      weightSnap.forEach((d) => weights.push(d.data()));
      setWeightHistory(weights);

    } catch (e) {
      console.error("Analytics load error: ", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalyticsData();
  }, [user.uid]);

  // Aggregate day values
  const getAggregatedDay = (items) => {
    let cal = 0, pro = 0, carb = 0, fat = 0, fib = 0;
    items.forEach(it => {
      cal  += it.calories || 0;
      pro  += it.protein  || 0;
      carb += it.carbs    || 0;
      fat  += it.fat      || 0;
      fib  += it.fiber    || 0;
    });
    return { cal: Math.round(cal), pro: Math.round(pro), carb: Math.round(carb), fat: Math.round(fat), fib: Math.round(fib), count: items.length };
  };

  // --- SCORE & INSIGHTS ---
  const calculateScore = (totals, gls) => {
    if (totals.count === 0) return 0;
    const target = gls.targetCalories || 2000;
    const calRatio = totals.cal / target;
    
    let calScore = 0;
    if (calRatio >= 0.9 && calRatio <= 1.1) calScore = 40;
    else if (calRatio >= 0.8 && calRatio <= 1.2) calScore = 30;
    else if (calRatio >= 0.7 && calRatio <= 1.3) calScore = 20;
    else calScore = 10;

    const totalMacroG = totals.pro + totals.carb + totals.fat;
    let macroScore = 0;
    if (totalMacroG > 0) {
      const proRatio = totals.pro / totalMacroG;
      const carbRatio = totals.carb / totalMacroG;
      const fatRatio = totals.fat / totalMacroG;
      const proDiff = Math.abs(proRatio - 0.30);
      const carbDiff = Math.abs(carbRatio - 0.45);
      const fatDiff = Math.abs(fatRatio - 0.25);
      const avgDiff = (proDiff + carbDiff + fatDiff) / 3;
      macroScore = Math.round(Math.max(0, 35 * (1 - avgDiff * 5)));
    }

    const fiberTarget = gls.targetFiber || 30;
    const fiberScore = Math.min(15, Math.round(15 * (totals.fib / fiberTarget)));
    const varietyScore = Math.min(10, totals.count * 2);

    return Math.min(100, calScore + macroScore + fiberScore + varietyScore);
  };

  const getScoreDetails = (score) => {
    if (score >= 80) return { text: "Excellent", cls: "bg-accent-green/10 text-accent-green border-accent-green/20" };
    if (score >= 60) return { text: "Good", cls: "bg-accent-blue/10 text-accent-blue border-accent-blue/20" };
    if (score >= 40) return { text: "Fair", cls: "bg-accent-yellow/10 text-accent-yellow border-accent-yellow/20" };
    return { text: "Needs Improvement", cls: "bg-accent-pink/10 text-accent-pink border-accent-pink/20" };
  };

  const getInsightsList = (totals, gls) => {
    const list = [];
    const target = gls.targetCalories || 2000;

    if (totals.count === 0) {
      list.push({ type: "info", title: "No logs today", desc: "Log your first meal to receive customized feedback." });
      return list;
    }

    const calDiff = totals.cal - target;
    if (Math.abs(calDiff) <= target * 0.1) {
      list.push({ type: "success", title: "Excellent caloric balance", desc: `You are exactly within 10% of your ${target} kcal target.` });
    } else if (calDiff > 0) {
      list.push({ type: "warning", title: `${calDiff} kcal surplus`, desc: `You are currently above your daily goal. Balance with active exercise.` });
    } else {
      list.push({ type: "info", title: `${Math.abs(calDiff)} kcal remaining`, desc: "You have budget left today. Consider clean protein snacks." });
    }

    const proTarget = gls.targetProtein || 140;
    if (totals.pro < proTarget - 20) {
      list.push({ type: "warning", title: "Protein deficit", desc: "Eat more paneer, dal, eggs, or chicken to hit your target." });
    } else {
      list.push({ type: "success", title: "Protein benchmark met", desc: `Achieved ${totals.pro}g out of your ${proTarget}g protein target.` });
    }

    const fibTarget = gls.targetFiber || 30;
    if (totals.fib < fibTarget * 0.5) {
      list.push({ type: "error", title: "Low dietary fiber", desc: "Incorporate more leafy greens, fruits, rajma, or wheat rotis." });
    }

    return list;
  };

  const score = calculateScore(todayTotals, goals);
  const scoreBadge = getScoreDetails(score);
  const insights = getInsightsList(todayTotals, goals);

  // --- WEEKLY DATA ---
  const getWeeklyData = () => {
    const list = [];
    for (let i = 6; i >= 0; i--) {
      const ds = dateStringOffset(-i);
      const items = multipleDays[ds] || [];
      list.push({
        dateStr: ds,
        label: formatDayLabel(ds),
        shortLabel: formatShortDate(ds),
        ...getAggregatedDay(items)
      });
    }
    return list;
  };

  const weeklyData = getWeeklyData();
  const activeWeeklyDays = weeklyData.filter(d => d.count > 0);
  const nDays = activeWeeklyDays.length || 1;
  const avgCal = Math.round(activeWeeklyDays.reduce((s, d) => s + d.cal, 0) / nDays);
  const avgPro = Math.round(activeWeeklyDays.reduce((s, d) => s + d.pro, 0) / nDays);
  const avgCarb = Math.round(activeWeeklyDays.reduce((s, d) => s + d.carb, 0) / nDays);
  const avgFat = Math.round(activeWeeklyDays.reduce((s, d) => s + d.fat, 0) / nDays);

  // --- MONTHLY DATA ---
  const getMonthlyCalData = () => {
    const list = [];
    for (let i = 29; i >= 0; i--) {
      const ds = dateStringOffset(-i);
      const items = multipleDays[ds] || [];
      const aggregated = getAggregatedDay(items);
      list.push({
        dateStr: ds,
        label: formatShortDate(ds),
        Calories: aggregated.count > 0 ? aggregated.cal : null
      });
    }
    return list;
  };

  const monthlyCalData = getMonthlyCalData();
  const loggedMonthlyDays = monthlyCalData.filter(d => d.Calories !== null);
  const daysOnTarget = loggedMonthlyDays.filter(d => d.Calories <= goals.targetCalories * 1.1);
  const goalAchievementPct = loggedMonthlyDays.length > 0 ? Math.round((daysOnTarget.length / loggedMonthlyDays.length) * 100) : 0;

  // Monthly Weight Trend
  const getWeightTrendData = () => {
    const sorted = [...weightHistory].sort((a, b) => (a.date || a.id) < (b.date || b.id) ? -1 : 1);
    return sorted.map(w => ({
      label: formatShortDate(w.date || w.id),
      Weight: w.weight
    }));
  };

  const weightTrendData = getWeightTrendData();

  // Find best/worst day
  const getNotableDays = () => {
    const logged = [];
    for (let i = 29; i >= 0; i--) {
      const ds = dateStringOffset(-i);
      const items = multipleDays[ds] || [];
      const aggregated = getAggregatedDay(items);
      if (aggregated.count > 0) logged.push({ date: ds, cal: aggregated.cal });
    }
    if (logged.length === 0) return { best: '--', worst: '--' };
    const sorted = [...logged].sort((a, b) => Math.abs(a.cal - goals.targetCalories) - Math.abs(b.cal - goals.targetCalories));
    const sortedWorst = [...logged].sort((a, b) => (b.cal - goals.targetCalories) - (a.cal - goals.targetCalories));
    return {
      best: `${formatShortDate(sorted[0].date)} (${sorted[0].cal} kcal)`,
      worst: `${formatShortDate(sortedWorst[0].date)} (${sortedWorst[0].cal} kcal)`
    };
  };

  const notables = getNotableDays();

  // Custom tooltips styling
  const CustomTooltip = ({ active, payload, label, unit = "" }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-obsidian-950/90 border border-white/10 backdrop-blur-xl p-3.5 rounded-xl shadow-glass">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{label}</p>
          {payload.map((p, idx) => (
            <p key={idx} className="text-sm font-extrabold mt-1" style={{ color: p.color || p.fill }}>
              {p.name}: {p.value} {unit}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Recharts Doughnut Pie structure for Daily Tab
  const dailyPieData = [
    { name: "Protein", value: todayTotals.pro, color: "#F472B6" },
    { name: "Carbs", value: todayTotals.carb, color: "#FBBF24" },
    { name: "Fat", value: todayTotals.fat, color: "#34D399" },
    { name: "Fiber", value: todayTotals.fib, color: "#60A5FA" }
  ].filter(p => p.value > 0);

  return (
    <div className="space-y-8 overflow-x-hidden pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Analytics & Trends</h1>
          <p className="text-slate-400 text-sm mt-1">Review historical trends, logs consistency, and calculations</p>
        </div>

        {/* Tab switchers */}
        <div className="flex bg-white/5 p-1 rounded-2xl w-fit border border-white/10 relative">
          {['daily', 'weekly', 'monthly'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors z-10 ${
                activeTab === tab ? 'text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {activeTab === tab && (
                <motion.div
                  layoutId="activeAnalyticsTab"
                  className="absolute inset-0 bg-gradient-to-r from-accent-purple/15 to-accent-teal/5 border border-accent-purple/20 rounded-xl"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              {tab}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-500 text-xs uppercase tracking-widest animate-pulse">
          Loading analytics...
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.4 }}
          >
            {/* ========================================================
                DAILY PANEL
                ======================================================== */}
            {activeTab === 'daily' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                {/* Score and pie chart */}
                <div className="space-y-6">
                  <GlassCard className="flex flex-col items-center py-6" delay={0.1}>
                    <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-6">Nutrition Quality Score</p>
                    <div className="relative w-40 h-40 flex items-center justify-center">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle stroke="rgba(255,255,255,0.03)" fill="transparent" strokeWidth="10" r="64" cx="80" cy="80" />
                        <motion.circle
                          stroke="url(#scoreGradient)" fill="transparent" strokeWidth="10"
                          strokeDasharray={402}
                          initial={{ strokeDashoffset: 402 }}
                          animate={{ strokeDashoffset: 402 - (score / 100) * 402 }}
                          transition={{ duration: 1.2, ease: "easeOut" }}
                          strokeLinecap="round" r="64" cx="80" cy="80"
                        />
                        <defs>
                          <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#34D399" />
                            <stop offset="100%" stopColor="#22D3EE" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute flex flex-col items-center">
                        <span className="text-3xl font-black text-white leading-none">{score}</span>
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">/ 100</span>
                      </div>
                    </div>
                    <span className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider mt-6 border ${scoreBadge.cls}`}>
                      {scoreBadge.text}
                    </span>
                  </GlassCard>

                  {/* Micro list breakdown */}
                  <GlassCard delay={0.2}>
                    <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4">Caloric Ratios Breakdown</p>
                    <div className="space-y-3">
                      {[
                        { label: "Protein", val: `${todayTotals.pro}g`, color: "bg-accent-pink", ratio: todayTotals.pro * 4 },
                        { label: "Carbs", val: `${todayTotals.carb}g`, color: "bg-accent-yellow", ratio: todayTotals.carb * 4 },
                        { label: "Fat", val: `${todayTotals.fat}g`, color: "bg-accent-green", ratio: todayTotals.fat * 9 },
                        { label: "Fiber", val: `${todayTotals.fib}g`, color: "bg-accent-blue", ratio: 0 }
                      ].map((item, i) => {
                        const pct = todayTotals.cal > 0 ? Math.round((item.ratio / todayTotals.cal) * 100) : 0;
                        return (
                          <div key={i} className="flex items-center justify-between p-3.5 bg-white/[0.01] border border-white/[0.04] rounded-xl">
                            <div className="flex items-center gap-2.5">
                              <span className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                              <span className="text-sm font-semibold text-white">{item.label}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs font-bold">
                              <span className="text-white">{item.val}</span>
                              <span className="text-slate-500 w-10 text-right">{pct > 0 ? `${pct}%` : '--'}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </GlassCard>
                </div>

                {/* Right col: PieChart and AI feedback */}
                <div className="space-y-6">
                  {/* Recharts Pie card */}
                  <GlassCard className="flex flex-col items-center py-6" delay={0.3}>
                    <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4">Macro Distribution</p>
                    <div className="w-full h-[250px]">
                      {dailyPieData.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                          No logged meal entries for today yet
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={dailyPieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={65}
                              outerRadius={85}
                              paddingAngle={4}
                              dataKey="value"
                            >
                              {dailyPieData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip unit="g" />} />
                            <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </GlassCard>

                  {/* AI Feedback */}
                  <GlassCard className="space-y-4" delay={0.4}>
                    <p className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center gap-2">
                      <Award className="w-4 h-4 text-accent-teal" /> Personalized Insights
                    </p>
                    <div className="space-y-3">
                      {insights.map((insight, idx) => (
                        <div key={idx} className="flex gap-4 p-3 rounded-2xl bg-white/[0.01] border border-white/[0.04]">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            insight.type === 'success' ? 'bg-accent-green/10 text-accent-green border border-accent-green/20' :
                            insight.type === 'warning' ? 'bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20' :
                            insight.type === 'error' ? 'bg-accent-pink/10 text-accent-pink border border-accent-pink/20' :
                            'bg-accent-blue/10 text-accent-blue border border-accent-blue/20'
                          }`}>
                            <Info className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white">{insight.title}</p>
                            <p className="text-[11px] text-slate-500 mt-1 leading-normal">{insight.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                </div>
              </div>
            )}

            {/* ========================================================
                WEEKLY PANEL
                ======================================================== */}
            {activeTab === 'weekly' && (
              <div className="space-y-8">
                {/* Stat Cards Row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: "Avg Calories", val: `${avgCal} kcal`, color: "text-accent-teal" },
                    { label: "Avg Protein", val: `${avgPro}g`, color: "text-accent-pink" },
                    { label: "Avg Carbs", val: `${avgCarb}g`, color: "text-accent-yellow" },
                    { label: "Avg Fat", val: `${avgFat}g`, color: "text-accent-green" }
                  ].map((tile, i) => (
                    <div key={i} className="bg-white/5 border border-white/10 p-5 rounded-2xl text-center backdrop-blur-md">
                      <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">{tile.label}</p>
                      <p className={`text-xl font-black mt-2 leading-none ${tile.color}`}>{tile.val}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Calorie Trend Bar Chart */}
                  <GlassCard className="flex flex-col" delay={0.1}>
                    <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-6">7-Day Calorie Trend</p>
                    <div className="w-full h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={weeklyData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="label" stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} />
                          <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} />
                          <Tooltip content={<CustomTooltip unit="kcal" />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                          <ReferenceLine y={goals.targetCalories} stroke="#22D3EE" strokeDasharray="6 4" strokeWidth={2} label={{ value: 'Target', position: 'top', fill: '#22D3EE', fontSize: 10, fontWeight: 'bold' }} />
                          <Bar dataKey="cal" name="Calories" radius={[6, 6, 0, 0]}>
                            {weeklyData.map((entry, index) => {
                              const over = entry.cal > goals.targetCalories;
                              return <Cell key={`cell-${index}`} fill={over ? 'rgba(244,114,182,0.75)' : 'rgba(108,99,255,0.75)'} />;
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </GlassCard>

                  {/* Stacked Macro Breakdown */}
                  <GlassCard className="flex flex-col" delay={0.2}>
                    <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-6">7-Day Macro Breakdown</p>
                    <div className="w-full h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={weeklyData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="label" stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} />
                          <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} />
                          <Tooltip content={<CustomTooltip unit="g" />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                          <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', paddingTop: '10px' }} />
                          <Bar dataKey="pro" name="Protein" stackId="a" fill="#F472B6" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="carb" name="Carbs" stackId="a" fill="#FBBF24" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="fat" name="Fat" stackId="a" fill="#34D399" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </GlassCard>
                </div>
              </div>
            )}

            {/* ========================================================
                MONTHLY PANEL
                ======================================================== */}
            {activeTab === 'monthly' && (
              <div className="space-y-8">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Goal Achievement Card */}
                  <GlassCard className="flex flex-col items-center justify-center text-center py-8" delay={0.1}>
                    <p className="text-xs font-bold uppercase text-slate-400 tracking-wider">Goal Consistency</p>
                    <p className="text-4xl font-black bg-gradient-to-r from-accent-green to-accent-teal bg-clip-text text-transparent mt-3">{goalAchievementPct}%</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-2">days on calorie target</p>
                  </GlassCard>

                  {/* Weight tracker cards */}
                  <GlassCard className="flex flex-col justify-center" delay={0.2}>
                    <p className="text-xs font-bold uppercase text-slate-400 tracking-wider">Notable Metrics</p>
                    <div className="mt-3 space-y-2">
                      <div className="flex justify-between text-xs font-semibold text-slate-300">
                        <span>Best Adherence</span>
                        <span className="text-white">{notables.best}</span>
                      </div>
                      <div className="flex justify-between text-xs font-semibold text-slate-300">
                        <span>Most Over Target</span>
                        <span className="text-white">{notables.worst}</span>
                      </div>
                    </div>
                  </GlassCard>

                  {/* Dynamic Weight widget */}
                  <GlassCard className="flex flex-col justify-center" delay={0.3}>
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-xl bg-accent-teal/10 border border-accent-teal/20 flex items-center justify-center text-accent-teal">
                        <Scale className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase text-slate-400 tracking-wider">Weight Progress (30d)</p>
                        <p className="text-sm font-semibold text-slate-500 mt-1">
                          {weightTrendData.length > 0 
                            ? `${weightTrendData[0].Weight} kg logged recently` 
                            : 'No weight data logged'}
                        </p>
                      </div>
                    </div>
                  </GlassCard>
                </div>

                {/* Weight Trend Line Chart */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <GlassCard className="flex flex-col" delay={0.4}>
                    <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-6">Weight Trend (30 Days)</p>
                    <div className="w-full h-[280px]">
                      {weightTrendData.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                          No logged weights to plot weight trend yet
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={weightTrendData}>
                            <defs>
                              <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#22D3EE" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="#22D3EE" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis dataKey="label" stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} />
                            <YAxis domain={['dataMin - 2', 'dataMax + 2']} stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} />
                            <Tooltip content={<CustomTooltip unit="kg" />} />
                            <Area type="monotone" dataKey="Weight" name="Weight" stroke="#22D3EE" fillOpacity={1} fill="url(#weightGrad)" strokeWidth={2.5} />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </GlassCard>

                  {/* 30-Day Calorie Line Chart */}
                  <GlassCard className="flex flex-col" delay={0.5}>
                    <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-6">30-Day Calorie Trend</p>
                    <div className="w-full h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={monthlyCalData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="label" stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} />
                          <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} />
                          <Tooltip content={<CustomTooltip unit="kcal" />} />
                          <ReferenceLine y={goals.targetCalories} stroke="#22D3EE" strokeDasharray="6 4" strokeWidth={2} />
                          <Line type="monotone" dataKey="Calories" name="Calories" stroke="#6C63FF" strokeWidth={2.5} dot={{ r: 2 }} activeDot={{ r: 5 }} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </GlassCard>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
