/**
 * Food Search API Service
 *
 * Provides a unified interface for searching foods from multiple sources:
 *
 * 1. USDA FoodData Central (300,000+ foods)
 *    - Production: Routed through Firebase Cloud Function proxy (key stays server-side)
 *    - Development: Falls back to direct API call using VITE_USDA_API_KEY from .env.local
 *                   (this code path is tree-shaken out of production builds by Vite)
 *
 * 2. Open Food Facts (2M+ products, strong Indian packaged food coverage)
 *    - Called directly from the frontend (no API key required, public API)
 *
 * Both sources normalize results into a standard food item format compatible
 * with the existing FOOD_DB structure used in FoodSearch.jsx.
 *
 * Standard Food Item Format:
 *   { id, name, brand?, category, source, calories, protein, carbs, fat, fiber }
 *   All macros are per 100g serving.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

// Initialize Firebase Functions client
const functions = getFunctions(app);

/* ══════════════════════════════════════════════════════════════
   USDA FoodData Central Search
   ══════════════════════════════════════════════════════════════ */

/**
 * Extract a specific nutrient from USDA's foodNutrients array.
 * @param {Array} nutrients - Array of nutrient objects from USDA response
 * @param {string} name - Nutrient name to search for (partial match)
 * @returns {number} Nutrient value per 100g, rounded to 1 decimal
 */
function extractUSDANutrient(nutrients, name) {
  if (!nutrients || !Array.isArray(nutrients)) return 0;
  const found = nutrients.find((n) =>
    n.nutrientName?.toLowerCase().includes(name.toLowerCase())
  );
  return found ? Math.round(found.value * 10) / 10 : 0;
}

/**
 * Format USDA food names from their verbose naming convention.
 * "CHICKEN BREAST, ROASTED, SKIN REMOVED" → "Chicken Breast"
 */
function titleCase(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(',')[0]
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Normalize raw USDA API results into our standard food item format.
 */
function normalizeUSDAResults(foods) {
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
    .filter((f) => f.calories > 0 || f.protein > 0);
}

/**
 * Search USDA FoodData Central.
 *
 * In production: Routes through the Firebase Cloud Function proxy
 *   (API key stays server-side, never in the browser bundle).
 *
 * In development: If the Cloud Function is unavailable (not deployed / emulator
 *   not running), gracefully falls back to a direct API call using the
 *   VITE_USDA_API_KEY from .env.local. This fallback code is completely
 *   tree-shaken out of production builds by Vite's dead-code elimination
 *   (import.meta.env.DEV is replaced with `false` at build time).
 *
 * @param {string} query - Search term (minimum 2 characters)
 * @returns {Promise<Array>} Array of normalized food items
 */
export async function searchUSDA(query) {
  if (!query || query.trim().length < 2) return [];

  try {
    // Attempt Cloud Function call (works if deployed or emulator running)
    const searchFn = httpsCallable(functions, 'searchUSDA');
    const result = await searchFn({ query: query.trim() });
    return result.data?.foods || [];
  } catch (cloudFnError) {
    console.warn(
      'Cloud Function unavailable, attempting development fallback:',
      cloudFnError.code || cloudFnError.message
    );

    // ── Development-only direct fallback ──
    // This entire block is removed from production builds by Vite's
    // dead-code elimination when import.meta.env.DEV === false.
    if (import.meta.env.DEV) {
      return searchUSDADirect(query);
    }

    // In production without Cloud Function, USDA search is unavailable
    console.error('USDA search unavailable — Cloud Function not deployed.');
    return [];
  }
}

/**
 * Direct USDA API call — DEVELOPMENT ONLY.
 *
 * This function is called only when:
 *   1. The Cloud Function is not deployed/available
 *   2. The app is running in development mode (import.meta.env.DEV === true)
 *
 * In production builds, Vite replaces import.meta.env.DEV with `false`,
 * and the calling code block is removed by the minifier. This function
 * becomes unreachable dead code and is also tree-shaken out.
 *
 * @param {string} query - Search term
 * @returns {Promise<Array>} Array of normalized food items
 */
async function searchUSDADirect(query) {
  // Safety guard: never execute in production
  if (!import.meta.env.DEV) return [];

  const apiKey = import.meta.env.VITE_USDA_API_KEY;
  if (!apiKey) {
    console.warn(
      'VITE_USDA_API_KEY not found in .env.local — USDA search unavailable in dev mode.'
    );
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
    return normalizeUSDAResults(data.foods || []);
  } catch (error) {
    console.error('Direct USDA search error:', error);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════════
   Open Food Facts Search (No API Key Required)
   ══════════════════════════════════════════════════════════════ */

/**
 * Normalize raw Open Food Facts product results into our standard format.
 */
function normalizeOFFResults(products) {
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
    .filter((f) => f.calories > 0 || f.protein > 0);
}

/**
 * Search Open Food Facts database.
 *
 * This is a public API with no key required.
 * Called directly from the frontend in all environments.
 * Has excellent coverage of Indian packaged foods and beverages.
 *
 * @param {string} query - Search term (minimum 2 characters)
 * @returns {Promise<Array>} Array of normalized food items
 */
export async function searchOpenFoodFacts(query) {
  if (!query || query.trim().length < 2) return [];

  try {
    const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
    url.searchParams.set('search_terms', query.trim());
    url.searchParams.set('search_simple', '1');
    url.searchParams.set('action', 'process');
    url.searchParams.set('json', '1');
    url.searchParams.set('page_size', '15');
    url.searchParams.set(
      'fields',
      'code,product_name,brands,categories_tags_en,nutriments,image_small_url'
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Open Food Facts API returned status ${response.status}`);
    }

    const data = await response.json();
    return normalizeOFFResults(data.products || []);
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
   Unified Multi-Source Search
   ══════════════════════════════════════════════════════════════ */

/**
 * Helper: Deduplicate similar foods with identical macros
 * Combines brand names for identical foods.
 */
export function deduplicateFoods(foods) {
  if (!foods || !Array.isArray(foods)) return [];
  const seen = new Map();
  
  for (const food of foods) {
    const normalizedName = food.name.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const key = `${normalizedName}_${Math.round(food.calories)}_${Math.round(food.protein * 10) / 10}_${Math.round(food.carbs * 10) / 10}_${Math.round(food.fat * 10) / 10}_${Math.round(food.fiber * 10) / 10}`;
    
    if (seen.has(key)) {
      const existing = seen.get(key);
      if (food.brand && !existing._brands.includes(food.brand)) {
        existing._brands.push(food.brand);
      }
    } else {
      seen.set(key, {
        ...food,
        _brands: food.brand ? [food.brand] : []
      });
    }
  }
  
  return Array.from(seen.values()).map(item => {
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

/**
 * Searches all available external food databases simultaneously.
 *
 * Uses Promise.allSettled to ensure partial results are returned
 * even if one source fails. Never throws — always returns a result
 * object with data and error arrays.
 *
 * @param {string} query - Search term (minimum 2 characters)
 * @returns {Promise<{usda: Array, off: Array, errors: string[]}>}
 */
export async function searchAllAPIs(query) {
  if (!query || query.trim().length < 2) {
    return { usda: [], off: [], errors: [] };
  }

  const errors = [];

  const [usdaResult, offResult] = await Promise.allSettled([
    searchUSDA(query),
    searchOpenFoodFacts(query),
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

  return {
    usda: deduplicateFoods(usda),
    off: deduplicateFoods(off),
    errors
  };
}
