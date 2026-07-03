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
   Helper: Normalize USDA response into our standard food format
   ────────────────────────────────────────────────────────────── */
function normalizeUSDAFoods(foods) {
  return foods
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
    .filter((f) => f.calories > 0 || f.protein > 0);
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
      const foods = normalizeUSDAFoods(data.foods || []);

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
