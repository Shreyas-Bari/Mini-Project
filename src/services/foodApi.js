/**
 * Food Search API Service
 *
 * Provides a unified interface for searching foods from multiple sources:
 *
 * 1. USDA FoodData Central (300,000+ foods)
 *    - Production: Routed through Firebase Cloud Function proxy
 *    - Development: Falls back to direct API call
 *
 * 2. Open Food Facts (2M+ products)
 *    - Called directly from the frontend
 *
 * Includes Strict Data Validation, Tiered Deduplication, Cleansing, and Contextual Filtering.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

// Initialize Firebase Functions client
const functions = getFunctions(app);

/* ══════════════════════════════════════════════════════════════
   INDIAN CONTEXT KEYWORD NORMALIZATION & TOKENIZATION
   ══════════════════════════════════════════════════════════════ */
export function normalizeQuery(query) {
  let q = query.toLowerCase().trim();
  // Normalize common variations of Indian staples
  if (["panner", "paner", "panier", "paneer"].includes(q)) return "paneer";
  if (["dhal", "daal", "dal"].includes(q)) return "dal";
  if (["chappati", "chapati", "chapatti", "roti"].includes(q)) return "roti";
  return q;
}

function getSearchTokens(query) {
  const q = query.toLowerCase().trim();
  const tokens = new Set(q.match(/\b\w+\b/g) || []);
  
  // Inject common synonyms for Indian foods
  if (tokens.has('bottle') && tokens.has('gourd')) tokens.add('lauki');
  if (tokens.has('bitter') && tokens.has('gourd')) tokens.add('karela');
  if (tokens.has('ridge') && tokens.has('gourd')) tokens.add('turai');
  if (tokens.has('lady') && tokens.has('finger')) { tokens.add('okra'); tokens.add('bhindi'); }
  if (tokens.has('okra')) tokens.add('bhindi');
  if (tokens.has('cottage') && tokens.has('cheese')) tokens.add('paneer');
  if (tokens.has('clarified') && tokens.has('butter')) tokens.add('ghee');
  if (tokens.has('panner') || tokens.has('paner') || tokens.has('panier')) tokens.add('paneer');
  
  return Array.from(tokens).filter(t => t.length > 2); // only significant tokens
}

