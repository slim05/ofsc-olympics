# OFSC Olympics — Command Center

A static web app for running the Inaugural OFSC Olympics: schedule, live standings,
event sign-ups, single-elimination brackets, cornhole (win-by-2) scoring, guest award
voting, a big-screen TV display, and a closing-ceremony awards reveal.

Stack: **Supabase** (database + realtime + host auth) · **GitHub** · **Vercel** (static hosting).
No build step, no server, no secret keys in the browser.

---

## How it works

- **Guests** open the site on their phones. With no login they can view the schedule and
  live standings, watch the brackets, **sign up** (Cornhole, KanJam, Spikeball, Bocce as
  pairs; Tetherball solo), and **vote** for awards. Row Level Security lets them read
  everything and insert only votes and sign-ups.
- **You (host)** tap **Host** and sign in with a Supabase Auth account. That unlocks
  Scoring, the Cornhole scoreboard, bracket generation, awards, announcements, TV mode,
  and admin settings. Your login is the only thing that can write scores.
- **Scoring model:** points always attach to individuals. A team's total is the sum of its
  members' points, and the Family Gold/Silver/Bronze medals read straight off that. Team
  events award every member; solo/precision events award the individual competitor;
  bracket wins award both players.

## One-time setup

1. **Database.** In Supabase → SQL Editor, run `supabase-schema.sql`, then `rls-authenticated.sql`,
   then `rpc-guest-actions.sql`. (Schema first, then host grants, then guest actions.)
2. **Host login.** Supabase Dashboard → **Authentication → Users → Add user**. Enter an
   email + password for yourself (and one for Mallory if you like) and check
   **Auto Confirm User**. That's the login you'll use on the Host screen.
3. **Config.** `config.js` already holds your project URL and publishable key. If you ever
   rotate keys, update it there.

## Deploy (GitHub → Vercel)

1. Create a new GitHub repo and upload these files (or `git init`, commit, push).
2. In Vercel → **Add New → Project → Import** your repo.
3. Framework preset: **Other** (it's a static site — no build command, output is the repo root).
4. Deploy. You'll get a URL like `https://ofsc-olympics.vercel.app`.
5. Open the app → **Host** → sign in → **Admin**, and paste that URL into **Public app URL**
   so the TV's QR codes point guests to the live site.

## Day-of

- Laptop on the TV: open the site → Host → **TV** → **Launch TV Display** → press F11.
- Phone in hand: Host → **Scoring** / **Cornhole** / **Brackets** to run events.
- Generate each bracket once its sign-ups are in (Brackets tab → Generate, or Manual seed).
- Open awards voting after dinner (Voting → Open all), then close it and run the ceremony
  (Awards → Launch Awards Ceremony).

## Files

- `index.html` — shell, loads Supabase + fonts + app
- `config.js` — public Supabase URL + publishable key
- `styles.css` — all styling
- `app.js` — the whole application
- `supabase-schema.sql` — tables, security, realtime, seed data (15 teams, events, awards)
- `rls-authenticated.sql` — grants your host login write access
- `rpc-guest-actions.sql` — secure functions: guests report winners, edit their team
- `logo.png` — the OFSC logo used in the header and big displays
