
insert into public.inventory_excel_presets (name, slug)
values ('Bevande', 'bevande')
on conflict (slug) do update
set name = excluded.name,
    is_active = true,
    updated_at = now();

delete from public.inventory_excel_preset_items
where preset_id = (
  select id
  from public.inventory_excel_presets
  where slug = 'bevande'
);

insert into public.inventory_excel_preset_items (preset_id, item_id)
select
  p.id,
  i.id
from public.inventory_excel_presets p
join (
  values
  ('1224150'),
('12241503'),
('12241590'),
('12241591'),
('12241594'),
('12241595'),
('12241636'),
('12406796'),
('12406899'),
('12407048'),
('12407049'),
('12407231'),
('41276'),
('41467'),
('41469'),
('41517'),
('5308'),
('ACQ'),
('ACQGR'),
('APE'),
('APEROL'),
('ASTORIA'),
('B03XA'),
('BACBIAN'),
('BECKS1'),
('BECKSANALCOLICA'),
('BITT1'),
('BITT2'),
('BOSGIN'),
('BULLGIN'),
('CADF'),
('CADROS'),
('CAMP'),
('CAMP2'),
('CERES'),
('CHARDONAY DOC'),
('CHIANTI'),
('COC'),
('COCZ'),
('CORONA'),
('CRODINO'),
('CRODTWAG'),
('CRODTWISTFR'),
('DONPR'),
('EST'),
('ESTH1'),
('FANT'),
('FUZL'),
('FUZP'),
('GEWTRA'),
('GINPSM'),
('GINSP'),
('GRAND ROSE'),
('HEIN'),
('HEIN5'),
('ICH3'),
('ICHN5'),
('J&B'),
('JACKD'),
('LEMONSODA BR'),
('MALBU'),
('MART.B'),
('MART.R'),
('MATUSR'),
('MEN'),
('MERL'),
('MES'),
('MIDORI'),
('MOD1'),
('MONR'),
('MOOD'),
('MOR1'),
('MOR3'),
('MOSTE'),
('MULLTH'),
('NASTRO 33 AZZ'),
('NASTRO 62 AZZ'),
('NNASR'),
('PAMPANN'),
('PINOTVEN'),
('RED BULL'),
('RIB'),
('RUMP'),
('SEVENUPL'),
('SKY'),
('SPRIT'),
('SUC'),
('SUCCA'),
('SUCCMEL'),
('TASSONI'),
('TENNENTS'),
('TEQUILA'),
('TRIPL'),
('TUBL'),
('VODKA FR.'),
('VODKBELV'),
('VODKPES')
) as src(code)
  on true
join public.items i
  on trim(i.code) = trim(src.code)
where p.slug = 'bevande'
  and i.is_active = true
on conflict (preset_id, item_id) do nothing;