function isRelevantMatch(food, queryTokens) {
  if (queryTokens.length === 0) return true; // fallback if query had no significant tokens
  
  const title = (food.name || '').toLowerCase();
  const brand = (food.brand || '').toLowerCase();
  const cat = (food.category || '').toLowerCase();
  const targetString = `${title} ${brand} ${cat}`;
  
  for (const token of queryTokens) {
    if (targetString.includes(token)) return true;
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════
   STRICT MATHEMATICAL VALIDATION (Hard-Drop Rule & Zero-Macro Loophole)
   ══════════════════════════════════════════════════════════════ */
function isValidFood(food) {
  const isInvalid = (val) => val === null || val === undefined || val === '' || isNaN(Number(val));
  
  if (isInvalid(food.calories) || isInvalid(food.protein) || isInvalid(food.carbs) || isInvalid(food.fat)) {
    return false;
  }
  
  const cals = Number(food.calories);
  const pro = Number(food.protein);
  const carb = Number(food.carbs);
  const fat = Number(food.fat);
  
  // Close the Zero-Macro Loophole: Drop completely empty records unless it's water/diet soda
  if (cals === 0 && pro === 0 && carb === 0 && fat === 0) {
    const title = (food.name || '').toLowerCase();
    const cat = (food.category || '').toLowerCase();
    if (!title.includes('water') && !cat.includes('water') && !title.includes('diet soda') && !cat.includes('diet soda')) {
      return false; // Zero-Macro loophole closed
    }
    return true; // Pass valid zero-calorie liquids
  }
  
  // Calculated Calories = (Protein * 4) + (Carbohydrates * 4) + (Fat * 9)
  const calculatedCals = (pro * 4) + (carb * 4) + (fat * 9);
  
  if (calculatedCals === 0 && cals > 0) return false;
  
  const variance = Math.abs(cals - calculatedCals) / Math.max(cals, calculatedCals);
  
  // 12% tolerance threshold
  if (variance > 0.12) {
    return false;
  }
  
  return true;
}

/* ══════════════════════════════════════════════════════════════
   CONTEXTUAL CATEGORY & STRUCTURAL FILTERING
   ══════════════════════════════════════════════════════════════ */
function isContextuallyValid(food, originalQuery, activeCategory) {
  const q = originalQuery.toLowerCase();
  const cat = (food.category || '').toUpperCase();
  const name = food.name.toLowerCase();

  // 1. Strict Category Cross-Reference for Dairy Staples
  if (q.includes("paneer") || q.includes("curd") || q.includes("milk")) {
    if (
      cat.includes("NUT & SEED BUTTERS") || 
      cat.includes("NUT BUTTER") ||
      cat.includes("SEED BUTTER") ||
      cat.includes("CONFECTIONERY") ||
      cat.includes("CANDY")
    ) {
      return false; // Drop completely mismatched categories
    }
  }

  // 2. Active Category Filtering & Baseline Strictness
  if (activeCategory === 'All') {
    // Baseline strictness for All
    if (cat.includes("NON-FOOD") || cat.includes("COSMETICS") || cat.includes("BODY CARE")) return false;
  }

  if (activeCategory === 'Dairy') {
    if (cat.includes("MEAT") || cat.includes("POULTRY") || cat.includes("FISH")) return false;
    // Real paneer should be structurally accurate (near-zero carb, high-protein/fat)
    if (q.includes("paneer") && food.carbs > 10) return false;
  }

  if (activeCategory === 'Vegetables & Fruits') {
    if (cat.includes("MEAT") || cat.includes("POULTRY") || cat.includes("FISH") || cat.includes("DAIRY")) return false;
    // Basic structural rejection of high protein stuff in veg unless it's beans/soy
    if (food.protein > 15 && !name.includes("soy") && !name.includes("bean")) return false;
  }
  
  if (activeCategory === 'Cooked Meals') {
    if (cat.includes("RAW") || cat.includes("UNCOOKED")) return false;
  }

  return true;
}

/* ══════════════════════════════════════════════════════════════
   STRING MATCHING & DEDUPLICATION (Levenshtein)
   ══════════════════════════════════════════════════════════════ */
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  for (let i = 0; i <= a.length; i += 1) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  return matrix[b.length][a.length];
}

function areNamesSimilar(name1, name2) {
  const n1 = name1.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  const n2 = name2.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  if (n1 === n2) return true;
  
  const dist = levenshtein(n1, n2);
  const maxLen = Math.max(n1.length, n2.length);
  // Max distance of 2 for short words, scaled up for longer words
  if (maxLen > 4 && dist <= Math.min(2, Math.floor(maxLen * 0.2))) {
    return true;
  }
  
  // Token intersection matching (Jaccard similarity)
  const tokens1 = new Set(name1.match(/\b\w+\b/g) || []);
  const tokens2 = new Set(name2.match(/\b\w+\b/g) || []);
  const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);
  if (union.size > 0 && intersection.size / union.size > 0.75) {
    return true;
  }
  
  return false;
}

function getTier(food) {
  // Tier 1: USDA Foundation / Verified Local
  if (food.source === 'USDA' || food.source === 'Local') return 1;
  // Tier 2: Open Food Facts Commercial
  if (food.source === 'Open Food Facts') return 2;
  return 3;
}

