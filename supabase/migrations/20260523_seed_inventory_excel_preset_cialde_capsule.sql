insert into public.inventory_excel_presets (name, slug)
values ('Cialde Capsule', 'cialde_capsule')
on conflict (slug) do update
set name = excluded.name,
    is_active = true,
    updated_at = now();

delete from public.inventory_excel_preset_items
where preset_id = (
  select id
  from public.inventory_excel_presets
  where slug = 'cialde_capsule'
);

with codes(code) as (
values
  ('BARATTOLO MACINATO'),
  ('CIALDTOP100'),
  ('CIALDTOP50'),
  ('CIALDTOPDEK50'),
  ('CONFEZIONE MOKA'),
  ('DCAPP'),
  ('DCIOK'),
  ('DCLAS'),
  ('DNOC'),
  ('DOLCDEC'),
  ('DOLCEG'),
  ('DOLGG'),
  ('DORZO'),
  ('DTHEL'),
  ('LAVAZ100'),
  ('LAVAZ50'),
  ('LAVAZDEK50'),
  ('NESPR100'),
  ('NESPR50'),
  ('NESPRDEK50')
)
insert into public.inventory_excel_preset_items (preset_id, item_id)
select
  p.id,
  i.id
from public.inventory_excel_presets p
join codes c on true
join public.items i
  on upper(trim(i.code)) = upper(trim(c.code))
where p.slug = 'cialde_capsule'
  and i.is_active = true
on conflict (preset_id, item_id) do nothing;
