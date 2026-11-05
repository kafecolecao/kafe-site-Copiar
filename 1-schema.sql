-- Cole TUDO no Supabase > SQL Editor > Run
create table admins(user_id uuid primary key references auth.users on delete cascade);
create table products(id uuid primary key default gen_random_uuid(), name text not null, description text, category text default 'Sandálias', price numeric(10,2) not null, cost numeric(10,2) default 0, image_url text, active boolean default true, created_at timestamptz default now());
create table variants(id uuid primary key default gen_random_uuid(), product_id uuid references products on delete cascade, size text not null, stock int default 0, unique(product_id,size));
create table orders(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users, customer_name text, phone text, address text, total numeric(10,2), status text default 'novo', created_at timestamptz default now());
create table order_items(id uuid primary key default gen_random_uuid(), order_id uuid references orders on delete cascade, product_id uuid references products, name text, size text, qty int, price numeric(10,2));
create table transactions(id uuid primary key default gen_random_uuid(), type text check (type in ('entrada','saida')), category text, description text, amount numeric(10,2), date date default current_date, order_id uuid references orders on delete set null);

create function is_admin() returns boolean language sql security definer stable as $$ select exists(select 1 from admins where user_id=auth.uid()) $$;

alter table admins enable row level security; alter table products enable row level security; alter table variants enable row level security;
alter table orders enable row level security; alter table order_items enable row level security; alter table transactions enable row level security;

create policy "adm" on admins for select using (user_id=auth.uid());
create policy "p_read" on products for select using (active or is_admin());
create policy "p_adm" on products for all using (is_admin()) with check (is_admin());
create policy "v_read" on variants for select using (true);
create policy "v_adm" on variants for all using (is_admin()) with check (is_admin());
create policy "o_read" on orders for select using (user_id=auth.uid() or is_admin());
create policy "o_adm" on orders for update using (is_admin());
create policy "i_read" on order_items for select using (is_admin() or exists(select 1 from orders o where o.id=order_id and o.user_id=auth.uid()));
create policy "t_adm" on transactions for all using (is_admin()) with check (is_admin());

-- Cria pedido com segurança (preço vindo do banco + baixa de estoque)
create function create_order(p_name text,p_phone text,p_address text,p_items jsonb) returns uuid
language plpgsql security definer as $$
declare oid uuid; it jsonb; pr products; tot numeric:=0; n int;
begin
  insert into orders(user_id,customer_name,phone,address,total) values(auth.uid(),p_name,p_phone,p_address,0) returning id into oid;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from products where id=(it->>'product_id')::uuid and active;
    if not found then raise exception 'Produto indisponível'; end if;
    update variants set stock=stock-(it->>'qty')::int where product_id=pr.id and size=it->>'size' and stock>=(it->>'qty')::int;
    get diagnostics n=row_count;
    if n=0 then raise exception 'Sem estoque: % tam. %',pr.name,it->>'size'; end if;
    insert into order_items(order_id,product_id,name,size,qty,price) values(oid,pr.id,pr.name,it->>'size',(it->>'qty')::int,pr.price);
    tot:=tot+pr.price*(it->>'qty')::int;
  end loop;
  update orders set total=tot where id=oid;
  return oid;
end $$;
grant execute on function create_order to anon, authenticated;

-- Pedido marcado como "pago" vira ENTRADA no financeiro automaticamente
create function on_paid() returns trigger language plpgsql security definer as $$
begin
  if new.status='pago' and old.status<>'pago' then
    insert into transactions(type,category,description,amount,order_id) values('entrada','Vendas','Pedido '||left(new.id::text,6)||' - '||new.customer_name,new.total,new.id);
  end if; return new;
end $$;
create trigger t_paid after update on orders for each row execute function on_paid();

-- Fotos dos produtos
insert into storage.buckets(id,name,public) values('produtos','produtos',true);
create policy "img_read" on storage.objects for select using (bucket_id='produtos');
create policy "img_adm" on storage.objects for all using (bucket_id='produtos' and is_admin()) with check (bucket_id='produtos' and is_admin());
-- Rode no Supabase > SQL Editor (pode rodar mesmo se já rodou o schema antes)
alter table orders add column if not exists proof_url text;
insert into storage.buckets(id,name,public) values('comprovantes','comprovantes',true) on conflict do nothing;
drop policy if exists "comp_ins" on storage.objects;
create policy "comp_ins" on storage.objects for insert with check (bucket_id='comprovantes');
create or replace function attach_proof(p_order uuid, p_url text) returns void language sql security definer as $$
  update orders set proof_url=p_url where id=p_order and proof_url is null; $$;
grant execute on function attach_proof to anon, authenticated;
