-- =====================================================================
--  KAFE · Atualização do painel administrativo
--  Cole TUDO no Supabase > SQL Editor > Run (pode rodar mais de uma vez)
-- =====================================================================

-- 1) EXCLUIR PRODUTO: o pedido antigo continua guardado (nome, tamanho e
--    preço ficam gravados no próprio item), mas o produto pode ser apagado.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and confrelid = 'public.products'::regclass
      and contype = 'f'
  loop
    execute format('alter table public.order_items drop constraint %I', c);
  end loop;
end $$;

alter table public.order_items
  add constraint order_items_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;

-- 2) Campos novos no pedido: código de rastreio e observação interna
alter table public.orders add column if not exists tracking text;
alter table public.orders add column if not exists notes text;

-- 3) EXCLUIR PEDIDO (antes não existia permissão para isso)
create or replace function public.admin_delete_order(
  p_order uuid,
  p_restock boolean default true,
  p_remove_income boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; it record;
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  select * into o from public.orders where id = p_order;
  if not found then return; end if;

  -- devolve as peças ao estoque (só se o pedido ainda não estava cancelado)
  if p_restock and o.status <> 'cancelado' then
    for it in select * from public.order_items where order_id = p_order and product_id is not null loop
      update public.variants set stock = stock + it.qty
      where product_id = it.product_id and size = it.size;
    end loop;
  end if;

  if p_remove_income then
    delete from public.transactions where order_id = p_order;
  end if;

  delete from public.orders where id = p_order;   -- itens saem junto (cascade)
end $$;
grant execute on function public.admin_delete_order(uuid, boolean, boolean) to authenticated;

-- 4) MUDANÇA DE STATUS inteligente
--    pago / enviado / entregue  => existe ENTRADA no financeiro (sem duplicar)
--    novo / cancelado           => a entrada some
--    cancelar                   => peças voltam ao estoque
--    reabrir pedido cancelado   => peças saem do estoque de novo
create or replace function public.on_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare it record; n int;
begin
  if new.status is not distinct from old.status then return new; end if;

  if new.status in ('pago','enviado','entregue') then
    if not exists (select 1 from public.transactions where order_id = new.id and type = 'entrada') then
      insert into public.transactions(type, category, description, amount, order_id)
      values ('entrada', 'Vendas',
              'Pedido ' || left(new.id::text, 6) || ' - ' || coalesce(new.customer_name, ''),
              new.total, new.id);
    end if;
  else
    delete from public.transactions where order_id = new.id and type = 'entrada';
  end if;

  if new.status = 'cancelado' and old.status <> 'cancelado' then
    for it in select * from public.order_items where order_id = new.id and product_id is not null loop
      update public.variants set stock = stock + it.qty
      where product_id = it.product_id and size = it.size;
    end loop;
  elsif old.status = 'cancelado' and new.status <> 'cancelado' then
    for it in select * from public.order_items where order_id = new.id and product_id is not null loop
      update public.variants set stock = stock - it.qty
      where product_id = it.product_id and size = it.size and stock >= it.qty;
      get diagnostics n = row_count;
      if n = 0 then
        raise exception 'Sem estoque para reabrir: % tam. %', it.name, it.size;
      end if;
    end loop;
  end if;
  return new;
end $$;

-- 5) ENTRADA DE MERCADORIA: soma no estoque e lança a SAÍDA no financeiro
create or replace function public.admin_stock_in(
  p_product uuid,
  p_items jsonb,
  p_total numeric,
  p_supplier text,
  p_date date,
  p_unit_cost numeric default null
) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; q int := 0; pname text;
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  select name into pname from public.products where id = p_product;
  if pname is null then raise exception 'Produto não encontrado'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce((it->>'qty')::int, 0) > 0 then
      insert into public.variants(product_id, size, stock)
      values (p_product, it->>'size', (it->>'qty')::int)
      on conflict (product_id, size)
      do update set stock = public.variants.stock + excluded.stock;
      q := q + (it->>'qty')::int;
    end if;
  end loop;

  if q = 0 then raise exception 'Informe ao menos uma peça'; end if;
  if p_unit_cost is not null then
    update public.products set cost = p_unit_cost where id = p_product;
  end if;

  if coalesce(p_total, 0) > 0 then
    insert into public.transactions(type, category, description, amount, date)
    values ('saida', 'Mercadoria',
            'Reposição: ' || pname || ' (' || q || ' un.)' || coalesce(' · ' || nullif(p_supplier, ''), ''),
            p_total, coalesce(p_date, current_date));
  end if;
end $$;
grant execute on function public.admin_stock_in(uuid, jsonb, numeric, text, date, numeric) to authenticated;
