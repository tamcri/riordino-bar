insert into public.inventory_excel_presets (name, slug)
values ('Caffetteria', 'caffetteria')
on conflict (slug) do update
set name = excluded.name,
    is_active = true,
    updated_at = now();

delete from public.inventory_excel_preset_items
where preset_id = (
  select id
  from public.inventory_excel_presets
  where slug = 'caffetteria'
);

insert into public.inventory_excel_preset_items (preset_id, item_id)
select
  p.id,
  i.id
from public.inventory_excel_presets p
join public.items i
  on i.code in ('CAFFDEKGR','CAFFGRANI','GIN1','ORZ1')
where p.slug = 'caffetteria'
  and i.is_active = true
on conflict (preset_id, item_id) do nothing;
