import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc, collection, getDocs, orderBy, limit, query, serverTimestamp } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import GlassCard from '../components/GlassCard';
import { 
  Flame, 
  Sparkles, 
  Droplet, 
  Scale, 
  Coffee, 
  Sun, 
  Moon, 
  Plus, 
  Minus,
  Utensils,
  TrendingDown,
  TrendingUp,
  Beef,
  Wheat,
  Droplets,
  Leaf
} from 'lucide-react';

export default function Dashboard({ user }) {
  const [greeting, setGreeting] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [streak, setStreak] = useState(0);
  const [goals, setGoals] = useState({
    targetCalories: 2000,
    targetProtein: 140,
    targetCarbs: 250,
    targetFat: 70,
    targetFiber: 30
  });

  const [consumed, setConsumed] = useState({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0
  });

  const [meals, setMeals] = useState([]);
  const [waterGlasses, setWaterGlasses] = useState(0);
  const [weightLogs, setWeightLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const getTodayDateString = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  };

  const computeAndPersistStreak = async () => {
    try {
      let currentStreak = 0;
      const today = new Date();
      today.setHours(12, 0, 0, 0);

      const todayStr = getTodayDateString();
      const todayRef = collection(db, "users", user.uid, "daily_logs", todayStr, "items");
      const todaySnap = await getDocs(todayRef);
      const hasLoggedToday = todaySnap.size > 0;

      const maxLookback = 60;
      const startOffset = hasLoggedToday ? 0 : 1;

      for (let i = startOffset; i < maxLookback; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

        const ref = collection(db, "users", user.uid, "daily_logs", ds, "items");
        const snap = await getDocs(ref);

        if (snap.size > 0) {
          currentStreak++;
        } else {
          break;
        }
      }

      setStreak(currentStreak);

      await setDoc(doc(db, "users", user.uid), {
        streak: {
          current: currentStreak,
          lastActiveDate: hasLoggedToday ? todayStr : getTodayDateString(),
          updatedAt: serverTimestamp()
        }
      }, { merge: true });

    } catch (e) {
      console.error("Streak computation error:", e);
    }
  };

  useEffect(() => {
    const h = new Date().getHours();
    if (h < 12) setGreeting("Good morning");
    else if (h < 17) setGreeting("Good afternoon");
    else if (h < 21) setGreeting("Good evening");
    else setGreeting("Good night");

    setDateStr(new Date().toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    }));

    const loadDashboardData = async () => {
      try {
        const today = getTodayDateString();
        
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.goals) {
            setGoals({
              targetCalories: data.goals.targetCalories || 2000,
              targetProtein: data.goals.targetProtein || 140,
              targetCarbs: data.goals.targetCarbs || 250,
              targetFat: data.goals.targetFat || 70,
              targetFiber: data.goals.targetFiber || 30
            });
          }
          if (data.streak) {
            setStreak(data.streak.current || 0);
          }
        }

        const itemsRef = collection(db, "users", user.uid, "daily_logs", today, "items");
        const itemsSnap = await getDocs(itemsRef);
        const loggedMeals = [];
        let cal = 0, pro = 0, carb = 0, fat = 0, fib = 0;
        
        itemsSnap.forEach((d) => {
          const item = d.data();
          loggedMeals.push({ id: d.id, ...item });
          cal += item.calories || 0;
          pro += item.protein || 0;
          carb += item.carbs || 0;
          fat += item.fat || 0;
          fib += item.fiber || 0;
        });

        setMeals(loggedMeals);
        setConsumed({
          calories: Math.round(cal),
          protein: Math.round(pro),
          carbs: Math.round(carb),
          fat: Math.round(fat),
          fiber: Math.round(fib)
        });

        const waterDoc = await getDoc(doc(db, "users", user.uid, "waterLogs", today));
        if (waterDoc.exists()) {
          setWaterGlasses(waterDoc.data().glasses || 0);
        }

        const weightRef = collection(db, "users", user.uid, "weightLogs");
        const q = query(weightRef, orderBy("date", "desc"), limit(2));
        const weightSnap = await getDocs(q);
        const weights = [];
        weightSnap.forEach((d) => weights.push(d.data()));
        setWeightLogs(weights);

      } catch (e) {
        console.error("Dashboard load error: ", e);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
    computeAndPersistStreak();
  }, [user.uid]);

  const handleWaterToggle = async (glassesCount) => {
    const today = getTodayDateString();
    setWaterGlasses(glassesCount);
    try {
      await setDoc(doc(db, "users", user.uid, "waterLogs", today), {
        glasses: glassesCount,
        liters: parseFloat((glassesCount * 0.25).toFixed(2)),
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.error("Failed to save water log: ", e);
    }
  };

  const getRemainingCalories = () => {
    return Math.max(0, goals.targetCalories - consumed.calories);
  };

  const caloriePercentage = Math.min((consumed.calories / goals.targetCalories) * 100, 100);

  const radius = 72;
  const stroke = 12;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (caloriePercentage / 100) * circumference;

  const mealIcons = {
    breakfast: Coffee,
    lunch: Sun,
    dinner: Moon,
    snacks: Utensils
  };

  const macroMatrix = [
    {
      label: "Protein",
      value: consumed.protein,
      target: goals.targetProtein,
      unit: "g",
      color: "accent-pink",
      gradient: "from-pink-500/20 to-pink-500/0",
      borderColor: "border-t-pink-500/40",
      icon: Beef
    },
    {
      label: "Carbs",
      value: consumed.carbs,
      target: goals.targetCarbs,
      unit: "g",
      color: "accent-yellow",
      gradient: "from-yellow-500/20 to-yellow-500/0",
      borderColor: "border-t-yellow-500/40",
      icon: Wheat
    },
    {
      label: "Fat",
      value: consumed.fat,
      target: goals.targetFat,
      unit: "g",
      color: "accent-green",
      gradient: "from-emerald-500/20 to-emerald-500/0",
      borderColor: "border-t-green-500/40",
      icon: Droplets
    },
    {
      label: "Fiber",
      value: consumed.fiber,
      target: goals.targetFiber,
      unit: "g",
      color: "accent-blue",
      gradient: "from-blue-500/20 to-blue-500/0",
      borderColor: "border-t-blue-500/40",
      icon: Leaf
    }
  ];

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            {greeting}, {user.displayName ? user.displayName.split(' ')[0] : 'User'}
            <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-accent-teal animate-pulse" />
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">{dateStr}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-2xl flex items-center gap-2.5 backdrop-blur-md shrink-0">
            <Flame className="w-5 h-5 text-accent-pink animate-pulse" />
            <div>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none">Streak</p>
              <p className="text-base sm:text-lg font-extrabold text-white leading-none mt-1">{streak} Days</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Calorie Ring + Macro Matrix + Water/Weight */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        
        {/* Left Column: Calorie Ring Snapshot */}
        <GlassCard className="flex flex-col items-center justify-center py-8 sm:py-10" delay={0.1}>
          <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-6">Today's Snapshot</p>
          <div className="relative w-40 h-40 sm:w-44 sm:h-44 shrink-0">
            <svg viewBox="0 0 144 144" className="w-full h-full transform -rotate-90">
              <circle
                stroke="rgba(255,255,255,0.03)"
                fill="transparent"
                strokeWidth={stroke}
                r={normalizedRadius}
                cx="72"
                cy="72"
              />
              <motion.circle
                stroke="url(#calorieGradient)"
                fill="transparent"
                strokeWidth={stroke}
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                strokeLinecap="round"
                r={normalizedRadius}
                cx="72"
                cy="72"
              />
              <defs>
                <linearGradient id="calorieGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6C63FF" />
                  <stop offset="100%" stopColor="#22D3EE" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-black text-slate-100 leading-none">{consumed.calories}</span>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 text-center px-2">of {goals.targetCalories} kcal</span>
            </div>
          </div>

          <div className="grid grid-cols-2 w-full gap-4 mt-8 pt-6 border-t border-white/[0.06] text-center">
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Remaining</p>
              <p className="text-lg sm:text-xl font-extrabold text-slate-100 mt-1">{getRemainingCalories()} kcal</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Logged Meals</p>
              <p className="text-lg sm:text-xl font-extrabold text-accent-teal mt-1">{meals.length}</p>
            </div>
          </div>
        </GlassCard>

        {/* Middle Column: Macronutrient Matrix Grid */}
        <div className="grid grid-cols-2 gap-4">
          {macroMatrix.map((macro, i) => {
            const pct = Math.min((macro.value / macro.target) * 100, 100);
            const MacroIcon = macro.icon;
            return (
              <motion.div
                key={macro.label}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 + i * 0.08, ease: [0.33, 1, 0.68, 1] }}
                className={`relative overflow-hidden bg-slate-950/40 backdrop-blur-xl border border-white/[0.06] border-t-2 ${macro.borderColor} rounded-2xl p-4 sm:p-5 shadow-glass-strong hover:scale-[1.01] transition-all duration-300`}
              >
                <div className={`absolute top-0 left-0 right-0 h-16 bg-gradient-to-b ${macro.gradient} pointer-events-none`} />
                
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <MacroIcon className={`w-4 h-4 sm:w-5 sm:h-5 text-${macro.color}`} />
                    <span className={`text-[9px] font-bold uppercase tracking-widest text-${macro.color}`}>
                      {Math.round(pct)}%
                    </span>
                  </div>
                  
                  <p className="text-xl sm:text-2xl font-black text-slate-100 leading-none">
                    {macro.value}
                    <span className="text-xs text-slate-400 font-bold ml-0.5">{macro.unit}</span>
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5">
                    {macro.label}
                  </p>
                  
                  <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 1, ease: "easeOut", delay: 0.3 + i * 0.1 }}
                      className={`h-full bg-${macro.color} rounded-full shadow-lg shadow-${macro.color}/20`}
                    />
                  </div>
                  <p className="text-[9px] text-slate-500 font-semibold mt-1.5 truncate">
                    of {macro.target}{macro.unit} target
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Right Column: Weight & Water Trackers */}
        <div className="flex flex-col gap-6">
          {/* Water Widget */}
          <GlassCard className="flex-1 flex flex-col justify-between p-5" delay={0.3}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-bold uppercase text-slate-400 tracking-wider">Water Intake</p>
                <p className="text-lg sm:text-xl font-extrabold text-slate-100 mt-1">{(waterGlasses * 0.25).toFixed(2)} L</p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                waterGlasses >= 6 ? 'bg-accent-green/10 text-accent-green border border-accent-green/20' : 
                waterGlasses >= 3 ? 'bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20' : 
                'bg-accent-blue/10 text-accent-blue border border-accent-blue/20'
              }`}>
                {waterGlasses} / 8 <span className="hidden sm:inline">Glasses</span>
              </span>
            </div>

            <div className="flex items-center justify-between gap-1 sm:gap-2.5 py-4 w-full">
              {[...Array(8)].map((_, i) => {
                const filled = i < waterGlasses;
                return (
                  <motion.button
                    key={i}
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleWaterToggle(filled ? i : i + 1)}
                    className="focus:outline-none p-1 shrink-0"
                    aria-label={`Toggle glass ${i + 1}`}
                  >
                    <Droplet className={`w-5 h-5 sm:w-7 sm:h-7 transition-colors duration-300 ${filled ? 'fill-accent-blue text-accent-blue drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]' : 'text-slate-600 hover:text-accent-blue/60'}`} />
                  </motion.button>
                );
              })}
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => handleWaterToggle(Math.max(0, waterGlasses - 1))}
                className="flex-1 min-h-[44px] rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center gap-1.5 text-xs font-semibold text-white transition-colors"
                aria-label="Remove a glass of water"
              >
                <Minus className="w-4 h-4 shrink-0" /> <span className="hidden xs:inline">Remove</span>
              </button>
              <button
                onClick={() => handleWaterToggle(Math.min(8, waterGlasses + 1))}
                className="flex-1 min-h-[44px] rounded-xl bg-accent-blue/10 border border-accent-blue/20 hover:bg-accent-blue/20 flex items-center justify-center gap-1.5 text-xs font-semibold text-accent-blue transition-colors"
                aria-label="Add a glass of water"
              >
                <Plus className="w-4 h-4 shrink-0" /> <span className="hidden xs:inline">Add</span>
              </button>
            </div>
          </GlassCard>

          {/* Weight Widget */}
          <GlassCard className="flex-1 flex flex-col justify-center p-5" delay={0.4}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-accent-teal/10 border border-accent-teal/20 flex items-center justify-center text-accent-teal shrink-0">
                <Scale className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase text-slate-400 tracking-wider truncate">Current Weight</p>
                <p className="text-xl sm:text-2xl font-black text-slate-100 mt-1 truncate">
                  {weightLogs.length > 0 ? weightLogs[0].weight : '--'}{' '}
                  <span className="text-xs text-slate-400 font-bold uppercase">kg</span>
                </p>
              </div>
              {weightLogs.length >= 2 && (() => {
                const diff = weightLogs[0].weight - weightLogs[1].weight;
                const gain = diff > 0.1;
                const loss = diff < -0.1;
                if (!gain && !loss) return null;
                return (
                  <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] sm:text-xs font-bold ${
                    loss ? 'bg-accent-green/10 text-accent-green border border-accent-green/20' : 'bg-accent-pink/10 text-accent-pink border border-accent-pink/20'
                  }`}>
                    {loss ? <TrendingDown className="w-3 h-3 sm:w-4 sm:h-4" /> : <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />}
                    {Math.abs(diff).toFixed(1)} kg
                  </div>
                );
              })()}
            </div>
          </GlassCard>
        </div>

      </div>

      {/* Daily Meals List Journal */}
      <GlassCard delay={0.5} className="p-4 sm:p-6">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/[0.06]">
          <p className="text-sm sm:text-base font-extrabold text-white tracking-tight flex items-center gap-2">
            <Utensils className="w-4 h-4 text-accent-purple shrink-0" />
            Today's Journal
          </p>
          <span className="text-[10px] sm:text-xs text-slate-500 font-bold uppercase tracking-wider">{meals.length} items logged</span>
        </div>

        <AnimatePresence mode="popLayout">
          {meals.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-12 flex flex-col items-center text-center justify-center"
            >
              <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 mb-3">
                <Utensils className="w-5 h-5" />
              </div>
              <p className="text-sm font-semibold text-slate-400">Your journal is empty</p>
              <p className="text-xs text-slate-500 mt-1 max-w-[240px]">Navigate to Food Search in the sidebar to search and log your meals.</p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              {meals.map((meal) => {
                const IconComponent = mealIcons[meal.mealType?.toLowerCase()] || Utensils;
                return (
                  <motion.div
                    key={meal.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex items-center gap-3 sm:gap-4 bg-white/[0.02] border border-white/[0.04] p-3 sm:p-4 rounded-xl hover:bg-white/[0.04] transition-colors duration-200"
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      meal.mealType?.toLowerCase() === 'breakfast' ? 'bg-accent-purple/10 text-accent-purple border border-accent-purple/20' :
                      meal.mealType?.toLowerCase() === 'lunch' ? 'bg-accent-teal/10 text-accent-teal border border-accent-teal/20' :
                      meal.mealType?.toLowerCase() === 'dinner' ? 'bg-accent-pink/10 text-accent-pink border border-accent-pink/20' :
                      'bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20'
                    }`}>
                      <IconComponent className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-white truncate">{meal.foodName}</p>
                      <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 uppercase tracking-wider font-semibold truncate">{meal.mealType} &middot; {meal.servingGrams}g</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm sm:text-base font-black text-slate-100">{meal.calories}</p>
                      <p className="text-[8px] sm:text-[9px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">kcal</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </AnimatePresence>
      </GlassCard>
    </div>
  );
}
