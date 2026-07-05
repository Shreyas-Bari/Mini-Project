import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../firebase';
import { collection, addDoc, deleteDoc, doc, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import GlassCard from '../components/GlassCard';
/* ══════════════════════════════════════════════════════════════
   CLIENT-SIDE DATA CLEANSING & API ORCHESTRATION PIPELINE
   ══════════════════════════════════════════════════════════════ */

function getSearchTokens(query) {
  const q = query.toLowerCase().trim();
  const tokens = new Set(q.match(/\b\w+\b/g) || []);
  if (tokens.has('bottle') && tokens.has('gourd')) tokens.add('lauki');
  if (tokens.has('bitter') && tokens.has('gourd')) tokens.add('karela');
  if (tokens.has('ridge') && tokens.has('gourd')) tokens.add('turai');
  if (tokens.has('lady') && tokens.has('finger')) { tokens.add('okra'); tokens.add('bhindi'); }
  if (tokens.has('okra')) tokens.add('bhindi');
  if (tokens.has('cottage') && tokens.has('cheese')) tokens.add('paneer');
  if (tokens.has('clarified') && tokens.has('butter')) tokens.add('ghee');
  if (tokens.has('panner') || tokens.has('paner') || tokens.has('panier')) tokens.add('paneer');
  return Array.from(tokens).filter(t => t.length > 2);
}

function isRelevantMatch(food, queryTokens) {
  if (queryTokens.length === 0) return true;
  const targetString = `${food.name || ''} ${food.brand || ''} ${food.category || ''}`.toLowerCase();
  for (const token of queryTokens) {
    if (targetString.includes(token)) return true;
  }
  return false;
}

function isValidFood(food) {
  const isInvalid = (val) => val === null || val === undefined || val === '' || isNaN(Number(val));
  if (isInvalid(food.calories) || isInvalid(food.protein) || isInvalid(food.carbs) || isInvalid(food.fat)) return false;
  
  const cals = Number(food.calories);
  const pro = Number(food.protein);
  const carb = Number(food.carbs);
  const fat = Number(food.fat);
  
  if (cals === 0 && pro === 0 && carb === 0 && fat === 0) {
    const title = (food.name || '').toLowerCase();
    const cat = (food.category || '').toLowerCase();
    if (!title.includes('water') && !cat.includes('water') && !title.includes('diet') && !cat.includes('diet')) return false;
    return true;
  }
  
  const calculatedCals = (pro * 4) + (carb * 4) + (fat * 9);
  if (calculatedCals === 0 && cals > 0) return false;
  
  const variance = Math.abs(cals - calculatedCals) / Math.max(cals, calculatedCals);
  if (variance > 0.12) return false;
  return true;
}

function isContextuallyValid(food, originalQuery, activeCategory) {
  const q = originalQuery.toLowerCase();
  const cat = (food.category || '').toUpperCase();
  const name = (food.name || '').toLowerCase();

  if (q.includes("paneer") || q.includes("curd") || q.includes("milk")) {
    if (cat.includes("NUT & SEED BUTTERS") || cat.includes("NUT BUTTER") || cat.includes("SEED BUTTER") || cat.includes("CONFECTIONERY") || cat.includes("CANDY") || cat.includes("JUICE")) return false;
  }

  if (activeCategory === 'All') {
    if (cat.includes("NON-FOOD") || cat.includes("COSMETICS") || cat.includes("BODY CARE")) return false;
  }
  if (activeCategory === 'Dairy') {
    if (cat.includes("MEAT") || cat.includes("POULTRY") || cat.includes("FISH")) return false;
    if (q.includes("paneer") && food.carbs > 10) return false;
  }
  if (activeCategory === 'Vegetables & Fruits') {
    if (cat.includes("MEAT") || cat.includes("POULTRY") || cat.includes("FISH") || cat.includes("DAIRY")) return false;
    if (food.protein > 15 && !name.includes("soy") && !name.includes("bean")) return false;
  }
  if (activeCategory === 'Cooked Meals') {
    if (cat.includes("RAW") || cat.includes("UNCOOKED")) return false;
  }
  return true;
}

function areNamesSimilar(name1, name2) {
  const n1 = name1.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  const n2 = name2.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  return n1 === n2;
}

function deduplicateFoods(foods) {
  if (!foods || !Array.isArray(foods)) return [];
  const uniqueFoods = [];
  for (const food of foods) {
    const duplicate = uniqueFoods.find(u => areNamesSimilar(food.name, u.name));
    if (duplicate) {
      if (food.brand && !duplicate._brands.includes(food.brand)) duplicate._brands.push(food.brand);
    } else {
      uniqueFoods.push({ ...food, _brands: food.brand ? [food.brand] : [] });
    }
  }
  return uniqueFoods.map(item => {
    if (item._brands && item._brands.length > 0) {
      if (item._brands.length === 1) item.brand = item._brands[0];
      else {
        const primary = item._brands.slice(0, 3);
        const remaining = item._brands.length - 3;
        item.brand = `${primary.join(', ')}${remaining > 0 ? ` & ${remaining} other${remaining > 1 ? 's' : ''}` : ''}`;
      }
    } else item.brand = '';
    delete item._brands;
    return item;
  });
}

function extractUSDANutrient(nutrients, name) {
  if (!nutrients || !Array.isArray(nutrients)) return 0;
  const found = nutrients.find((n) => n.nutrientName?.toLowerCase().includes(name.toLowerCase()));
  return found ? Math.round(found.value * 10) / 10 : 0;
}

function titleCase(str) {
  if (!str) return '';
  return str.toLowerCase().split(',')[0].trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

async function searchUSDADirect(query, activeCategory, queryTokens) {
  const apiKey = import.meta.env.VITE_USDA_API_KEY || "DEMO_KEY";
  try {
    const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('query', query.trim());
    url.searchParams.set('pageSize', '20');
    url.searchParams.set('dataType', 'Foundation,SR Legacy');

    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`USDA API returned status ${response.status}`);
    
    const data = await response.json();
    return (data.foods || [])
      .map((food) => ({
        id: `usda_${food.fdcId}`,
        name: titleCase(food.description || ''),
        brand: food.brandName || food.brandOwner || '',
        category: food.foodCategory || 'General',
        source: 'USDA',
        calories: extractUSDANutrient(food.foodNutrients, 'Energy'),
        protein: extractUSDANutrient(food.foodNutrients, 'Protein'),
        carbs: extractUSDANutrient(food.foodNutrients, 'Carbohydrate, by difference'),
        fat: extractUSDANutrient(food.foodNutrients, 'Total lipid (fat)'),
        fiber: extractUSDANutrient(food.foodNutrients, 'Fiber, total dietary'),
      }))
      .filter((f) => isValidFood(f) && isContextuallyValid(f, query, activeCategory) && isRelevantMatch(f, queryTokens));
  } catch (error) {
    console.error('Direct USDA search error:', error);
    return [];
  }
}

async function searchOpenFoodFacts(query, activeCategory, queryTokens) {
  try {
    const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
    url.searchParams.set('search_terms', query.trim());
    url.searchParams.set('search_simple', '1');
    url.searchParams.set('action', 'process');
    url.searchParams.set('json', '1');
    url.searchParams.set('page_size', '15');
    url.searchParams.set('fields', 'code,product_name,brands,categories_tags_en,nutriments');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Open Food Facts API returned status ${response.status}`);
    
    const data = await response.json();
    return (data.products || [])
      .filter((p) => p.product_name)
      .map((product) => {
        const n = product.nutriments || {};
        const caloriesKcal = n['energy-kcal_100g'] || (n.energy_100g ? Math.round(n.energy_100g / 4.184) : 0);
        return {
          id: `off_${product.code || Math.random().toString(36).slice(2)}`,
          name: product.product_name || 'Unknown Product',
          brand: product.brands || '',
          category: (product.categories_tags_en || []).slice(0, 1).join(', ').replace(/en:/g, '').replace(/-/g, ' ') || 'Packaged Food',
          source: 'Open Food Facts',
          calories: Math.round(caloriesKcal),
          protein: Math.round((n.proteins_100g || 0) * 10) / 10,
          carbs: Math.round((n.carbohydrates_100g || 0) * 10) / 10,
          fat: Math.round((n.fat_100g || 0) * 10) / 10,
          fiber: Math.round((n.fiber_100g || 0) * 10) / 10,
        };
      })
      .filter((f) => isValidFood(f) && isContextuallyValid(f, query, activeCategory) && isRelevantMatch(f, queryTokens));
  } catch (error) {
    console.error('Open Food Facts search error:', error);
    return [];
  }
}

async function searchAllAPIs(query, activeCategory = 'All') {
  if (!query || query.trim().length < 2) return { usda: [], off: [], errors: [] };

  const q = query.toLowerCase().trim();
  let normalizedQuery = q;
  if (["panner", "paner", "panier", "paneer"].includes(q)) normalizedQuery = "paneer";
  if (["dhal", "daal", "dal"].includes(q)) normalizedQuery = "dal";
  if (["chappati", "chapati", "chapatti", "roti"].includes(q)) normalizedQuery = "roti";

  const queryTokens = getSearchTokens(normalizedQuery);
  const errors = [];

  const [usdaResult, offResult] = await Promise.allSettled([
    searchUSDADirect(normalizedQuery, activeCategory, queryTokens),
    searchOpenFoodFacts(normalizedQuery, activeCategory, queryTokens)
  ]);

  const usda = usdaResult.status === 'fulfilled' ? usdaResult.value : [];
  if (usdaResult.status === 'rejected') errors.push('USDA search failed');

  const off = offResult.status === 'fulfilled' ? offResult.value : [];
  if (offResult.status === 'rejected') errors.push('Open Food Facts search failed');

  const combined = [...usda, ...off];
  const cleanedAndTiered = deduplicateFoods(combined);
  
  return { usda: cleanedAndTiered, off: [], errors };
}
import { 
  Search, 
  Trash2, 
  Pencil,
  Plus, 
  Minus, 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Utensils, 
  X,
  Check,
  Lock,
  AlertTriangle,
  Globe,
  Database,
  Loader2,
  Wifi,
  WifiOff,
  Sparkles
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════
   LOCAL FOOD DATABASE (Indian Foods — Instant Fallback Cache)
   All values are per 100g serving.
   ══════════════════════════════════════════════════════════════ */
import FOOD_DB from '../data/ifct_matrix.json';

const CATEGORIES = ["All", "Cooked Meals", "Vegetables & Fruits", "Dairy", "Grains & Pulses"];

/* ──────────────────────────────────────────────
   Date utilities
   ────────────────────────────────────────────── */
const formatDateKey = (date) => date.toLocaleDateString('en-CA');

const createLocalDate = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const getDateWithOffset = (offset) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
};

/* ══════════════════════════════════════════════════════════════
   SOURCE BADGE — visual identifier for where a food came from
   ══════════════════════════════════════════════════════════════ */
const SOURCE_BADGES = {
  'USDA': { label: 'USDA', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', icon: Globe },
  'Open Food Facts': { label: 'OFF', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/20', icon: Globe },
  'Local': { label: 'Local', cls: 'bg-accent-teal/10 text-accent-teal border-accent-teal/20', icon: Database },
};

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */
export default function FoodSearch({ user, activeDate, setActiveDate }) {
  const todayStr = formatDateKey(new Date());
  const [localActiveDate, setLocalActiveDate] = useState(todayStr);
  const selectedDate = activeDate ?? localActiveDate;
  const updateActiveDate = setActiveDate ?? setLocalActiveDate;
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  
  // Modal/calculator states
  const [selectedFood, setSelectedFood] = useState(null);
  const [servingGrams, setServingGrams] = useState(100);
  const [mealSlot, setMealSlot] = useState('Breakfast');
  const [editingItem, setEditingItem] = useState(null);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  
  // Log items for selected date
  const [loggedItems, setLoggedItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── API search state ──
  const [apiResults, setApiResults] = useState([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiSearched, setApiSearched] = useState(false);
  const [apiErrors, setApiErrors] = useState([]);
  const debounceRef = useRef(null);

  const isToday = selectedDate === todayStr;

  /* ────── Firestore: Load daily items ────── */
  const loadLoggedItems = async () => {
    setLoading(true);
    try {
      const ref = collection(db, "users", user.uid, "daily_logs", selectedDate, "items");
      const snap = await getDocs(ref);
      const items = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
      setLoggedItems(items);
    } catch (e) {
      console.error("Error loading daily food items: ", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLoggedItems();
  }, [user.uid, selectedDate]);

  /* ────── Debounced API Search ────── */
  const performApiSearch = useCallback(async (query, category) => {
    if (!query || query.trim().length < 2) {
      setApiResults([]);
      setApiSearched(false);
      setApiLoading(false);
      setApiErrors([]);
      return;
    }

    setApiLoading(true);
    setApiSearched(true);
    setApiErrors([]);

    try {
      const { usda, off, errors } = await searchAllAPIs(query, category);
      setApiResults([...usda, ...off]);
      setApiErrors(errors);
    } catch (e) {
      console.error('API search error:', e);
      setApiResults([]);
      setApiErrors(['Search failed. Using local database only.']);
    } finally {
      setApiLoading(false);
    }
  }, []);

  useEffect(() => {
    // Clear any existing debounce timer
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!searchQuery || searchQuery.trim().length < 2) {
      setApiResults([]);
      setApiSearched(false);
      setApiLoading(false);
      setApiErrors([]);
      return;
    }

    // Show loading state immediately for responsiveness
    setApiLoading(true);

    // Debounce the actual API call by 500ms
    debounceRef.current = setTimeout(() => {
      performApiSearch(searchQuery, activeCategory);
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, activeCategory, performApiSearch]);

  /* ────── Date Navigation ────── */
  const changeDateByOffset = (offset) => {
    const d = createLocalDate(selectedDate);
    d.setDate(d.getDate() + offset);
    const newDateStr = formatDateKey(d);
    if (newDateStr > todayStr) return;
    updateActiveDate(newDateStr);
    setSelectedFood(null);
    setEditingItem(null);
  };

  /* ────── Filter local food database ────── */
  const filteredLocalFoods = FOOD_DB.filter(food => {
    const searchLower = searchQuery.toLowerCase();
    const matchesQuery = food.name.toLowerCase().includes(searchLower) || (food.category && food.category.toLowerCase().includes(searchLower));
    const matchesCategory = activeCategory === 'All' || food.category === activeCategory;
    return matchesQuery && matchesCategory;
  });

  /* ────── Combined display: local + API results ────── */
  const hasSearchQuery = searchQuery.trim().length >= 2;
  const totalResultCount = filteredLocalFoods.length + (hasSearchQuery ? apiResults.length : 0);

  /* ────── Macro calculator for selected food ────── */
  const getCalculatedMacros = () => {
    if (!selectedFood) return { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    const ratio = servingGrams / 100;
    return {
      calories: Math.round(selectedFood.calories * ratio),
      protein: parseFloat((selectedFood.protein * ratio).toFixed(1)),
      carbs: parseFloat((selectedFood.carbs * ratio).toFixed(1)),
      fat: parseFloat((selectedFood.fat * ratio).toFixed(1)),
      fiber: parseFloat((selectedFood.fiber * ratio).toFixed(1))
    };
  };

  const calculated = getCalculatedMacros();

  /* ────── Log food to Firestore ────── */
  const handleLogFood = async () => {
    if (!selectedFood || !isToday) return;
    try {
      const ref = collection(db, "users", user.uid, "daily_logs", selectedDate, "items");
      const newItem = {
        foodName: selectedFood.name,
        calories: calculated.calories,
        protein: calculated.protein,
        carbs: calculated.carbs,
        fat: calculated.fat,
        fiber: calculated.fiber,
        servingGrams: servingGrams,
        mealType: mealSlot,
        foodSource: selectedFood.source || 'Local',
        loggedAt: serverTimestamp()
      };
      await addDoc(ref, newItem);
      
      setSelectedFood(null);
      setServingGrams(100);
      loadLoggedItems();
    } catch (e) {
      console.error("Error logging food: ", e);
    }
  };

  /* ────── Edit logged item ────── */
  const handleEditItem = (item) => {
    if (!isToday) return;
    const baseFood = FOOD_DB.find(f => f.name === item.foodName) || {
      id: "custom",
      name: item.foodName,
      category: item.mealType,
      source: item.foodSource || 'Local',
      calories: Math.round((item.calories / item.servingGrams) * 100),
      protein: parseFloat(((item.protein / item.servingGrams) * 100).toFixed(1)),
      carbs: parseFloat(((item.carbs / item.servingGrams) * 100).toFixed(1)),
      fat: parseFloat(((item.fat / item.servingGrams) * 100).toFixed(1)),
      fiber: parseFloat(((item.fiber / item.servingGrams) * 100).toFixed(1))
    };
    setEditingItem(item);
    setSelectedFood(baseFood);
    setServingGrams(item.servingGrams);
    setMealSlot(item.mealType);
  };

  /* ────── Update food in Firestore ────── */
  const handleUpdateFood = async () => {
    if (!editingItem || !isToday) return;
    try {
      const docRef = doc(db, "users", user.uid, "daily_logs", selectedDate, "items", editingItem.id);
      await updateDoc(docRef, {
        servingGrams: servingGrams,
        mealType: mealSlot,
        calories: calculated.calories,
        protein: calculated.protein,
        carbs: calculated.carbs,
        fat: calculated.fat,
        fiber: calculated.fiber,
        updatedAt: serverTimestamp()
      });
      setSelectedFood(null);
      setEditingItem(null);
      setServingGrams(100);
      loadLoggedItems();
    } catch (e) {
      console.error("Error updating logged food: ", e);
    }
  };

  /* ────── Delete logged item ────── */
  const handleDeleteItem = async (itemId) => {
    if (!isToday) return;
    try {
      const docRef = doc(db, "users", user.uid, "daily_logs", selectedDate, "items", itemId);
      await deleteDoc(docRef);
      loadLoggedItems();
    } catch (e) {
      console.error("Error deleting logged food: ", e);
    }
  };

  /* ────── Date display helpers ────── */
  const getDisplayDateLabel = () => {
    if (isToday) return "Today";
    return createLocalDate(selectedDate).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  };

  const getFullDateLabel = (dateStr) => {
    return createLocalDate(dateStr).toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  };

  /* ────── Daily totals ────── */
  const dailyTotals = loggedItems.reduce((acc, it) => {
    acc.calories += it.calories || 0;
    acc.protein += it.protein || 0;
    acc.carbs += it.carbs || 0;
    acc.fat += it.fat || 0;
    acc.fiber += it.fiber || 0;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

  /* ────── Select food card ────── */
  const handleSelectFood = (food) => {
    if (!isToday) return;
    setSelectedFood(food);
    setServingGrams(100);
    setMealSlot('Breakfast');
  };

  /* ────── Date modal helpers ────── */
  const handleDateSelection = (option) => {
    if (option.disabled || option.dateStr > todayStr) return;
    updateActiveDate(option.dateStr);
    setSelectedFood(null);
    setEditingItem(null);
    setIsDateModalOpen(false);
  };

  const getDateOptions = () => {
    const options = [];
    for (let offset = 1; offset >= -7; offset--) {
      const d = getDateWithOffset(offset);
      const dateStr = formatDateKey(d);
      const disabled = dateStr > todayStr;
      
      let label = "";
      if (offset === 1) label = "Tomorrow";
      else if (offset === 0) label = "Today";
      else if (offset === -1) label = "Yesterday";
      else {
        label = d.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short"
        });
      }

      options.push({
        dateStr,
        label,
        disabled,
        isTodayOption: dateStr === todayStr,
        isSelected: selectedDate === dateStr,
        description: disabled
          ? "Future logging is unavailable"
          : dateStr === todayStr
            ? "Live tracking and edits enabled"
            : "Historical log opens read-only"
      });
    }
    return options;
  };

  const canNavigateForward = selectedDate < todayStr;

  /* ────── Render a single food card (shared between local & API results) ────── */
  const renderFoodCard = (food, index, sectionDelay = 0) => {
    const source = food.source || 'Local';
    const badge = SOURCE_BADGES[source] || SOURCE_BADGES['Local'];
    const BadgeIcon = badge.icon;

    return (
      <motion.div
        key={food.id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: Math.min(sectionDelay + index * 0.03, 0.5), ease: [0.33, 1, 0.68, 1] }}
        onClick={() => handleSelectFood(food)}
        aria-disabled={!isToday}
        className={`relative overflow-hidden bg-slate-950/40 backdrop-blur-xl border rounded-2xl p-5 shadow-glass transition-all duration-300 ${
          isToday
            ? 'cursor-pointer hover:scale-[1.01] hover:border-indigo-500/40 hover:shadow-[0_0_20px_rgba(99,102,241,0.15)]'
            : 'cursor-not-allowed opacity-60'
        } ${
          selectedFood?.id === food.id 
            ? 'border-accent-teal/40 shadow-[0_0_20px_rgba(34,211,238,0.15)]' 
            : 'border-white/[0.06]'
        }`}
      >
        {/* Inner subtle gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

        <div className="relative z-10">
          {/* Food title, source badge & calorie count */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap gap-1.5 items-center">
                <h3 className="text-sm font-bold text-slate-100 leading-snug">{food.name}</h3>
                
                {source === 'Local' && (
                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs px-2 py-0.5 rounded-md font-medium whitespace-nowrap">
                    Verified Baseline
                  </span>
                )}

                {source !== 'Local' && (
                  (() => {
                    const categoryUpper = (food.category || '').toUpperCase();
                    const isCommercialCategory = 
                      categoryUpper.includes('FROZEN DINNERS & ENTREES') ||
                      categoryUpper.includes('SEASONING MIXES') ||
                      categoryUpper.includes('PREPARED WRAPS AND BURRITOS');
                      
                    if (isCommercialCategory) return null;

                    return (
                      <span className={food.brand ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-xs px-2 py-0.5 rounded-md font-semibold whitespace-nowrap" : "bg-slate-500/10 text-slate-300 border border-slate-500/20 text-xs px-2 py-0.5 rounded-md font-semibold whitespace-nowrap"}>
                        {food.brand ? (food.brand.length > 25 ? food.brand.substring(0, 25) + '...' : food.brand) : "Branded Packaged"}
                      </span>
                    );
                  })()
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className={`inline-flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-widest border ${badge.cls}`}>
                  <BadgeIcon className="w-2.5 h-2.5" />
                  {badge.label}
                </span>
                <span className="text-[9px] font-bold text-accent-teal/80 bg-accent-teal/10 px-1.5 py-0.5 rounded-full uppercase tracking-widest">
                  {food.category?.split(',')[0]?.trim() || 'General'}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-black text-slate-100 leading-none">{food.calories}</p>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">kcal</p>
            </div>
          </div>

          {/* Serving label */}
          <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-3">per 100g serving</p>

          {/* Macro tag pills */}
          <div className="flex items-center gap-2">
            <span className="flex-1 text-center py-1.5 rounded-lg bg-pink-500/10 border border-pink-500/15 text-[10px] font-bold text-accent-pink">
              P {food.protein}g
            </span>
            <span className="flex-1 text-center py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/15 text-[10px] font-bold text-accent-yellow">
              C {food.carbs}g
            </span>
            <span className="flex-1 text-center py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/15 text-[10px] font-bold text-accent-green">
              F {food.fat}g
            </span>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header and Date Selector */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
            Food Search & Journal
            {!isToday && <Lock className="w-5 h-5 text-amber-500" />}
          </h1>
          <p className="text-slate-400 text-sm mt-1">Search local & global databases to manage your daily logs</p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {!isToday && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3.5 py-2 text-xs font-extrabold uppercase text-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.08)]">
              <Lock className="h-4 w-4" />
              Read-only history
            </div>
          )}

          <div className="flex items-center gap-2 bg-white/5 border border-white/10 p-1.5 rounded-2xl backdrop-blur-md">
            <button
              type="button"
              onClick={() => changeDateByOffset(-1)}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors text-slate-400 hover:text-white"
              aria-label="Go to previous day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsDateModalOpen(true)}
              className={`flex min-w-[170px] items-center justify-center gap-2 px-4 py-2 font-semibold text-sm rounded-xl transition-all ${
                isToday
                  ? 'text-white hover:bg-white/5'
                  : 'bg-amber-500/10 text-amber-300 border border-amber-400/20 hover:bg-amber-500/15'
              }`}
              aria-haspopup="dialog"
              aria-expanded={isDateModalOpen}
            >
              <Calendar className={`w-4 h-4 ${isToday ? 'text-accent-teal' : 'text-amber-400'}`} />
              <span>{getDisplayDateLabel()}</span>
            </button>

            <button
              type="button"
              onClick={() => changeDateByOffset(1)}
              disabled={!canNavigateForward}
              className={`p-2 rounded-xl transition-colors ${
                canNavigateForward
                  ? 'text-slate-400 hover:text-white hover:bg-white/10'
                  : 'text-white/10 cursor-not-allowed'
              }`}
              aria-label="Go to next day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Date Selector Modal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isDateModalOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) setIsDateModalOpen(false);
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 14 }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
                className="bg-[#11131a]/90 backdrop-blur-xl border border-white/[0.07] p-6 rounded-2xl max-w-md w-full shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] max-h-[88vh] overflow-hidden flex flex-col"
                role="dialog"
                aria-modal="true"
                aria-label="Select active food log date"
              >
                <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] pb-5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-accent-teal">Active log date</p>
                    <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-white">Select Date</h2>
                    <p className="mt-1 text-sm text-slate-400">Past logs open in read-only mode.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDateModalOpen(false)}
                    className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Close date selector"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="mt-5 max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                  {getDateOptions().map((opt) => (
                    <button
                      key={opt.dateStr}
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => handleDateSelection(opt)}
                      className={`group w-full rounded-xl border px-4 py-3.5 text-left transition-all duration-200 ${
                        opt.disabled
                          ? 'cursor-not-allowed border-white/[0.04] bg-white/[0.02] text-slate-500 opacity-60'
                          : opt.isSelected
                            ? 'border-accent-teal/40 bg-accent-teal/10 text-white shadow-[0_0_22px_rgba(34,211,238,0.08)]'
                            : 'border-white/[0.06] bg-white/[0.03] text-slate-300 hover:bg-white/5 hover:border-white/[0.12] hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-extrabold leading-tight">{opt.label}</p>
                            {opt.isSelected && (
                              <span className="rounded-full bg-accent-teal/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-teal">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs font-medium text-slate-400">{getFullDateLabel(opt.dateStr)}</p>
                          <p className={`mt-2 text-[11px] font-bold uppercase tracking-wider ${
                            opt.disabled ? 'text-slate-500' : opt.isTodayOption ? 'text-accent-teal' : 'text-amber-300'
                          }`}>
                            {opt.description}
                          </p>
                        </div>

                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                          opt.disabled
                            ? 'border-white/[0.05] bg-white/[0.03] text-slate-600'
                            : opt.isSelected
                              ? 'border-accent-teal/30 bg-accent-teal/15 text-accent-teal'
                              : 'border-white/[0.06] bg-white/[0.04] text-slate-500 group-hover:text-white'
                        }`}>
                          {opt.disabled ? (
                            <Lock className="h-4 w-4" />
                          ) : opt.isSelected ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Calendar className="h-4 w-4" />
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Past Date Alert Bar */}
      <AnimatePresence>
        {!isToday && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -10 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -10 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/15 p-4 text-amber-200 shadow-[0_0_30px_rgba(251,191,36,0.08)]">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-300" />
              <div className="text-sm">
                <span className="font-bold">Historical log for {getDisplayDateLabel()} is locked in read-only mode.</span>
                <span className="ml-1 text-amber-100/80">Return to Today to add, edit, or remove food entries.</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start relative">
        
        {/* Left Pane (2/3 width) - Search & Grid */}
        <div className="lg:col-span-8 space-y-6">
          {/* Search Bar & Category Filters */}
          <GlassCard className="space-y-4" delay={0.05} hover={false}>
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
              {/* Search Input */}
              <div className="relative flex-1 w-full">
                <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search local DB, USDA, & Open Food Facts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-accent-purple focus:ring-1 focus:ring-accent-purple transition-all duration-300 rounded-xl py-3.5 pl-12 pr-10 text-sm text-white placeholder-slate-500 outline-none"
                />
                {searchQuery && (
                  <button 
                    onClick={() => { setSearchQuery(''); setApiResults([]); setApiSearched(false); }}
                    className="absolute right-4 top-4 text-slate-500 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Results count + API status indicator */}
              <div className="flex items-center gap-2 shrink-0">
                {apiLoading && (
                  <Loader2 className="w-4 h-4 text-accent-teal animate-spin" />
                )}
                {apiSearched && !apiLoading && apiResults.length > 0 && (
                  <Wifi className="w-4 h-4 text-accent-green" />
                )}
                {apiSearched && !apiLoading && apiResults.length === 0 && apiErrors.length > 0 && (
                  <WifiOff className="w-4 h-4 text-amber-400" />
                )}
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest whitespace-nowrap">
                  {totalResultCount} items
                </span>
              </div>
            </div>

            {/* Category pills */}
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 ${
                    activeCategory === cat 
                      ? 'bg-gradient-to-r from-accent-purple to-accent-teal text-white shadow-md shadow-accent-purple/20' 
                      : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Active API search indicator */}
            {hasSearchQuery && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent-purple/5 border border-accent-purple/10">
                <Sparkles className="w-3.5 h-3.5 text-accent-purple" />
                <span className="text-[10px] text-slate-400 font-semibold">
                  Searching across <span className="text-accent-teal font-bold">Local DB</span> + <span className="text-emerald-400 font-bold">USDA (300K+)</span> + <span className="text-blue-400 font-bold">Open Food Facts (2M+)</span>
                </span>
              </div>
            )}
          </GlassCard>

          {/* Food Card Grid — Local Results */}
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto pr-1 pb-4 space-y-6">
            {/* LOCAL RESULTS SECTION */}
            {filteredLocalFoods.length > 0 && (
              <div>
                {hasSearchQuery && (
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="w-4 h-4 text-accent-teal" />
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Local Database</span>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">({filteredLocalFoods.length})</span>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {filteredLocalFoods.map((food, index) => renderFoodCard({ ...food, source: 'Local' }, index, 0))}
                </div>
              </div>
            )}

            {/* API RESULTS SECTION */}
            {hasSearchQuery && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="w-4 h-4 text-accent-purple" />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Online Results</span>
                  {apiLoading ? (
                    <span className="flex items-center gap-1.5 text-[10px] text-accent-teal font-bold uppercase tracking-wider">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Searching global databases...
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                      ({apiResults.length})
                    </span>
                  )}
                </div>

                {/* API error warnings */}
                {apiErrors.length > 0 && !apiLoading && (
                  <div className="flex items-center gap-2 mb-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300 font-semibold">
                    <WifiOff className="w-3.5 h-3.5 shrink-0" />
                    {apiErrors.join(' · ')} — Showing local results as fallback.
                  </div>
                )}

                {/* API loading skeleton */}
                {apiLoading && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="bg-slate-950/40 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-5 animate-pulse">
                        <div className="h-4 bg-white/5 rounded-lg mb-3 w-3/4" />
                        <div className="h-3 bg-white/5 rounded-lg mb-4 w-1/2" />
                        <div className="flex gap-2">
                          <div className="flex-1 h-8 bg-white/5 rounded-lg" />
                          <div className="flex-1 h-8 bg-white/5 rounded-lg" />
                          <div className="flex-1 h-8 bg-white/5 rounded-lg" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* API result cards */}
                {!apiLoading && apiResults.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {apiResults.map((food, index) => renderFoodCard(food, index, 0.1))}
                  </div>
                )}

                {/* No API results state */}
                {!apiLoading && apiSearched && apiResults.length === 0 && apiErrors.length === 0 && (
                  <div className="py-8 flex flex-col items-center justify-center text-center">
                    <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 mb-2">
                      <Globe className="w-4 h-4" />
                    </div>
                    <p className="text-xs font-semibold text-slate-400">No online results found for "{searchQuery}"</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Try a different search term or check spelling</p>
                  </div>
                )}
              </div>
            )}

            {/* Global empty state (no local AND no API results) */}
            {filteredLocalFoods.length === 0 && (!hasSearchQuery || (!apiLoading && apiResults.length === 0)) && (
              <div className="py-16 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 mb-3">
                  <Search className="w-5 h-5" />
                </div>
                <p className="text-sm font-semibold text-slate-400">No food items match your search</p>
                <p className="text-xs text-slate-500 mt-1">Try a different keyword or category filter</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Pane (1/3 width) - Sticky Log Sidebar */}
        <div className="lg:col-span-4 sticky top-8">
          <GlassCard className={`flex flex-col h-[calc(100vh-140px)] border-t-2 ${isToday ? 'border-t-accent-teal' : 'border-t-amber-500/80'}`} delay={0.15} hover={false}>
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.06] mb-4">
              <p className="text-sm font-extrabold text-white tracking-tight flex items-center gap-2">
                <Utensils className={`w-4 h-4 ${isToday ? 'text-accent-teal' : 'text-amber-500'}`} />
                {isToday ? 'Current Log Tracker' : 'Read-only Log Tracker'}
              </p>
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">{loggedItems.length} logged</span>
            </div>

            {/* Logged items list */}
            <div className="flex-1 overflow-y-auto pr-2 space-y-3">
              {loading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-500 text-xs">
                  Loading food items...
                </div>
              ) : loggedItems.length === 0 ? (
                <div className="py-12 flex flex-col items-center text-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 mb-3">
                    <Utensils className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-semibold text-slate-400">Empty log tracker</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-[220px]">
                    {isToday ? 'Use the food cards to search and log entries.' : 'No entries were logged for this historical date.'}
                  </p>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {loggedItems.map((item) => (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="flex flex-col gap-3 bg-white/[0.02] border border-white/[0.04] p-3.5 rounded-xl hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0 pr-2">
                          <p className="text-sm font-bold text-white leading-snug">{item.foodName}</p>
                          <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-semibold">
                            {item.mealType} &middot; {item.servingGrams}g
                            {item.foodSource && item.foodSource !== 'Local' && (
                              <span className="ml-1.5 text-emerald-400">· {item.foodSource}</span>
                            )}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-extrabold text-slate-100">{item.calories}</p>
                          <p className="text-[9px] text-slate-500 font-semibold uppercase mt-0.5">kcal</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-bold text-accent-pink bg-pink-500/10 px-1.5 py-0.5 rounded">P {item.protein}g</span>
                          <span className="text-[9px] font-bold text-accent-yellow bg-yellow-500/10 px-1.5 py-0.5 rounded">C {item.carbs}g</span>
                          <span className="text-[9px] font-bold text-accent-green bg-emerald-500/10 px-1.5 py-0.5 rounded">F {item.fat}g</span>
                        </div>
                        {isToday && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => handleEditItem(item)}
                              className="p-2 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 transition-colors animate-fade-in min-w-[44px] min-h-[44px] flex items-center justify-center"
                              title="Edit entry details"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                              title="Remove log entry"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* Daily Summary totals at the bottom */}
            <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-4 shrink-0">
              <div className="flex items-center justify-between text-white font-extrabold">
                <span className="text-sm">Total Logged</span>
                <span className="text-lg bg-gradient-to-r from-accent-purple to-accent-teal bg-clip-text text-transparent">{Math.round(dailyTotals.calories)} kcal</span>
              </div>
              
              <div className="grid grid-cols-4 gap-2 text-center text-[10px] text-slate-400">
                <div className="bg-white/5 border border-white/10 py-2 rounded-xl">
                  <p className="font-bold text-accent-pink">{Number(dailyTotals.protein.toFixed(2))}g</p>
                  <p className="uppercase mt-0.5 text-slate-500 font-bold">Pro</p>
                </div>
                <div className="bg-white/5 border border-white/10 py-2 rounded-xl">
                  <p className="font-bold text-accent-yellow">{Number(dailyTotals.carbs.toFixed(2))}g</p>
                  <p className="uppercase mt-0.5 text-slate-500 font-bold">Carb</p>
                </div>
                <div className="bg-white/5 border border-white/10 py-2 rounded-xl">
                  <p className="font-bold text-accent-green">{Number(dailyTotals.fat.toFixed(2))}g</p>
                  <p className="uppercase mt-0.5 text-slate-500 font-bold">Fat</p>
                </div>
                <div className="bg-white/5 border border-white/10 py-2 rounded-xl">
                  <p className="font-bold text-accent-blue">{Number(dailyTotals.fiber.toFixed(2))}g</p>
                  <p className="uppercase mt-0.5 text-slate-500 font-bold">Fib</p>
                </div>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Modal Overlay — appears when a food card is clicked */}
      <AnimatePresence>
        {selectedFood && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) { setSelectedFood(null); setEditingItem(null); } }}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="relative w-[calc(100%-2rem)] mx-auto max-w-2xl bg-slate-950/90 backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-6 sm:p-8 shadow-[0_16px_64px_0_rgba(0,0,0,0.6)] z-10 max-h-[90vh] overflow-y-auto no-scrollbar flex flex-col"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-5 mb-6">
                <div className="flex-1 min-w-0">
                  <h3 className="text-2xl font-extrabold text-slate-100">
                    {editingItem ? `Editing: ${selectedFood.name}` : selectedFood.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="inline-block text-[10px] font-bold text-accent-teal bg-accent-teal/10 px-2.5 py-1 rounded-full uppercase tracking-widest border border-accent-teal/20">
                      {selectedFood.category?.split(',')[0]?.trim() || 'General'}
                    </span>
                    {selectedFood.source && selectedFood.source !== 'Local' && (() => {
                      const badge = SOURCE_BADGES[selectedFood.source];
                      if (!badge) return null;
                      const BadgeIcon = badge.icon;
                      return (
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest border ${badge.cls}`}>
                          <BadgeIcon className="w-3 h-3" />
                          {selectedFood.source}
                        </span>
                      );
                    })()}
                    {selectedFood.brand && (
                      <span className="text-[10px] text-slate-500 font-semibold">{selectedFood.brand}</span>
                    )}
                  </div>
                </div>
                <button 
                  onClick={() => { setSelectedFood(null); setEditingItem(null); }}
                  className="p-2.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Serving size & Meal slot — side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                {/* Serving size */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3 ml-1">Quantity (Grams)</label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setServingGrams(Math.max(10, servingGrams - 50))}
                      className="p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 text-white transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
                    >
                      <Minus className="w-5 h-5" />
                    </button>
                    <input
                      type="number"
                      value={servingGrams}
                      min="10"
                      max="2000"
                      onChange={(e) => setServingGrams(Math.max(1, parseInt(e.target.value) || 0))}
                      className="flex-1 min-w-0 bg-white/[0.03] border border-white/[0.08] focus:border-accent-teal focus:ring-1 focus:ring-accent-teal text-center transition-all duration-300 rounded-xl py-3 text-base sm:text-lg font-bold text-white outline-none"
                    />
                    <button
                      onClick={() => setServingGrams(servingGrams + 50)}
                      className="p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 text-white transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Quick Chips */}
                  <div className="flex gap-2 mt-4">
                    {[50, 100, 150, 200, 250].map((grams) => (
                      <button
                        key={grams}
                        onClick={() => setServingGrams(grams)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase transition-colors ${
                          servingGrams === grams 
                            ? 'bg-accent-teal text-canvas shadow-sm' 
                            : 'bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400'
                        }`}
                      >
                        {grams}g
                      </button>
                    ))}
                  </div>
                </div>

                {/* Meal slot */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3 ml-1">Meal Classification</label>
                  <div className="grid grid-cols-2 gap-3">
                    {['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map((slot) => (
                      <button
                        key={slot}
                        onClick={() => setMealSlot(slot)}
                        className={`py-3.5 rounded-xl text-xs font-semibold uppercase transition-all duration-300 ${
                          mealSlot === slot 
                            ? 'bg-gradient-to-r from-accent-purple to-accent-teal text-white shadow-md' 
                            : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Calculated metrics display */}
              <div className="grid grid-cols-5 gap-3 bg-white/[0.02] border border-white/[0.04] p-5 rounded-xl text-center mb-6">
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Calories</p>
                  <p className="text-xl font-extrabold text-slate-100 mt-1">{calculated.calories}</p>
                  <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">kcal</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Protein</p>
                  <p className="text-xl font-extrabold text-accent-pink mt-1">{calculated.protein}g</p>
                  <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">P</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Carbs</p>
                  <p className="text-xl font-extrabold text-accent-yellow mt-1">{calculated.carbs}g</p>
                  <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">C</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Fat</p>
                  <p className="text-xl font-extrabold text-accent-green mt-1">{calculated.fat}g</p>
                  <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">F</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Fiber</p>
                  <p className="text-xl font-extrabold text-accent-blue mt-1">{calculated.fiber}g</p>
                  <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">Fb</p>
                </div>
              </div>

              {/* Log/Update button */}
              {isToday ? (
                <button
                  onClick={editingItem ? handleUpdateFood : handleLogFood}
                  className="w-full py-4 bg-gradient-to-r from-accent-purple to-accent-teal hover:from-accent-purple/90 hover:to-accent-teal/90 text-white font-bold rounded-xl text-base transition-all duration-300 shadow-md shadow-accent-purple/20 flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99]"
                >
                  <Check className="w-5 h-5" /> {editingItem ? 'Update Log Entry' : 'Log This Food'}
                </button>
              ) : (
                <div className="w-full py-4 bg-white/5 border border-white/10 text-slate-400 font-bold rounded-xl text-base flex items-center justify-center gap-2 cursor-not-allowed">
                  <Lock className="w-5 h-5" /> Cannot log to past dates
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
