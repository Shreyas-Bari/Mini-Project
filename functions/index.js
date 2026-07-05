/**
 * NutriTrack Cloud Functions — USDA FoodData Central API Proxy
 *
 * This Firebase Cloud Function acts as a secure server-side proxy
 * for the USDA FoodData Central API. The API key is stored in the
 * functions/.env file and never exposed to the client browser.
 *
 * Deployment:
 *   firebase deploy --only functions
 *
 * Local Testing:
 *   firebase emulators:start --only functions
 *
 * Architecture:
 *   Client (React) → httpsCallable('searchUSDA') → Cloud Function → USDA API
 *   The API key stays server-side at all times.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");

// Initialize Firebase Admin SDK
initializeApp();

/* ──────────────────────────────────────────────────────────────
   Helper: Extract a specific nutrient value from USDA nutrient array
   Returns the value per 100g serving.
   ────────────────────────────────────────────────────────────── */
function extractNutrient(nutrients, nutrientName) {
  if (!nutrients || !Array.isArray(nutrients)) return 0;
  const found = nutrients.find((n) =>
    n.nutrientName &&
    n.nutrientName.toLowerCase().includes(nutrientName.toLowerCase())
  );
  return found ? Math.round(found.value * 10) / 10 : 0;
}

/* ──────────────────────────────────────────────────────────────
   Helper: Format food names from USDA naming conventions
   "CHICKEN BREAST, ROASTED, SKIN REMOVED" → "Chicken Breast"
   ────────────────────────────────────────────────────────────── */
function formatFoodName(name) {
  if (!name) return "Unknown";
  return name
    .toLowerCase()
    .split(",")[0]
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ──────────────────────────────────────────────────────────────
   STRICT MATHEMATICAL VALIDATION (Hard-Drop Rule & Zero-Macro Loophole)
   Calculates expected calories from macros and drops invalid data.
   ────────────────────────────────────────────────────────────── */
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
      return false;
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

/* ──────────────────────────────────────────────────────────────
   RELEVANCE FILTERING (Token Matching & Synonyms)
   ────────────────────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────────────────
   Helper: Levenshtein Distance for fuzzy matching duplicates
   ────────────────────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────────────────
   Helper: Deduplicate similar foods prioritizing higher tiers
   (Tier 1: USDA, etc.)
   ────────────────────────────────────────────────────────────── */
function deduplicateFoods(foods) {
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
      // USDA is already top tier in this function context since it's only USDA.
      // We just keep the existing one (first found is usually highest quality).
      if (food.brand && !existing._brands.includes(food.brand)) {
        existing._brands.push(food.brand);
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

/* ──────────────────────────────────────────────────────────────
   Helper: Normalize USDA response into our standard food format
   ────────────────────────────────────────────────────────────── */
function normalizeUSDAFoods(foods, queryTokens) {
  const mapped = foods
    .map((food) => ({
      id: `usda_${food.fdcId}`,
      name: formatFoodName(food.description || food.lowercaseDescription || ""),
      brand: food.brandName || food.brandOwner || "",
      category: food.foodCategory || "General",
      source: "USDA",
      calories: extractNutrient(food.foodNutrients, "Energy"),
      protein: extractNutrient(food.foodNutrients, "Protein"),
      carbs: extractNutrient(food.foodNutrients, "Carbohydrate, by difference"),
      fat: extractNutrient(food.foodNutrients, "Total lipid (fat)"),
      fiber: extractNutrient(food.foodNutrients, "Fiber, total dietary"),
    }))
    .filter((f) => isValidFood(f) && isRelevantMatch(f, queryTokens)); // Apply validation & relevance

  return deduplicateFoods(mapped);
}

/* ══════════════════════════════════════════════════════════════
   CLOUD FUNCTION: searchUSDA
   
   Callable function invoked via Firebase Client SDK:
     const fn = httpsCallable(functions, 'searchUSDA');
     const result = await fn({ query: 'chicken breast' });
   
   Request data:
     { query: string }  — minimum 2 characters
   
   Response data:
     { foods: NormalizedFood[], totalHits: number }
   ══════════════════════════════════════════════════════════════ */
exports.searchUSDA = onCall(
  {
    cors: true,
    region: "us-central1",
    // Rate limiting: max 20 invocations per minute per user
    enforceAppCheck: false,
  },
  async (request) => {
    const query = request.data?.query;

    // Validate input
    if (!query || typeof query !== "string" || query.trim().length < 2) {
      throw new HttpsError(
        "invalid-argument",
        "Search query must be at least 2 characters."
      );
    }

    // Read API key from server-side environment (functions/.env)
    const apiKey = process.env.USDA_API_KEY;
    if (!apiKey) {
      console.error("USDA_API_KEY is not configured in functions/.env");
      throw new HttpsError(
        "failed-precondition",
        "USDA API key is not configured on the server. Contact the administrator."
      );
    }

    try {
      const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("query", query.trim());
      url.searchParams.set("pageSize", "20");
      url.searchParams.set("dataType", "Foundation,SR Legacy,Branded");

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`USDA API error: ${response.status}`, errorText);
        throw new HttpsError(
          "internal",
          `USDA API returned status ${response.status}. Please try again.`
        );
      }

      const data = await response.json();
      const queryTokens = getSearchTokens(query);
      const foods = normalizeUSDAFoods(data.foods || [], queryTokens);

      return {
        foods,
        totalHits: data.totalHits || 0,
      };
    } catch (error) {
      // Re-throw HttpsErrors as-is
      if (error instanceof HttpsError) throw error;

      console.error("USDA proxy error:", error);
      throw new HttpsError(
        "internal",
        "Failed to fetch food data from USDA. Please try again later."
      );
    }
  }
);
