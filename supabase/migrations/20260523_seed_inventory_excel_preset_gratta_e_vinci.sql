-- Preset Excel: Gratta e Vinci

insert into public.inventory_excel_presets (name, slug)
values ('Gratta e Vinci', 'gratta_e_vinci')
on conflict (slug) do update
set
  name = excluded.name,
  is_active = true,
  updated_at = now();

delete from public.inventory_excel_preset_items
where preset_id = (
  select id
  from public.inventory_excel_presets
  where slug = 'gratta_e_vinci'
);

insert into public.inventory_excel_preset_items (preset_id, item_id)
select
  p.id,
  i.id
from public.inventory_excel_presets p
join public.items i
  on i.code in (
  ('3040'),
  ('3042'),
  ('3050'),
  ('3058'),
  ('3063'),
  ('3072'),
  ('3073'),
  ('3077'),
  ('3079'),
  ('3080'),
  ('3081'),
  ('3082'),
  ('3086'),
  ('3088'),
  ('3093'),
  ('3094'),
  ('3097'),
  ('3098'),
  ('3099'),
  ('3100'),
  ('3101'),
  ('3105'),
  ('3106'),
  ('3107'),
  ('3108'),
  ('3109'),
  ('3111'),
  ('3114'),
  ('3315'),
  ('3316'),
  ('3318'),
  ('3319'),
  ('3320'),
  ('3321'),
  ('3322'),
  ('3323'),
  ('3325')
  )
where p.slug = 'gratta_e_vinci'
  and i.is_active = true
on conflict (preset_id, item_id) do nothing;
