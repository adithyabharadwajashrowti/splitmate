# SplitMate: split the bill by what you ate

**SplitMate** is an expense-sharing app for Indian friend groups. Itemized veg/non-veg splits, Zomato-style Host Mode, voice entry, debt simplification and one-tap UPI settle-up.

**Stack:** React 19 + Vite · Supabase (Postgres, Auth, Realtime, RLS) · Netlify

---

## ✨ Features

**Splitting**
- 🧾 **Itemized bills.** Each dish is split only among the people who had it, with portions (½, 1, 2…). GST, service charge and tip follow each person's food total.
- 🎂 **Birthday treat.** Cover one person's share; it's split among everyone else.
- 🙈 **Host Mode** (inspired by Zomato). Prices are hidden while guests tap what they had; the host presses and holds to reveal, and guests owe ₹0.
- ➗ Equal, exact ₹, percentage and shares splits. Always exact to the paisa.
- ✨ **Type it** or 🎙️ **say it**: “1200 dinner paid by Rahul with Asha and Dev” fills the whole form, with automatic categories.

**Settling**
- 🕸️ **Debt Untangler.** An animated graph shows N tangled debts turning into the fewest possible payments.
- 💸 **UPI deep links.** GPay / PhonePe / Paytm open with the amount pre-filled, plus WhatsApp reminders and summaries.
- 🎉 Confetti when someone settles up.

**Fun & insights**
- 🎬 **Trip Wrapped.** Spotify-Wrapped-style story slides for the trip.
- 🎡 **Who pays next?** A karma wheel where whoever owes most gets a bigger slice.
- 📊 **SplitScore.** A CIBIL-style 300–900 trust score per friend.
- 🏆 Group awards, a spending donut, per-person charts and a 🎯 trip budget bar.
- 🔍 Search, category filters and ⬇ CSV export.

**Production basics**
- 🔒 Row-level security on every table; all writes go through validated database functions with friendly errors.
- 💰 Money stored as integer paise, so there are no rounding bugs. The maths has unit tests (`npm test`).
- ⚡ Realtime: a friend's new expense appears instantly.
- 🧭 First-time user tour, a Help page (`?` button), a getting-started checklist and a one-tap **sample trip**.
- 🛟 Error boundary, a 404 page, SPA redirects, a PWA manifest and social meta tags.
- 👀 A **“Try the live demo”** button so judges and visitors can explore without signing up.

---

## 🚀 Setup (Windows / PowerShell)

### 1. Supabase project
Create a project at [supabase.com](https://supabase.com). Mumbai is the closest region.

### 2. Database
Supabase → **SQL Editor** → **New query**. Run each file in `supabase/migrations/` **in order**, one at a time:

| File | What it does |
|---|---|
| `001_init.sql` | Tables, security rules, core functions |
| `002_grants.sql` | Table permissions for logged-in users |
| `003_budget.sql` | Trip budget column |
| `004_safe_description.sql` | Expense description clean-up |
| `005_hardening.sql` | Validated functions for every write, with friendly errors |
| `006_sample_trip.sql` | One-tap sample trip for new users |

If Supabase warns about "destructive operations", that's caused by the `revoke`/`delete` lines. Click **Run query**.

### 3. Demo friends (for the sample trip + demo button)
Supabase → **Authentication → Users → Add user → Create new user**, three times, with **Auto Confirm User** ticked:
`rahul.demo@example.com`, `asha.demo@example.com`, `dev.demo@example.com`, each with the same password (e.g. `SplitMate@Demo1`).

### 4. Environment
```powershell
copy .env.example .env
notepad .env
```
```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...      # Project Settings → API Keys (publishable)
VITE_DEMO_EMAIL=rahul.demo@example.com          # optional: shows the "Try the live demo" button
VITE_DEMO_PASSWORD=SplitMate@Demo1
```
Never put the `service_role` / secret key in `.env`.

### 5. Run
```powershell
npm.cmd install
npm.cmd test          # 12 tests for the money maths
npm.cmd run dev       # http://localhost:5173
npm.cmd run build     # production build check
```

---

## 🌍 Deploy (Netlify)

1. Push to GitHub:
   ```powershell
   git init
   git add .
   git commit -m "SplitMate v1"
   git branch -M main
   git remote add origin https://github.com/adithyabharadwajashrowti/splitmate.git
   git push -u origin main
   ```
2. Netlify → **Add new site → Import from Git** → pick `splitmate`. The build settings come from `netlify.toml`.
3. **Site configuration → Environment variables:** add the 4 `VITE_…` values from your `.env`, then **Deploys → Trigger deploy**.
4. Supabase → **Authentication → URL Configuration**:
   - Site URL: `https://YOUR-SITE.netlify.app`
   - Redirect URLs: `https://YOUR-SITE.netlify.app/**` and `http://localhost:5173/**`

**Before a public launch:** turn on **Confirm email**, set up custom SMTP, and check Supabase → **Advisors** for warnings.

---

## 🎤 4-minute demo script

| Time | Show | Say |
|---|---|---|
| 0:00 | Login page → **⚡ Try the live demo** | "Splitting equally isn't fair: the veg friend pays for the chicken and beer." |
| 0:20 | Group → tap **Dinner at Fisherman's Wharf** (receipt) | "Asha had paneer, so she pays ₹391. Rahul had biryani and 2 beers, so ₹920. Even GST follows what you ate." |
| 0:50 | **Split a bill** → add dishes, tap people, 🎂 treat someone | "It's Asha's birthday, so one tap and we cover her share." |
| 1:30 | **🙈 Host Mode** → prices vanish → press & hold 🔒 | "Zomato just launched Host Mode for ordering. We brought it to bill splitting." |
| 2:00 | **Add expense** → 🎙️ "900 pizza paid by Dev with Rahul and Asha" | "Or just say it." |
| 2:30 | **Balances** → Debt Untangler animates | "6 tangled debts become 3 payments. That's our algorithm." |
| 2:55 | **Pay** → UPI → Record → 🎉 | "One tap on UPI, and confetti." |
| 3:15 | **Insights** → SplitScore, then **🎡 Who pays next?** | "A CIBIL score for friendships, and a karma wheel for the next chai." |
| 3:40 | **🎬 Trip Wrapped** | Let it play to the end. |

**Tips:** use Chrome or Edge. Click 🎙️ once beforehand to allow the mic. Skip voice if the Wi-Fi is weak.

---

## 🗂️ Project structure
```
src/lib/          money, splits, balances (+ debt graph, SplitScore), parser, categories, UPI, voice, fun
src/components/   ExpenseForm, ItemizedEditor, SettleUp, Insights, DebtGraph, SpinWheel, Wrapped, SplitScore, Welcome
src/pages/        Login, Dashboard, Group, Profile, Help, Join
supabase/         migrations (run in order) + scan-bill edge function (optional AI bill scanning)
tests/            unit tests for the money maths
```