export function deduplicateFoods(foods) {
  if (!foods || !Array.isArray(foods)) return [];
  const uniqueFoods = [];
  
  for (const food of foods) {
    let duplicateIndex = -1;
    for (let i = 0; i < uniqueFoods.length; i++) {
      if (areNamesSimilar(food.name, uniqueFoods[i].name)) {
        duplicateIndex = i;
        break;
      }
    }
    
    if (duplicateIndex !== -1) {
      const existing = uniqueFoods[duplicateIndex];
      const existingTier = getTier(existing);
      const newTier = getTier(food);
      
      // If new food is higher tier (lower number), replace existing stats but merge brands
      if (newTier < existingTier) {
        const mergedBrands = [...new Set([...existing._brands, food.brand])].filter(Boolean);
        uniqueFoods[duplicateIndex] = {
          ...food,
          _brands: mergedBrands
        };
      } else {
        if (food.brand && !existing._brands.includes(food.brand)) {
          existing._brands.push(food.brand);
        }
      }
    } else {
      uniqueFoods.push({
        ...food,
        _brands: food.brand ? [food.brand] : []
      });
    }
  }
  
  return uniqueFoods.map(item => {
    if (item._brands && item._brands.length > 0) {
      if (item._brands.length === 1) {
        item.brand = item._brands[0];
      } else {
        item._brands.sort();
        const primary = item._brands.slice(0, 3);
        const remaining = item._brands.length - 3;
        item.brand = `${primary.join(', ')}${remaining > 0 ? ` & ${remaining} other${remaining > 1 ? 's' : ''}` : ''}`;
      }
    } else {
      item.brand = '';
    }
    delete item._brands;
    return item;
  });
}

/* ══════════════════════════════════════════════════════════════
   USDA FoodData Central Search
   ══════════════════════════════════════════════════════════════ */

function extractUSDANutrient(nutrients, name) {
  if (!nutrients || !Array.isArray(nutrients)) return 0;
  const found = nutrients.find((n) =>
    n.nutrientName?.toLowerCase().includes(name.toLowerCase())
  );
  return found ? Math.round(found.value * 10) / 10 : 0;
}

