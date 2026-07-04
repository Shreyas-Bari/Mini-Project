import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc, collection, getDocs, orderBy, limit, query, serverTimestamp } from 'firebase/firestore';
import { motion } from 'framer-motion';
import GlassCard from '../components/GlassCard';
import { 
  User, 
  Scale, 
  ChevronRight, 
  Target, 
  Activity, 
  Calculator,
  Save, 
  Sparkles,
  ClipboardList,
  AlertCircle
} from 'lucide-react';

const ACTIVITY_LEVELS = [
  { level: "sedentary", label: "Sedentary", desc: "Little to no exercise", multiplier: 1.2 },
  { level: "light", label: "Lightly Active", desc: "Light exercise 1-3 days/wk", multiplier: 1.375 },
  { level: "moderate", label: "Moderately Active", desc: "Moderate sports 3-5 days/wk", multiplier: 1.55 },
  { level: "active", label: "Very Active", desc: "Hard sports 6-7 days/wk", multiplier: 1.725 },
  { level: "extra_active", label: "Extra Active", desc: "Physical job or 2x training", multiplier: 1.9 }
];

const GOAL_TYPES = [
  { type: "loss", label: "Weight Loss", desc: "Deficit of 500 kcal/day" },
  { type: "maintain", label: "Maintenance", desc: "Eat at TDEE baseline" },
  { type: "gain", label: "Weight Gain", desc: "Surplus of 300 kcal/day" },
  { type: "muscle", label: "Muscle Gain", desc: "Surplus of 200 kcal/day" }
];

