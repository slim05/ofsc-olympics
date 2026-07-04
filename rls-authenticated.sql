-- ============================================================================
--  OFSC OLYMPICS — Host write access (run AFTER supabase-schema.sql)
--  This lets your signed-in host account (Supabase Auth) write everything,
--  while the public stays read-only + votes/signups. No secret key needed.
--  Run once in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================================

-- Give the authenticated role table privileges (RLS still gates rows below)
grant insert, update, delete on all tables in schema public to authenticated;

-- Allow a signed-in host to insert / update / delete on every table
do $$
declare t text;
begin
  foreach t in array array['settings','teams','guests','events','schedule_blocks',
                           'scores','awards','votes','announcements',
                           'bracket_signups','matches']
  loop
    execute format('drop policy if exists "host insert %1$s" on %1$s;', t);
    execute format('create policy "host insert %1$s" on %1$s for insert to authenticated with check (true);', t);

    execute format('drop policy if exists "host update %1$s" on %1$s;', t);
    execute format('create policy "host update %1$s" on %1$s for update to authenticated using (true) with check (true);', t);

    execute format('drop policy if exists "host delete %1$s" on %1$s;', t);
    execute format('create policy "host delete %1$s" on %1$s for delete to authenticated using (true);', t);
  end loop;
end $$;

-- Done. Your host login can now run the event; guests remain read-only.
