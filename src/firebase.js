import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const firebaseConfig = {
    apiKey: "AIzaSyBOyN9Sohv_2SEiHVb9OEpS9alVaTHwB4c",
    authDomain: "calorie-tracker-9a1d2.firebaseapp.com",
    projectId: "calorie-tracker-9a1d2",
    storageBucket: "calorie-tracker-9a1d2.firebasestorage.app",
    messagingSenderId: "466150517882",
    appId: "1:466150517882:web:7f9068cb59b7e9f99e5fc3",
    measurementId: "G-N7SHG7GZ7Y"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Initialize your functions
const functions = getFunctions(app);

// Point to the emulator if we are in a local development environment
const usingEmulator = window.location.hostname === "localhost";
if (usingEmulator) {
    connectFunctionsEmulator(functions, "localhost", 5001);
    console.log("Connected to Firebase Functions Emulator on port 5001");
}

console.log("🚀 CURRENT SEARCH URL TARGET:", usingEmulator ? "http://localhost:5001" : "PRODUCTION LIVE API");

export { app, auth, db, googleProvider, functions };
