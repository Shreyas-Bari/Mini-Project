# NutriTrack

## A. Project Overview & Description
NutriTrack is a highly optimized, production-grade Calorie Tracker designed with a modern, dark-themed user interface. 
Its core purpose is to deliver immense user value by destroying choice paralysis. It achieves this by mathematically cleansing food search data payloads and filtering out database noise on the fly, presenting users with only the most accurate and relevant nutritional information.

## B. Tech Stack & Infrastructure (100% Free Tier Optimized)
- **Frontend**: React, Vite, Tailwind CSS / UI Framework.
- **Backend & Database**: Cloud Firestore (NoSQL Document-Store) utilizing strict document-level user schemas.
- **Hosting**: Firebase Hosting (Spark Tier optimized).
- **Data Engines**: Parallel browser client-side integration tracking USDA FoodData Central (Foundation & SR Legacy datasets) and Open Food Facts API streams.
- **CI/CD**: Automated GitHub Actions pipeline.

## C. System Architecture & Core Workflows
### Data Cleansing Pipeline
The frontend intercepts search payloads to perform token-matching keyword relevance checks. It isolates zero-macro anomalies (excluding liquid vectors like water/diet sodas) and conducts mathematical energy verification using the foundational validation matrix:
`Calculated Calories = (Protein * 4) + (Carbs * 4) + (Fat * 9)`
This calculation is enforced within a strict 12% deviation threshold bounds limit to ensure data integrity.

### Role-Based Protection
The application implements strict route-guard logic. It checks the user's Firestore document configuration (specifically the 'role' field). Only users with the explicit 'admin' role are granted exclusive access to the system metrics summary and food management console. Non-admin users are automatically redirected away from protected routes.

### Automated Deployment Loop
The project utilizes a simple Git CI/CD flow:
1. **Local development sandbox verification**: Run locally via `npm run dev` to verify changes.
2. **Push to branch main**: Execute `git push origin main` to initiate the deployment process.
3. **Automated GitHub Actions**: The runner intercepts the trigger, installs dependencies, executes production building (`npm run build`), and authenticates via an encrypted repository secret to push assets directly to live production hosting without manual intervention.

## D. Project Architecture & Credits Attribution
This project was built and coded using Antigravity as the primary AI development engine. The entire strategic conceptualization, structural planning, system architectural constraints, continuous data pipeline debugging, and error-handling fixes were driven entirely by human engineering insight and supervision.