-- ============================================================================
--  OFSC OLYMPICS — Supabase schema, security, realtime, and seed data
--  Run this ONCE in: Supabase Dashboard → SQL Editor → New query → Run
--  Safe to re-run: uses "if not exists" and guarded seed inserts.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. SETTINGS  (single row, id = 1)
-- ----------------------------------------------------------------------------
create table if not exists settings (
  id              int primary key default 1 check (id = 1),
  event_name      text  not null default 'OFSC OLYMPICS',
  hosts           text  not null default 'Brad & Mallory',
  date_label      text  not null default 'Saturday, August 8',
  location        text  not null default '6611 Ulry Rd, Westerville, OH',
  public_url      text  not null default '',
  points          jsonb not null default '{"first":10,"second":7,"third":5,"participation":1}',
  -- bracket rewards are awarded to the INDIVIDUAL players, so they roll up into
  -- each player's family total (a champion pair can be from two different families).
  bracket_points  jsonb not null default '{"champion":15,"runnerup":10,"win":3}',
  voting_open     boolean not null default false,
  results_hidden  boolean not null default true,
  current_event_id uuid,
  next_event_id    uuid,
  tv              jsonb not null default '{"screens":["now","next","standings","bracket","results","schedule","voteqr","medals","announce"],"rotateSec":14,"manual":false,"manualScreen":"now"}',
  updated_at      timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. TEAMS  (family teams — drive overall standings)
-- ----------------------------------------------------------------------------
create table if not exists teams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  family        text default '',
  color         text default '#F5821F',
  captain_id    uuid,
  song          text default '',
  flag_desc     text default '',
  flag_img      text default '',
  points_adjust int default 0,
  medal_g       int default 0,
  medal_s       int default 0,
  medal_b       int default 0,
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. GUESTS
-- ----------------------------------------------------------------------------
create table if not exists guests (
  id            uuid primary key default gen_random_uuid(),
  first_name    text default '',
  last_name     text default '',
  display_name  text not null,
  family        text default '',
  kind          text not null default 'adult' check (kind in ('adult','kid')),
  age_group     text default '',
  team_id       uuid references teams(id) on delete set null,
  volunteer_role text default '',
  food_paid     boolean default false,
  notes         text default '',
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. EVENTS
-- ----------------------------------------------------------------------------
create table if not exists events (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  category        text default 'Open',
  scoring_type    text default 'placement'
                  check (scoring_type in ('placement','head2head','best','timed','manual')),
  location        text default 'Backyard Arena',
  eligibility     text default 'All',
  max_participants int,
  status          text default 'not_started'
                  check (status in ('not_started','now_playing','delayed','complete','canceled')),
  is_bracket      boolean default false,   -- true for the signup/bracket events
  requires_signup boolean default false,   -- guests must sign up to enter
  bracket_size    int not null default 2 check (bracket_size in (1,2)), -- 1 = singles (Tetherball), 2 = pairs
  sort            int default 0,
  notes           text default '',
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 5. SCHEDULE BLOCKS
-- ----------------------------------------------------------------------------
create table if not exists schedule_blocks (
  id          uuid primary key default gen_random_uuid(),
  time_label  text not null,
  title       text not null,
  note        text default '',
  event_ids   uuid[] default '{}',
  status      text default 'not_started'
              check (status in ('not_started','now_playing','delayed','complete','canceled')),
  sort        int default 0
);

-- ----------------------------------------------------------------------------
-- 6. SCORES  (per-INDIVIDUAL points; family totals = sum of member points)
--    Every score should carry a guest_id. In team events, award each
--    participant a row (placement if they placed, else participation). The
--    team_standings view below sums each family's member points automatically.
--    (A team_id-only row with no guest_id is allowed for rare manual team
--    bonuses, but the default path is always individual.)
-- ----------------------------------------------------------------------------
create table if not exists scores (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid references events(id) on delete cascade,
  team_id    uuid references teams(id) on delete cascade,
  guest_id   uuid references guests(id) on delete cascade,
  place      int,
  points     int default 0,
  note       text default '',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 7. AWARDS
-- ----------------------------------------------------------------------------
create table if not exists awards (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text default '',
  award_type   text default 'vote'   check (award_type in ('vote','points','manual')),
  subject      text default 'individual' check (subject in ('team','individual','kid')),
  is_open      boolean default false,
  hidden       boolean default true,
  winner_type  text check (winner_type in ('team','guest')),
  winner_id    uuid,
  locked       boolean default false,
  sort         int default 0
);

-- ----------------------------------------------------------------------------
-- 8. VOTES  (one vote per guest per award — enforced by unique index)
-- ----------------------------------------------------------------------------
create table if not exists votes (
  id           uuid primary key default gen_random_uuid(),
  award_id     uuid references awards(id) on delete cascade,
  voter_id     uuid references guests(id) on delete cascade,
  nominee_type text check (nominee_type in ('team','guest')),
  nominee_id   uuid not null,
  comment      text default '',
  created_at   timestamptz not null default now(),
  unique (award_id, voter_id)
);

-- ----------------------------------------------------------------------------
-- 9. ANNOUNCEMENTS
-- ----------------------------------------------------------------------------
create table if not exists announcements (
  id         uuid primary key default gen_random_uuid(),
  body       text not null,
  active     boolean default true,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 10. BRACKET SIGNUPS  (an entrant in a bracket event)
--     Pairs events (Cornhole, KanJam, Spikeball, Bocce): player1 + player2.
--     Singles events (Tetherball, bracket_size = 1): player1 only, player2 null.
-- ----------------------------------------------------------------------------
create table if not exists bracket_signups (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid references events(id) on delete cascade,
  player1_id uuid references guests(id) on delete set null,
  player2_id uuid references guests(id) on delete set null,  -- null for singles
  pair_name  text default '',            -- optional entrant name, e.g. "The Bag Slayers"
  created_at timestamptz not null default now()
);
-- helper index for fast per-event lookups:
create index if not exists idx_bracket_signups_event on bracket_signups(event_id);

-- ----------------------------------------------------------------------------
-- 11. MATCHES  (single-elimination bracket; nulls allow byes)
-- ----------------------------------------------------------------------------
create table if not exists matches (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid references events(id) on delete cascade,
  round            int not null,             -- 1 = first round
  slot             int not null,             -- position within the round (0-based)
  a_signup_id      uuid references bracket_signups(id) on delete set null,
  b_signup_id      uuid references bracket_signups(id) on delete set null,
  a_score          int,
  b_score          int,
  winner_signup_id uuid references bracket_signups(id) on delete set null,
  next_match_id    uuid references matches(id) on delete set null,
  next_side        text check (next_side in ('a','b')),  -- which slot the winner feeds
  status           text default 'pending'
                   check (status in ('pending','ready','live','complete','bye')),
  created_at       timestamptz not null default now()
);
create index if not exists idx_matches_event on matches(event_id);

-- ============================================================================
--  SECURITY (Row Level Security)
--  Model: the browser uses the ANON key and may READ everything, plus INSERT
--  votes and bracket signups. All host/admin writes (scores, match results,
--  opening voting, editing teams, etc.) run server-side in Next.js with the
--  SERVICE_ROLE key, which bypasses RLS. So the public can never tamper with
--  scores or standings.
-- ============================================================================
alter table settings         enable row level security;
alter table teams            enable row level security;
alter table guests           enable row level security;
alter table events           enable row level security;
alter table schedule_blocks  enable row level security;
alter table scores           enable row level security;
alter table awards           enable row level security;
alter table votes            enable row level security;
alter table announcements    enable row level security;
alter table bracket_signups  enable row level security;
alter table matches          enable row level security;

-- Public read on everything (drop-then-create so re-runs don't error)
do $$
declare t text;
begin
  foreach t in array array['settings','teams','guests','events','schedule_blocks',
                           'scores','awards','votes','announcements','bracket_signups','matches']
  loop
    execute format('drop policy if exists "public read %1$s" on %1$s;', t);
    execute format('create policy "public read %1$s" on %1$s for select using (true);', t);
  end loop;
end $$;

-- Public may cast votes
drop policy if exists "public insert votes" on votes;
create policy "public insert votes" on votes for insert with check (true);

-- Public may sign up pairs for bracket events
drop policy if exists "public insert signups" on bracket_signups;
create policy "public insert signups" on bracket_signups for insert with check (true);

-- ============================================================================
--  GRANTS  (PostgREST needs table-level privileges in addition to RLS policies)
-- ============================================================================
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert on votes, bracket_signups to anon, authenticated;

-- ============================================================================
--  VIEW: team_standings
--  THE RULE: a family's total = the SUM of its members' individual points.
--  Every point a guest earns — solo events, team events (placement or
--  participation), and brackets — rolls up here. Family Gold / Silver / Bronze
--  is simply the top 3 families by total_points. Medal counts tally each
--  member's 1st / 2nd / 3rd-place finishes.
-- ============================================================================
create or replace view team_standings with (security_invoker = on) as
select
  t.id                                                     as team_id,
  t.name,
  t.family,
  t.color,
  coalesce(sum(s.points), 0) + t.points_adjust            as total_points,
  count(*) filter (where s.place = 1) + t.medal_g          as gold,
  count(*) filter (where s.place = 2) + t.medal_s          as silver,
  count(*) filter (where s.place = 3) + t.medal_b          as bronze
from teams t
left join guests g on g.team_id = t.id
left join scores s on s.guest_id = g.id
group by t.id, t.name, t.family, t.color, t.points_adjust, t.medal_g, t.medal_s, t.medal_b;

grant select on team_standings to anon, authenticated;

-- ============================================================================
--  REALTIME  (so the TV and standings update live without refresh)
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['settings','teams','scores','awards','votes',
                           'announcements','bracket_signups','matches','events','schedule_blocks']
  loop
    begin execute format('alter publication supabase_realtime add table %I;', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- ============================================================================
--  SEED DATA  (events, schedule, awards, family teams, a few demo guests)
--  Guarded so re-running the script won't create duplicates.
-- ============================================================================

-- Events -- the 5 bracket events are flagged is_bracket + requires_signup
insert into events (name, category, scoring_type, is_bracket, requires_signup, bracket_size, sort)
select v.name, v.category, v.scoring_type, v.is_bracket, v.is_bracket, v.bracket_size, v.sort
from (values
  -- name                              category  scoring     bracket size sort
  ('Cornhole',                         'Open','head2head', true,  2, 1),   -- pairs
  ('Tetherball',                       'Open','head2head', true,  1, 2),   -- SINGLES
  ('KanJam',                           'Open','head2head', true,  2, 3),   -- pairs
  ('Spikeball',                        'Open','head2head', true,  2, 4),   -- pairs
  ('Bocce Ball',                       'Open','head2head', true,  2, 5),   -- pairs
  ('Sponge Dodgeball',                 'Team','head2head', false, 2, 6),
  ('Dizzy Bat Race',                   'Open','timed',     false, 2, 7),
  ('Kickball',                         'Team','head2head', false, 2, 8),
  ('Longest Cornhole Shot',            'Open','best',      false, 2, 9),
  ('Fastest Tetherball Wrap',          'Open','timed',     false, 2, 10),
  ('Frisbee Accuracy Challenge',       'Open','best',      false, 2, 11),
  ('Soccer Crossbar Challenge',        'Open','best',      false, 2, 12),
  ('Football Toss Target Challenge',   'Open','best',      false, 2, 13),
  ('Tennis Ball Bocce Closest to Pin', 'Open','best',      false, 2, 14),
  ('Tug of War',                       'Team','head2head', false, 2, 15),
  ('Glow Volleyball',                  'Open','placement', false, 2, 16)
) as v(name,category,scoring_type,is_bracket,bracket_size,sort)
where not exists (select 1 from events e where e.name = v.name);

-- Schedule blocks (event_ids left empty; host wires them or app links by name)
insert into schedule_blocks (time_label, title, note, sort)
select v.time_label, v.title, v.note, v.sort
from (values
  ('10:00 AM','Opening Ceremony','Parade • Flags • Torch • Anthem', 1),
  ('10:30 AM','Morning Qualifying','Tetherball, Cornhole, KanJam, Spikeball, Bocce', 2),
  ('12:30 PM','Lunch, Open Play & Music','', 3),
  ('1:30 PM','Championship Finals','Bracket finals across the 5 events', 4),
  ('2:30 PM','Team Water Event','Sponge Dodgeball', 5),
  ('3:30 PM','Relay Challenge','Dizzy Bat Race', 6),
  ('4:00 PM','Main Team Event','Kickball', 7),
  ('5:30 PM','Precision Skills','Six best-attempt challenges', 8),
  ('6:30 PM','Dinner','Giant Eagle catering', 9),
  ('8:00 PM','Tug of War Championship','', 10),
  ('8:30 PM','Closing Ceremony & Awards','', 11),
  ('9:30 PM','Bonfire, Movie & Glow Volleyball','', 12)
) as v(time_label,title,note,sort)
where not exists (select 1 from schedule_blocks s where s.title = v.title);

-- Awards
insert into awards (name, description, award_type, subject, sort)
select v.name, v.description, v.award_type, v.subject, v.sort
from (values
  ('Best Family Team Name','Peak creativity and questionable confidence.','vote','team',1),
  ('Best Family Flag','A banner worth pledging allegiance to.','vote','team',2),
  ('MVP Kid','The pint-sized champion of the yard.','vote','kid',3),
  ('Toughest Competitor','Courage, chaos, and no self-preservation.','vote','individual',4),
  ('Biggest Upset','Nobody saw it coming. Least of all them.','vote','individual',5),
  ('Best Celebration','Olympic-level theatrics for a backyard win.','vote','individual',6),
  ('Most Dramatic Athlete','The committee accepts no responsibility.','vote','individual',7),
  ('Lifetime Achievement Award','Decades of questionable decisions.','vote','individual',8),
  ('Family Gold Medal','Top team by total points.','points','team',9),
  ('Family Silver Medal','Second place, first loser — with honor.','points','team',10),
  ('Family Bronze Medal','Bronze is gold with more character.','points','team',11)
) as v(name,description,award_type,subject,sort)
where not exists (select 1 from awards a where a.name = v.name);

-- Family teams (15 placeholder names — fully editable in the app later)
insert into teams (name, family, color, song)
select v.name, v.family, v.color, v.song
from (values
  ('Team Griffin',        'Griffin',        '#E43B2E',''),
  ('Team Kline',          'Kline',          '#F5821F',''),
  ('Team Baptist',        'Baptist',        '#FFC021',''),
  ('Team Thompson',       'Thompson',       '#2FB84C',''),
  ('Team KC Theiss',      'KC Theiss',      '#16C0C9',''),
  ('Team Mahoney',        'Mahoney',        '#1E9BD7',''),
  ('Team Arehart/Gilkey', 'Arehart/Gilkey', '#8B5CF6',''),
  ('Team Ross',           'Ross',           '#EC4899',''),
  ('Team Blanks',         'Blanks',         '#F97316',''),
  ('Team Heiss',          'Heiss',          '#22C55E',''),
  ('Team Brown',          'Brown',          '#06B6D4',''),
  ('Team Robbins/Dilver', 'Robbins/Dilver', '#6366F1',''),
  ('Team Cargill',        'Cargill',        '#EF4444',''),
  ('Team Brad Theiss',    'Brad Theiss',    '#A855F7',''),
  ('Team Kienitz/Darcel', 'Kienitz/Darcel', '#EAB308','')
) as v(name,family,color,song)
where not exists (select 1 from teams t where t.name = v.name);

-- A few demo guests so you can test signups/brackets/voting immediately.
-- (Delete these in the app once you enter real guests.)
insert into guests (display_name, family, kind)
select v.display_name, v.family, v.kind
from (values
  ('Aaron','Ross','adult'),   ('Amy','Brown','adult'),
  ('Ashley','Griffin','adult'), ('Chris','Cargill','adult'),
  ('Brad','Brad Theiss','adult'), ('Nate','Heiss','adult'),
  ('Max','Ross','kid'),       ('Zoe','Brown','kid'),
  ('Leo','Griffin','kid'),    ('Mia','Cargill','kid'),
  ('Finn','Brad Theiss','kid'), ('Ivy','Heiss','kid')
) as v(display_name,family,kind)
where not exists (select 1 from guests g where g.display_name = v.display_name and g.family = v.family);

-- Done. You now have a fully seeded OFSC Olympics database.
