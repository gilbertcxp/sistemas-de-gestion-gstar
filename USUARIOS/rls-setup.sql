-- ============================================================
-- Política RLS para la tabla "usuarios"
-- Ejecutar UNA SOLA VEZ en Supabase → SQL Editor
-- Necesario para que el módulo Usuarios pueda listar y asignar roles.
-- ============================================================

alter table usuarios enable row level security;

-- Cualquier usuario autenticado puede LEER la lista completa de usuarios
-- (necesario para mostrar la tabla en el módulo Usuarios).
drop policy if exists "usuarios_select_authenticated" on usuarios;
create policy "usuarios_select_authenticated"
on usuarios for select
to authenticated
using (true);

-- Solo un usuario cuyo propio rol contenga "administrador" puede
-- insertar (vincular) nuevos usuarios.
drop policy if exists "usuarios_insert_admin" on usuarios;
create policy "usuarios_insert_admin"
on usuarios for insert
to authenticated
with check (
  exists (
    select 1 from usuarios u
    where u.id = auth.uid()
    and u.rol ilike '%administrador%'
  )
);

-- Solo un usuario cuyo propio rol contenga "administrador" puede
-- actualizar el rol de otros usuarios.
drop policy if exists "usuarios_update_admin" on usuarios;
create policy "usuarios_update_admin"
on usuarios for update
to authenticated
using (
  exists (
    select 1 from usuarios u
    where u.id = auth.uid()
    and u.rol ilike '%administrador%'
  )
)
with check (
  exists (
    select 1 from usuarios u
    where u.id = auth.uid()
    and u.rol ilike '%administrador%'
  )
);