function titleCase(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(',')[0]
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeUSDAResults(foods, originalQuery, activeCategory, queryTokens) {
  return foods
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
    .filter((f) => isValidFood(f) && isContextuallyValid(f, originalQuery, activeCategory) && isRelevantMatch(f, queryTokens));
}

export async function searchUSDA(query, activeCategory = 'All', queryTokens = []) {
  if (!query || query.trim().length < 2) return [];

  try {
    const searchFn = httpsCallable(functions, 'searchUSDA');
    const result = await searchFn({ query: query.trim() });
    const foods = result.data?.foods || [];
    // Just in case backend validation fails or is outdated, validate here too
    return foods.filter(f => isValidFood(f) && isContextuallyValid(f, query, activeCategory) && isRelevantMatch(f, queryTokens));
  } catch (cloudFnError) {
    console.warn(
      'Cloud Function unavailable, attempting development fallback:',
      cloudFnError.code || cloudFnError.message
    );
    if (import.meta.env.DEV) {
      return searchUSDADirect(query, activeCategory, queryTokens);
    }
    console.error('USDA search unavailable — Cloud Function not deployed.');
    return [];
  }
}

async function searchUSDADirect(query, activeCategory, queryTokens) {
  if (!import.meta.env.DEV) return [];

  const apiKey = import.meta.env.VITE_USDA_API_KEY;
  if (!apiKey) {
    console.warn('VITE_USDA_API_KEY not found in .env.local — USDA search unavailable in dev mode.');
    return [];
  }

  try {
    const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('query', query.trim());
    url.searchParams.set('pageSize', '20');
    url.searchParams.set('dataType', 'Foundation,SR Legacy,Branded');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`USDA API returned status ${response.status}`);
    }

    const data = await response.json();
    return normalizeUSDAResults(data.foods || [], query, activeCategory, queryTokens);
  } catch (error) {
    console.error('Direct USDA search error:', error);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════════
   Open Food Facts Search
   ══════════════════════════════════════════════════════════════ */

function normalizeOFFResults(products, originalQuery, activeCategory, queryTokens) {
  return products
    .filter((p) => p.product_name)
    .map((product) => {
      const n = product.nutriments || {};
      const caloriesKcal =
        n['energy-kcal_100g'] ||
        (n.energy_100g ? Math.round(n.energy_100g / 4.184) : 0);

      return {
        id: `off_${product.code || Math.random().toString(36).slice(2)}`,
        name: product.product_name || 'Unknown Product',
        brand: product.brands || '',
        category:
          (product.categories_tags_en || [])
            .slice(0, 1)
            .join(', ')
            .replace(/en:/g, '')
            .replace(/-/g, ' ') || 'Packaged Food',
        source: 'Open Food Facts',
        calories: Math.round(caloriesKcal),
        protein: Math.round((n.proteins_100g || 0) * 10) / 10,
        carbs: Math.round((n.carbohydrates_100g || 0) * 10) / 10,
        fat: Math.round((n.fat_100g || 0) * 10) / 10,
        fiber: Math.round((n.fiber_100g || 0) * 10) / 10,
      };
    })
    .filter((f) => isValidFood(f) && isContextuallyValid(f, originalQuery, activeCategory) && isRelevantMatch(f, queryTokens));
}

export async function searchOpenFoodFacts(query, activeCategory = 'All', queryTokens = []) {
  if (!query || query.trim().length < 2) return [];

  try {
    const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
    url.searchParams.set('search_terms', query.trim());
    url.searchParams.set('search_simple', '1');
    url.searchParams.set('action', 'process');
    url.searchParams.set('json', '1');
    url.searchParams.set('page_size', '15');
    url.searchParams.set('cc', 'in');
    url.searchParams.set('lc', 'en');
    url.searchParams.set(
      'fields',
      'code,product_name,brands,categories_tags_en,nutriments,image_small_url'
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Open Food Facts API returned status ${response.status}`);
    }

    const data = await response.json();
    return normalizeOFFResults(data.products || [], query, activeCategory, queryTokens);
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('Open Food Facts request timed out');
    } else {
      console.error('Open Food Facts search error:', error);
    }
    return [];
  }
}

/* ══════════════════════════════════════════════════════════════
   Unified Multi-Source Search Orchestration
   ══════════════════════════════════════════════════════════════ */

export async function searchAllAPIs(query, activeCategory = 'All') {
  if (!query || query.trim().length < 2) {
    return { usda: [], off: [], errors: [] };
  }

  const usingEmulator = window.location.hostname === "localhost";
  console.log("🚀 CURRENT SEARCH URL TARGET:", usingEmulator ? "http://localhost:5001" : "PRODUCTION LIVE API");

  const normalizedQuery = normalizeQuery(query);
  const queryTokens = getSearchTokens(normalizedQuery);

  const errors = [];

  const [usdaResult, offResult] = await Promise.allSettled([
    searchUSDA(normalizedQuery, activeCategory, queryTokens),
    searchOpenFoodFacts(normalizedQuery, activeCategory, queryTokens),
  ]);

  const usda = usdaResult.status === 'fulfilled' ? usdaResult.value : [];
  if (usdaResult.status === 'rejected') {
    errors.push('USDA search failed');
    console.error('USDA search rejected:', usdaResult.reason);
  }

  const off = offResult.status === 'fulfilled' ? offResult.value : [];
  if (offResult.status === 'rejected') {
    errors.push('Open Food Facts search failed');
    console.error('OFF search rejected:', offResult.reason);
  }

  // Deduplicate and prioritize across BOTH tiers
  const combined = [...usda, ...off];
  const cleanedAndTiered = deduplicateFoods(combined);
  
  // Return the completely cleaned array in the 'usda' bucket
  // and leave 'off' empty, since the React component just joins them anyway.
  return {
    usda: cleanedAndTiered,
    off: [],
    errors
  };
}
