// ============================================================
//  STEP 1: Replace the values below with YOUR Firebase project
//  config (from Firebase Console → Project Settings → Your apps)
// ============================================================
const firebaseConfig = {
  apiKey:            "AIzaSyBW6NbuBGZhev4Qqw07tjYmiJAaJIIsRs4",
  authDomain:        "savage-tournament-predictor.firebaseapp.com",
  projectId:         "savage-tournament-predictor",
  storageBucket:     "savage-tournament-predictor.firebasestorage.app",
  messagingSenderId: "302384354029",
  appId:             "1:302384354029:web:e1639a5de21cbd797af2e4"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Shorthand globals
const auth = firebase.auth();
const db   = firebase.firestore();

