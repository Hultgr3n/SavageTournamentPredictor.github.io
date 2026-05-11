# Savage Tournament Predictor 2026

A lightweight family & friends World Cup 2026 prediction game. Users predict match scores, earn points, and compete on a live leaderboard.

---

## Tech Stack (why so simple?)

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Vanilla HTML + Bootstrap 5 + plain JS | No build tools, runs anywhere |
| Database | **Firebase Firestore** | Free tier, real-time, no server needed |
| Auth | **Firebase Authentication** | Email/password (shown to users as username only) |
| Hosting | Any static host (Netlify, GitHub Pages, Vercel, Firebase Hosting) | Just upload the files |
| Live Scores API | [worldcup26.ir](https://worldcup26.ir) | Free World Cup 2026 REST API |

---

## Setup Guide

### Step 1 – Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a new project.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. In **Firestore Database**, create a database in production mode.
4. In **Project Settings → Your apps**, click **Web** (`</>`), register an app, and copy the config snippet.

### Step 2 – Paste your Firebase config

Open `js/firebase-config.js` and replace every `REPLACE_ME` with the values from your Firebase config object:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### Step 3 – Apply Firestore security rules

1. In the Firebase Console open **Firestore → Rules**.
2. Copy the contents of `firestore.rules` and paste them in, then **Publish**.

### Step 4 – Deploy / host the site

**Option A – Netlify (recommended, free)**
1. Go to [netlify.com](https://netlify.com) and sign up.
2. Drag and drop the entire `SavageTournamentPredictor` folder onto Netlify's dashboard.
3. Done! You get a free URL like `https://savage-predictor.netlify.app`.

**Option B – GitHub Pages**
1. Push this folder to a GitHub repo.
2. Go to **Settings → Pages**, set source to your branch/folder.

**Option C – Firebase Hosting**
```bash
npm install -g firebase-tools
firebase login
firebase init hosting  # point public directory to this folder
firebase deploy
```

### Step 5 – Create the first admin account

1. Open your site URL and register with a username of your choice.
2. In the Firebase Console, go to **Firestore → users**, find your document (the UID), and set `isAdmin: true`.
3. Refresh the site — the **Admin** link appears in the navbar.

### Step 6 – Load match data

1. Go to the **Admin** page.
2. In the **Live Score API** section, register (or log in) with an email on [worldcup26.ir](https://worldcup26.ir) to get a 84-day JWT token.
3. The token is saved in Firestore automatically.
4. Click **Initialize All Matches from API** — this loads all 104 fixtures into your database.
5. Your participants can now make predictions!

### Step 7 – Sync scores during the tournament

Whenever you want to update scores, go to Admin → **Sync Live Scores from API**. This updates all finished match scores, and points recalculate automatically when anyone loads the leaderboard.

---

## Scoring System

| Correct prediction | Points |
|---|---|
| Correct home goals | +1 |
| Correct away goals | +1 |
| Correct outcome (win / draw / loss) | +1 |
| **Max per match** | **3** |

**Example:** Real score 2–1, your prediction 2–0  
→ Home goals correct (+1), away goals wrong (0), correct winner (+1) = **2 pts**

**Tiebreaker on the leaderboard:** most exact scores (where all 3 pts were earned on the same match).

---

## File Structure

```
SavageTournamentPredictor/
├── index.html          ← Login / Register
├── predictions.html    ← All match predictions
├── leaderboard.html    ← Points ranking
├── admin.html          ← Admin panel
├── firestore.rules     ← Copy into Firebase Console
├── css/
│   └── style.css
└── js/
    ├── firebase-config.js   ← ⚠️ Fill in your config here
    ├── app.js               ← Shared utilities
    ├── predictions.js
    ├── leaderboard.js
    └── admin.js
```

---

## Firestore Collections Overview

| Collection | Contents |
|---|---|
| `users/{uid}` | username, isAdmin |
| `usernames/{username}` | uid (for uniqueness check) |
| `matches/{matchId}` | teams, date, group, actual scores, finished flag |
| `predictions/{uid}/matches/{matchId}` | home, away predictions per user |
| `config/settings` | locked, lockDate, apiToken, lastSync |

---

## FAQ

**Q: Can people see each other's predictions?**  
A: Yes — everyone's predictions are readable once logged in. This is intentional for a friendly competition.

**Q: What happens when predictions are locked?**  
A: The save button is disabled and all score inputs are greyed out. Existing predictions are preserved.

**Q: The API token expires after 84 days — what do I do?**  
A: Log in again on the Admin page to get a fresh token and click Save Token.

**Q: How do I manually fix a score?**  
A: Use **Admin → Manual Score Entry** with the match ID (shown in the URL or Firestore).
