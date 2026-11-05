-- Rode no Supabase > SQL Editor (pode rodar mesmo se já rodou o schema antes)
alter table orders add column if not exists proof_url text;
insert into storage.buckets(id,name,public) values('comprovantes','comprovantes',true) on conflict do nothing;
drop policy if exists "comp_ins" on storage.objects;
create policy "comp_ins" on storage.objects for insert with check (bucket_id='comprovantes');
create or replace function attach_proof(p_order uuid, p_url text) returns void language sql security definer as $$
  update orders set proof_url=p_url where id=p_order and proof_url is null; $$;
grant execute on function attach_proof to anon, authenticated;
