insert into public.inventory_excel_presets (name, slug)
values ('Gelati', 'gelati')
on conflict (slug) do update
set name = excluded.name,
    is_active = true,
    updated_at = now();

delete from public.inventory_excel_preset_items
where preset_id = (
  select id
  from public.inventory_excel_presets
  where slug = 'gelati'
);

with preset as (
  select id
  from public.inventory_excel_presets
  where slug = 'gelati'
),
codes(code) as (
values
  ('30200'),
  ('30818'),
  ('31610'),
  ('33505'),
  ('35720'),
  ('38393'),
  ('40080'),
  ('40281'),
  ('47887'),
  ('53854'),
  ('54153'),
  ('55553'),
  ('58564'),
  ('64369'),
  ('70896'),
  ('75292'),
  ('77019'),
  ('8001'),
  ('82098'),
  ('86511'),
  ('87645'),
  ('87647'),
  ('ALG1'),
  ('ALG3'),
  ('BISC'),
  ('CAFE'),
  ('CALIPPO'),
  ('CORNMAX'),
  ('FRIGO CHUCHES'),
  ('GELATO DONUT'),
  ('LEMON'),
  ('MAGNUM'),
  ('MAGNUM 2025'),
  ('MAGNUM C&NUTS'),
  ('MAGNUM D GOLD'),
  ('MONPG'),
  ('SOFT'),
  ('VIENNETTA')
)
insert into public.inventory_excel_preset_items (preset_id, item_id)
select
  p.id,
  i.id
from preset p
join codes c on true
join public.items i
  on trim(i.code) = trim(c.code)
where i.is_active = true
on conflict (preset_id, item_id) do nothing;
