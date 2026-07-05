-- ============================================================================
--  OFSC OLYMPICS — Guest actions (run AFTER supabase-schema.sql)
--  Lets guests (no login) safely: report a match winner, edit their team,
--  and fix a member's display name — via validated functions only.
--  Guests still CANNOT touch scores/standings directly.
--  Run once in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Report a match winner (advances the bracket, awards points)
-- Rules enforced here: match must exist and not be complete/bye; the winner
-- must be one of the two entrants. Points come from settings.bracket_points.
-- ---------------------------------------------------------------------------
create or replace function rpc_report_winner(
  p_match uuid, p_winner uuid, p_a int default null, p_b int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches%rowtype;
  ev events%rowtype;
  bp jsonb;
  loser uuid;
  su bracket_signups%rowtype;
  lsu bracket_signups%rowtype;
  nm matches%rowtype;
  pid uuid;
begin
  select * into m from matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  if m.status = 'complete' then raise exception 'Match already reported — see the hosts to correct it'; end if;
  if m.status = 'bye' then raise exception 'This match is a bye'; end if;
  if p_winner is distinct from m.a_signup_id and p_winner is distinct from m.b_signup_id then
    raise exception 'Winner must be one of the two entrants';
  end if;
  if m.a_signup_id is null or m.b_signup_id is null then
    raise exception 'Both entrants must be set';
  end if;

  select * into ev from events where id = m.event_id;
  bp := coalesce((select bracket_points from settings where id = 1),
                 '{"champion":15,"runnerup":10,"win":3}'::jsonb);
  loser := case when p_winner = m.a_signup_id then m.b_signup_id else m.a_signup_id end;

  update matches set winner_signup_id = p_winner, a_score = p_a, b_score = p_b,
    status = 'complete' where id = m.id;

  -- per-win points to each winning player
  select * into su from bracket_signups where id = p_winner;
  foreach pid in array array_remove(array[su.player1_id, su.player2_id], null) loop
    insert into scores (event_id, guest_id, points, note)
    values (m.event_id, pid, coalesce((bp->>'win')::int, 3),
            format('[m:%s] Won %s R%s', m.id, ev.name, m.round));
  end loop;

  if m.next_match_id is not null then
    -- advance winner
    if m.next_side = 'a' then
      update matches set a_signup_id = p_winner where id = m.next_match_id;
    else
      update matches set b_signup_id = p_winner where id = m.next_match_id;
    end if;
    select * into nm from matches where id = m.next_match_id;
    if nm.a_signup_id is not null and nm.b_signup_id is not null and nm.status <> 'complete' then
      update matches set status = 'ready' where id = nm.id;
    end if;
  else
    -- final: champion + runner-up
    foreach pid in array array_remove(array[su.player1_id, su.player2_id], null) loop
      insert into scores (event_id, guest_id, points, place, note)
      values (m.event_id, pid, coalesce((bp->>'champion')::int, 15), 1,
              format('[champ:%s] %s Champion', m.event_id, ev.name));
    end loop;
    select * into lsu from bracket_signups where id = loser;
    if found then
      foreach pid in array array_remove(array[lsu.player1_id, lsu.player2_id], null) loop
        insert into scores (event_id, guest_id, points, place, note)
        values (m.event_id, pid, coalesce((bp->>'runnerup')::int, 10), 2,
                format('[runner:%s] %s Runner-up', m.event_id, ev.name));
      end loop;
    end if;
    update events set status = 'complete' where id = m.event_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Team self-management: name, color, song, flag image (data URL)
-- ---------------------------------------------------------------------------
create or replace function rpc_update_team(
  p_team uuid, p_name text default null, p_color text default null,
  p_song text default null, p_flag text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_name is not null and length(trim(p_name)) = 0 then
    raise exception 'Team name cannot be empty';
  end if;
  if p_flag is not null and length(p_flag) > 1500000 then
    raise exception 'Flag image too large';
  end if;
  update teams set
    name      = coalesce(nullif(trim(p_name), ''), name),
    color     = coalesce(nullif(trim(p_color), ''), color),
    song      = coalesce(p_song, song),
    flag_desc = flag_desc,
    flag_img  = coalesce(p_flag, flag_img)
  where id = p_team;
  if not found then raise exception 'Team not found'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fix a member's display name
-- ---------------------------------------------------------------------------
create or replace function rpc_rename_guest(p_guest uuid, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Name cannot be empty';
  end if;
  update guests set display_name = trim(p_name) where id = p_guest;
  if not found then raise exception 'Guest not found'; end if;
end $$;

-- expose to the public (anon) and host (authenticated) roles
grant execute on function rpc_report_winner(uuid, uuid, int, int) to anon, authenticated;
grant execute on function rpc_update_team(uuid, text, text, text, text) to anon, authenticated;
grant execute on function rpc_rename_guest(uuid, text) to anon, authenticated;

-- Done.
