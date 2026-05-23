
insert into public.inventory_excel_presets (name, slug)
values ('Pasticceria', 'pasticceria')
on conflict (slug) do update
set name = excluded.name,
    is_active = true,
    updated_at = now();

delete from public.inventory_excel_preset_items
where preset_id = (
  select id
  from public.inventory_excel_presets
  where slug = 'pasticceria'
);

with preset as (
  select id
  from public.inventory_excel_presets
  where slug = 'pasticceria'
),
codes(code) as (
values
  ('BIN1809'),
  ('BISC6'),
  ('CIAMB'),
  ('CORN'),
  ('CORNM'),
  ('CROSNOGLUT'),
  ('CROSTCIAMB'),
  ('DOLC'),
  ('DON'),
  ('FETTTORT3'),
  ('MUFF'),
  ('MUFFINNOGL'),
  ('PASTM'),
  ('SFOG'),
  ('TORT')
)
insert into public.inventory_excel_preset_items (preset_id, item_id)
select
  p.id,
  i.id
from preset p
join codes c on true
join public.items i
  on upper(trim(i.code)) = upper(trim(c.code))
where i.is_active = true
on conflict (preset_id, item_id) do nothing;
