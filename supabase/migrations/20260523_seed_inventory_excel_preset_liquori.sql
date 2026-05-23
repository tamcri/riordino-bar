insert into public.inventory_excel_presets (name, slug)
values ('Liquori', 'liquori')
on conflict (slug) do update
set name = excluded.name,
    is_active = true,
    updated_at = now();

delete from public.inventory_excel_preset_items
where preset_id = (
  select id
  from public.inventory_excel_presets
  where slug = 'liquori'
);

with codes(code) as (
values
  ('05998'),
  ('AVE'),
  ('BAI'),
  ('BAIL'),
  ('BORG'),
  ('BORSCI'),
  ('BRANCA'),
  ('BRANDYST'),
  ('BRAULIO'),
  ('COINT'),
  ('COURV'),
  ('DISA'),
  ('FERNET'),
  ('GAMONDI'),
  ('GENZIANA'),
  ('GRAPSC'),
  ('HAVC'),
  ('JAGER'),
  ('JEFFERSORN CL 70'),
  ('KAHLUA'),
  ('LIQA'),
  ('LIQC'),
  ('LIQG'),
  ('LIQLE'),
  ('LIQLI'),
  ('LIQS'),
  ('LUCANO'),
  ('MONTEN'),
  ('NIKKA WHISKY'),
  ('NOC'),
  ('PETRUS'),
  ('RAMAZ'),
  ('RATAFIA CL70'),
  ('RUMZA'),
  ('SAMB'),
  ('SAMBUC'),
  ('SILIMONC'),
  ('STG'),
  ('UNICUM'),
  ('VECCHIA'),
  ('VECCHIO'),
  ('VERDAM'),
  ('XENTA'),
  ('XO ZACAPA RUM'),
  ('ZEDP')
)
insert into public.inventory_excel_preset_items (preset_id, item_id)
select
  p.id,
  i.id
from public.inventory_excel_presets p
join codes c on true
join public.items i
  on upper(trim(i.code)) = upper(trim(c.code))
where p.slug = 'liquori'
  and i.is_active = true
on conflict (preset_id, item_id) do nothing;
