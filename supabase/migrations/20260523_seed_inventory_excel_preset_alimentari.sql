-- Seed preset Alimentari

insert into public.inventory_excel_presets (name, slug)
values ('Alimentari', 'alimentari')
on conflict (slug) do update
set name = excluded.name,
    is_active = true,
    updated_at = now();

delete from public.inventory_excel_preset_items
where preset_id = (
  select id
  from public.inventory_excel_presets
  where slug = 'alimentari'
);

insert into public.inventory_excel_preset_items (preset_id, item_id)
select
  p.id,
  i.id
from public.inventory_excel_presets p
join public.items i
  on i.code in ('PANMAT','PIAD','PIZZL','TRAM2')
where p.slug = 'alimentari'
  and i.is_active = true
on conflict (preset_id, item_id) do nothing;