export default function Goals({ user }) {
  // Profile state
  const [age, setAge] = useState(25);
  const [gender, setGender] = useState('Male');
  const [height, setHeight] = useState(170);
  const [weight, setWeight] = useState(70);
  const [activity, setActivity] = useState('moderate');
  const [goalType, setGoalType] = useState('maintain');

  // Calculated recommended values
  const [recommended, setRecommended] = useState({
    calories: 2000,
    protein: 140,
    carbs: 250,
    fat: 70,
    fiber: 30
  });

  // Custom Target Inputs
  const [customCal, setCustomCal] = useState(2000);
  const [customPro, setCustomPro] = useState(140);
  const [customCarb, setCustomCarb] = useState(250);
  const [customFat, setCustomFat] = useState(70);
  const [customFib, setCustomFib] = useState(30);

  // Weight logs state
  const [weightValue, setWeightValue] = useState('');
  const [weightHistory, setWeightHistory] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  // 1. Initial Load of Goals & Weight History
  const loadGoalsAndHistory = async () => {
    try {
      // Load user doc
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data.profile) {
          setAge(data.profile.age || 25);
          setGender(data.profile.gender || 'Male');
          setHeight(data.profile.height || 170);
          setWeight(data.profile.weight || 70);
          setActivity(data.profile.activityLevel || 'moderate');
        }
        if (data.goals) {
          setGoalType(data.goals.goalType || 'maintain');
          setCustomCal(data.goals.targetCalories || 2000);
          setCustomPro(data.goals.targetProtein || 140);
          setCustomCarb(data.goals.targetCarbs || 250);
          setCustomFat(data.goals.targetFat || 70);
          setCustomFib(data.goals.targetFiber || 30);
        }
      }

      // Load weight logs
      const ref = collection(db, "users", user.uid, "weightLogs");
      const q = query(ref, orderBy("date", "desc"), limit(5));
      const snap = await getDocs(q);
      const history = [];
      snap.forEach((d) => history.push({ id: d.id, ...d.data() }));
      setWeightHistory(history);

    } catch (e) {
      console.error("Goals load error: ", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGoalsAndHistory();
  }, [user.uid]);

  // 2. Mifflin-St Jeor Calculation logic
  useEffect(() => {
    // BMR
    let bmr = 10 * weight + 6.25 * height - 5 * age;
    if (gender === 'Male') bmr += 5;
    else bmr -= 161;

    // TDEE
    const mult = ACTIVITY_LEVELS.find(a => a.level === activity)?.multiplier || 1.2;
    const tdee = Math.round(bmr * mult);

    // Goal Calorie Target offsets
    let recommendedCal = tdee;
    let proPct = 0.30, carbPct = 0.45, fatPct = 0.25; // default maintenance splits

    if (goalType === 'loss') {
      recommendedCal = Math.max(1200, tdee - 500);
      proPct = 0.35; carbPct = 0.40; fatPct = 0.25;
    } else if (goalType === 'gain') {
      recommendedCal = tdee + 300;
      proPct = 0.30; carbPct = 0.50; fatPct = 0.20;
    } else if (goalType === 'muscle') {
      recommendedCal = tdee + 200;
      proPct = 0.40; carbPct = 0.35; fatPct = 0.25;
    }

    // Convert calorie percentage to grams
    const recommendedPro = Math.round((recommendedCal * proPct) / 4);
    const recommendedCarb = Math.round((recommendedCal * carbPct) / 4);
    const recommendedFat = Math.round((recommendedCal * fatPct) / 9);
    const recommendedFib = gender === 'Male' ? 30 : 25;

    setRecommended({
      calories: recommendedCal,
      protein: recommendedPro,
      carbs: recommendedCarb,
      fat: recommendedFat,
      fiber: recommendedFib
    });

  }, [age, gender, height, weight, activity, goalType]);

  const applyRecommendedTargets = () => {
    setCustomCal(recommended.calories);
    setCustomPro(recommended.protein);
    setCustomCarb(recommended.carbs);
    setCustomFat(recommended.fat);
    setCustomFib(recommended.fiber);
    showBannerMessage('Recommended targets loaded below!');
  };

  const showBannerMessage = (txt) => {
    setMessage(txt);
    setTimeout(() => setMessage(''), 4000);
  };

  // Save profile info & goals
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Save user details
      await setDoc(doc(db, "users", user.uid), {
        profile: { age, gender, height, weight, activityLevel: activity },
        goals: {
          goalType,
          targetCalories: customCal,
          targetProtein: customPro,
          targetCarbs: customCarb,
          targetFat: customFat,
          targetFiber: customFib
        },
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Save today's weight log
      await setDoc(doc(db, "users", user.uid, "weightLogs", today), {
        date: today,
        weight: weight,
        loggedAt: serverTimestamp()
      }, { merge: true });

      showBannerMessage('Profile & goals saved successfully!');
      loadGoalsAndHistory();
    } catch (err) {
      console.error("Save profile error: ", err);
      showBannerMessage('Error saving profile settings.');
    }
  };

  // Add a dedicated Weight log entry
  const handleLogWeight = async (e) => {
    e.preventDefault();
    if (!weightValue || isNaN(weightValue)) return;
    const today = new Date().toISOString().split('T')[0];
    try {
      await setDoc(doc(db, "users", user.uid, "weightLogs", today), {
        date: today,
        weight: parseFloat(weightValue),
        loggedAt: serverTimestamp()
      }, { merge: true });
      
      setWeightValue('');
      showBannerMessage('Weight entry logged successfully!');
      loadGoalsAndHistory();
    } catch (err) {
      console.error("Weight save error: ", err);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12 overflow-x-hidden">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Goals & Profile</h1>
        <p className="text-slate-400 text-sm mt-1">Configure your targets and calculate recommended metrics</p>
      </div>

      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-accent-teal/10 border border-accent-teal/20 text-accent-teal text-xs font-semibold flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" />
          <span>{message}</span>
        </motion.div>
      )}

      {/* Single Column Form Layout */}
      <form onSubmit={handleSaveProfile} className="space-y-8">
        
        {/* Section 1: Personal Profile */}
        <GlassCard className="space-y-6" delay={0.1}>
          <p className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center gap-2 border-b border-white/[0.06] pb-4">
            <User className="w-4 h-4 text-accent-teal" /> Personal Profile Parameters
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
            {/* Left side: Basic inputs */}
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Age (Years)</label>
                  <input
                    type="number"
                    min="10"
                    max="100"
                    value={age}
                    onChange={(e) => setAge(parseInt(e.target.value) || 0)}
                    className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-accent-teal focus:ring-1 focus:ring-accent-teal transition-all rounded-xl py-3 px-4 text-sm text-white placeholder-slate-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Height (cm)</label>
                  <input
                    type="number"
                    min="80"
                    max="250"
                    value={height}
                    onChange={(e) => setHeight(parseInt(e.target.value) || 0)}
                    className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-accent-teal focus:ring-1 focus:ring-accent-teal transition-all rounded-xl py-3 px-4 text-sm text-white placeholder-slate-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Weight (kg)</label>
                <input
                  type="number"
                  min="30"
                  max="200"
                  value={weight}
                  onChange={(e) => setWeight(parseFloat(e.target.value) || 0)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-accent-teal focus:ring-1 focus:ring-accent-teal transition-all rounded-xl py-3 px-4 text-sm text-white placeholder-slate-500 outline-none"
                />
              </div>
            </div>

            {/* Right side: Gender */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2 ml-1">Gender</label>
              <div className="flex flex-col bg-white/5 p-1.5 rounded-xl border border-white/10 space-y-1">
                {['Male', 'Female', 'Other'].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    className={`px-6 py-3 rounded-lg text-sm font-bold transition-all duration-300 text-left ${
                      gender === g 
                        ? 'bg-gradient-to-r from-accent-purple to-accent-teal text-white shadow-sm' 
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Section 2: Activity & Strategy */}
        <GlassCard className="space-y-6" delay={0.2}>
          <p className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center gap-2 border-b border-white/[0.06] pb-4">
            <Activity className="w-4 h-4 text-accent-purple" /> Activity & Goal Strategy
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
            {/* Activity selector */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3 ml-1">
                Activity Multiplier
              </label>
              <div className="space-y-2">
                {ACTIVITY_LEVELS.map((act) => (
                  <div
                    key={act.level}
                    onClick={() => setActivity(act.level)}
                    className={`p-4 rounded-xl border text-left cursor-pointer transition-all duration-300 flex items-center justify-between ${
                      activity === act.level 
                        ? 'bg-white/[0.05] border-accent-purple/40 shadow-md' 
                        : 'bg-white/[0.01] border-white/[0.05] hover:bg-white/[0.03]'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-white leading-none">{act.label}</p>
                      <p className="text-[10px] text-slate-500 mt-1.5 leading-tight">{act.desc}</p>
                    </div>
                    {activity === act.level && <div className="w-2 h-2 rounded-full bg-accent-purple shadow-[0_0_8px_#6C63FF]" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Goal selectors */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3 ml-1 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-accent-teal" /> Target Strategy
              </label>
              <div className="space-y-2">
                {GOAL_TYPES.map((goal) => (
                  <div
                    key={goal.type}
                    onClick={() => setGoalType(goal.type)}
                    className={`p-4 rounded-xl border text-left cursor-pointer transition-all duration-300 flex items-center justify-between ${
                      goalType === goal.type 
                        ? 'bg-white/[0.05] border-accent-teal/40 shadow-md' 
                        : 'bg-white/[0.01] border-white/[0.05] hover:bg-white/[0.03]'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-white leading-none">{goal.label}</p>
                      <p className="text-[10px] text-slate-500 mt-1.5 leading-tight">{goal.desc}</p>
                    </div>
                    {goalType === goal.type && <div className="w-2 h-2 rounded-full bg-accent-teal shadow-[0_0_8px_#22D3EE]" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Section 3: Recommended vs Custom Targets */}
        <GlassCard className="space-y-6 border-accent-teal/10" delay={0.3}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.06] pb-4">
            <p className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center gap-2">
              <Calculator className="w-4 h-4 text-accent-teal" /> Nutrition Targets
            </p>
            <button
              type="button"
              onClick={applyRecommendedTargets}
              className="text-xs font-bold text-accent-teal hover:text-accent-teal/80 border border-accent-teal/20 bg-accent-teal/5 px-4 py-2 rounded-xl transition-all"
            >
              Apply Mifflin-St Jeor Recommendations
            </button>
          </div>

          <div className="pt-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 ml-1 font-bold">Recommended Metrics</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center py-3 bg-white/[0.01] border border-white/[0.04] rounded-xl mb-6">
              <div className="col-span-2 md:col-span-1">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Calories</p>
                <p className="text-lg font-extrabold text-white mt-1">{recommended.calories}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Protein</p>
                <p className="text-base font-extrabold text-accent-pink mt-1">{recommended.protein}g</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Carbs</p>
                <p className="text-base font-extrabold text-accent-yellow mt-1">{recommended.carbs}g</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Fat</p>
                <p className="text-base font-extrabold text-accent-green mt-1">{recommended.fat}g</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Fiber</p>
                <p className="text-base font-extrabold text-accent-blue mt-1">{recommended.fiber}g</p>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 ml-1 font-bold mt-8">Custom Targets (Your Active Goal)</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Calories</label>
                <input
                  type="number"
                  value={customCal}
                  onChange={(e) => setCustomCal(parseInt(e.target.value) || 0)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-accent-purple text-center rounded-xl py-3 text-sm font-bold text-white outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Protein (g)</label>
                <input
                  type="number"
                  value={customPro}
                  onChange={(e) => setCustomPro(parseInt(e.target.value) || 0)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-accent-purple text-center rounded-xl py-3 text-sm font-bold text-white outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Carbs (g)</label>
                <input
                  type="number"
                  value={customCarb}
                  onChange={(e) => setCustomCarb(parseInt(e.target.value) || 0)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-accent-purple text-center rounded-xl py-3 text-sm font-bold text-white outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Fat (g)</label>
                <input
                  type="number"
                  value={customFat}
                  onChange={(e) => setCustomFat(parseInt(e.target.value) || 0)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-accent-purple text-center rounded-xl py-3 text-sm font-bold text-white outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Fiber (g)</label>
                <input
                  type="number"
                  value={customFib}
                  onChange={(e) => setCustomFib(parseInt(e.target.value) || 0)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-accent-purple text-center rounded-xl py-3 text-sm font-bold text-white outline-none transition-all"
                />
              </div>
            </div>
          </div>
          
          <div className="pt-4">
            <button
              type="submit"
              className="w-full py-4 mt-2 bg-gradient-to-r from-accent-purple to-accent-teal hover:from-accent-purple/90 hover:to-accent-teal/90 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-accent-purple/20 flex items-center justify-center gap-2 hover:scale-[1.01]"
            >
              <Save className="w-5 h-5" /> Save Profile & Goals
            </button>
          </div>
        </GlassCard>
      </form>

      {/* Section 4: Weight Logs */}
      <GlassCard className="space-y-6" delay={0.4}>
        <p className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center gap-2 border-b border-white/[0.06] pb-4">
          <Scale className="w-4 h-4 text-accent-teal" /> Weight Tracking
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
          {/* Add log weight form */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3 ml-1">Register Today's Weight</label>
            <div className="flex gap-3">
              <input
                type="number"
                step="0.1"
                placeholder="e.g. 70.5"
                value={weightValue}
                onChange={(e) => setWeightValue(e.target.value)}
                className="flex-1 bg-white/[0.03] border border-white/[0.08] focus:border-accent-teal transition-all rounded-xl py-3.5 px-4 text-sm font-bold text-white placeholder-slate-500 outline-none"
              />
              <button
                onClick={handleLogWeight}
                disabled={!weightValue}
                className="py-3.5 px-6 bg-accent-teal text-obsidian-950 font-extrabold rounded-xl text-sm hover:bg-accent-teal/90 transition-all shadow-lg shadow-accent-teal/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Log Entry
              </button>
            </div>
          </div>

          {/* Weight log history list */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3 ml-1 flex items-center gap-2">
              <ClipboardList className="w-3 h-3 text-accent-purple" /> Recent Entries
            </label>
            <div className="space-y-2 max-h-[160px] overflow-y-auto pr-2">
              {weightHistory.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs bg-white/[0.01] rounded-xl border border-white/[0.02]">
                  No weight entries recorded yet.
                </div>
              ) : (
                weightHistory.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between p-3.5 bg-white/[0.01] border border-white/[0.04] rounded-xl hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-accent-teal/10 flex items-center justify-center text-accent-teal">
                        <Scale className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white leading-none">{log.weight} kg</p>
                        <p className="text-[10px] text-slate-500 mt-1 font-semibold uppercase tracking-wider">
                          {new Date(log.date || log.id).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric"
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
