-- ============================================================================
-- INTEGRACIÓN ORKAPI — PROPUESTA de esquema relacional en Supabase  (NO ejecutada)
--
-- Hoy el módulo guarda todo en la tabla genérica app_state (claves ork_*), igual que
-- Activo Fijo y Compensación, y NO necesita este script.
-- Esta es la propuesta para migrar a tablas con integridad referencial, RLS y cálculo en
-- el servidor cuando se decida. Revisar con el responsable antes de ejecutar en Supabase.
--
-- Tablas estrictamente necesarias (las existentes `usuarios` y `app_state` se reutilizan):
--   ork_consorcios, ork_productos, ork_tasas, ork_semanas, ork_archivos, ork_filas,
--   ork_resultados, ork_ajustes, ork_creditos_mov, ork_aplicaciones, ork_auditoria
-- Importes en centavos (bigint); tasas en puntos base (800 = 8 %).
-- ============================================================================

create table if not exists ork_consorcios (
  id            integer primary key,                       -- ID interno estable
  codigo        text unique,                               -- código externo de ORKAPI
  nombre        text not null,
  alias         text[] not null default '{}',
  tipo          text not null default '' check (tipo in ('', 'UD', 'NO_UD')),
  tipo_validado boolean not null default false,
  estado        text not null default 'activo' check (estado in ('activo', 'inactivo')),
  creado_en     timestamptz not null default now(),
  creado_por    uuid references usuarios(id)
);

create table if not exists ork_productos (
  id        text primary key,                              -- LOTO5 | PRIMERITA | QUINIELON | QUINIELON_FLASH
  nombre    text not null,
  patrones  text[] not null default '{}'                   -- textos de "Grupos de Juegos" que lo identifican
);

create table if not exists ork_tasas (                     -- historial de tasas; la vigente es la última con vigente_desde <= hoy
  id             bigint generated always as identity primary key,
  producto_id    text not null references ork_productos(id),
  ventas_bp      integer not null check (ventas_bp between 0 and 10000),
  premios_bp     integer not null check (premios_bp between 0 and 10000),
  vigente_desde  date not null,
  motivo         text not null,
  creado_por     uuid references usuarios(id),
  creado_en      timestamptz not null default now()
);

create table if not exists ork_semanas (
  id            text primary key,                          -- '2026-S46'
  anio          integer not null,
  semana        integer not null check (semana between 1 and 53),
  desde         date not null,
  hasta         date not null check (hasta >= desde),
  estado        text not null check (estado in ('borrador','archivos_pendientes','en_validacion','procesado','en_revision','aprobado','cerrado','reabierto')),
  version       integer not null default 0,
  aprobado_por  uuid references usuarios(id),
  cerrado_por   uuid references usuarios(id),
  creado_en     timestamptz not null default now(),
  unique (anio, semana)                                    -- no pueden existir dos integraciones/cierres de la misma semana
);

create table if not exists ork_archivos (
  id          bigint generated always as identity primary key,
  semana_id   text not null references ork_semanas(id),
  producto_id text not null references ork_productos(id),
  nombre      text not null,
  tipo        text not null,                               -- html | xls-binario | xlsx | csv
  sha256      text not null,
  storage_ruta text not null,                              -- ruta en el bucket privado 'ork-originales'
  encabezado  jsonb not null,
  cargado_por uuid references usuarios(id),
  cargado_en  timestamptz not null default now(),
  vigente     boolean not null default true,
  unique (semana_id, sha256)                               -- el mismo archivo no se carga dos veces en una semana
);
create unique index if not exists ork_archivos_vigente on ork_archivos (semana_id, producto_id) where vigente;

create table if not exists ork_filas (                    -- filas importadas, con trazabilidad al archivo de origen
  id            bigint generated always as identity primary key,
  archivo_id    bigint not null references ork_archivos(id) on delete cascade,
  linea         integer not null,
  item          text,
  codigo        text,
  nombre_orkapi text not null,
  consorcio_id  integer references ork_consorcios(id),
  ventas_c      bigint not null,
  premios_c     bigint not null,
  balance_c     bigint,
  unique (archivo_id, linea)
);

create table if not exists ork_resultados (               -- una fila por semana × producto × consorcio, con la TASA APLICADA
  semana_id     text not null references ork_semanas(id),
  producto_id   text not null references ork_productos(id),
  consorcio_id  integer not null references ork_consorcios(id),
  version       integer not null,
  ventas_bp     integer not null,
  premios_bp    integer not null,
  ventas_c      bigint not null,
  com_ventas_c  bigint not null,
  premios_c     bigint not null,
  com_premios_c bigint not null,
  subtotal_c    bigint not null,
  ajuste_c      bigint not null default 0,
  total_c       bigint not null,
  primary key (semana_id, producto_id, consorcio_id, version),
  check (subtotal_c = ventas_c - com_ventas_c - premios_c - com_premios_c),
  check (total_c = subtotal_c + ajuste_c)
);

create table if not exists ork_ajustes (                  -- ajustes de semana anterior / adicionales
  id           bigint generated always as identity primary key,
  semana_id    text not null references ork_semanas(id),
  producto_id  text references ork_productos(id),         -- null = ajuste adicional del consolidado
  consorcio_id integer not null references ork_consorcios(id),
  monto_c      bigint not null check (monto_c <> 0),
  motivo       text not null,
  creado_por   uuid references usuarios(id),
  creado_en    timestamptz not null default now()
);

-- Libro auxiliar de créditos: SOLO inserciones (ver trigger). Corregir = insertar una reversión.
create table if not exists ork_creditos_mov (
  id               uuid primary key default gen_random_uuid(),
  consorcio_id     integer not null references ork_consorcios(id),
  tipo             text not null check (tipo in ('saldo_inicial','credito_generado','credito_utilizado','ajuste_administrativo','reversion')),
  signo            smallint not null check (signo in (-1, 1)),
  monto_c          bigint not null check (monto_c > 0),
  fecha            date not null,
  semana_origen    text references ork_semanas(id),
  semana_aplicacion text references ork_semanas(id),
  referencia       text,
  observaciones    text,
  estado           text not null default 'pendiente' check (estado in ('pendiente','confirmado','anulado')),
  revierte_id      uuid references ork_creditos_mov(id),
  creado_por       uuid references usuarios(id),
  creado_en        timestamptz not null default now(),
  aprobado_por     uuid references usuarios(id),
  aprobado_en      timestamptz,
  check ((tipo = 'credito_generado'  and semana_origen is not null) or tipo <> 'credito_generado'),
  check ((tipo = 'credito_utilizado' and semana_aplicacion is not null) or tipo <> 'credito_utilizado'),
  check ((tipo in ('ajuste_administrativo','reversion') and observaciones is not null) or tipo not in ('ajuste_administrativo','reversion'))
);
-- no duplicar créditos de una semana ni aplicar dos veces en la misma semana (mientras no estén revertidos)
create unique index if not exists ork_cred_gen_unico on ork_creditos_mov (consorcio_id, semana_origen)
  where tipo = 'credito_generado' and estado <> 'anulado';
create unique index if not exists ork_cred_uso_unico on ork_creditos_mov (consorcio_id, semana_aplicacion)
  where tipo = 'credito_utilizado' and estado <> 'anulado';
-- una reversión por movimiento
create unique index if not exists ork_cred_rev_unica on ork_creditos_mov (revierte_id) where revierte_id is not null;

create or replace function ork_creditos_solo_insertar() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'El libro de créditos no permite borrar movimientos'; end if;
  -- solo se permite confirmar/anular un movimiento pendiente; nada más cambia
  if old.estado = 'pendiente' and new.estado in ('confirmado','anulado')
     and (new.consorcio_id, new.tipo, new.signo, new.monto_c, new.fecha) is not distinct from (old.consorcio_id, old.tipo, old.signo, old.monto_c, old.fecha) then
    return new;
  end if;
  raise exception 'Los movimientos del libro de créditos no se editan: registra una reversión';
end $$;
drop trigger if exists ork_creditos_inmutable on ork_creditos_mov;
create trigger ork_creditos_inmutable before update or delete on ork_creditos_mov for each row execute function ork_creditos_solo_insertar();

create or replace view ork_creditos_saldo as
  select consorcio_id, sum(signo * monto_c) as disponible_c
  from ork_creditos_mov where estado in ('pendiente','confirmado') group by consorcio_id;

create table if not exists ork_aplicaciones (             -- crédito aplicado a una semana (referencia a su movimiento)
  semana_id    text not null references ork_semanas(id),
  consorcio_id integer not null references ork_consorcios(id),
  movimiento_id uuid not null references ork_creditos_mov(id),
  monto_c      bigint not null check (monto_c > 0),
  primary key (semana_id, consorcio_id)
);

create table if not exists ork_auditoria (
  id          bigint generated always as identity primary key,
  usuario_id  uuid references usuarios(id),
  accion      text not null,
  entidad     text,
  entidad_id  text,
  semana_id   text,
  detalle     jsonb,
  creado_en   timestamptz not null default now()
);

-- Aplicar un crédito de forma transaccional (el servidor verifica el disponible bajo bloqueo)
create or replace function ork_aplicar_credito(p_semana text, p_consorcio integer, p_monto bigint, p_ref text)
returns uuid language plpgsql security definer as $$
declare v_disp bigint; v_id uuid;
begin
  perform 1 from usuarios u where u.id = auth.uid() and u.rol ilike '%administrador%';
  if not found then raise exception 'Solo un administrador puede aplicar créditos'; end if;
  perform pg_advisory_xact_lock(hashtext('ork_cred_' || p_consorcio));
  select coalesce(sum(signo * monto_c), 0) into v_disp from ork_creditos_mov where consorcio_id = p_consorcio and estado in ('pendiente','confirmado');
  if p_monto > v_disp then raise exception 'El crédito a usar (%) supera el disponible (%)', p_monto, v_disp; end if;
  insert into ork_creditos_mov (consorcio_id, tipo, signo, monto_c, fecha, semana_aplicacion, referencia, estado, creado_por)
    values (p_consorcio, 'credito_utilizado', -1, p_monto, current_date, p_semana, p_ref, 'pendiente', auth.uid()) returning id into v_id;
  insert into ork_aplicaciones (semana_id, consorcio_id, movimiento_id, monto_c) values (p_semana, p_consorcio, v_id, p_monto);
  return v_id;
end $$;

-- ---------------------------------------------------------------- RLS
-- Lectura: cualquier usuario autenticado con acceso al módulo. Escritura: administrador (mismo criterio que `usuarios`).
do $$
declare t text;
begin
  foreach t in array array['ork_consorcios','ork_productos','ork_tasas','ork_semanas','ork_archivos','ork_filas','ork_resultados','ork_ajustes','ork_creditos_mov','ork_aplicaciones','ork_auditoria']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_sel', t);
    execute format($p$create policy %I on %I for select to authenticated using (
      exists (select 1 from usuarios u where u.id = auth.uid()
              and (u.modulos_permitidos is null or u.modulos_permitidos = '' or u.modulos_permitidos ilike '%%integracion-orkapi%%')))$p$, t || '_sel', t);
    execute format('drop policy if exists %I on %I', t || '_mod', t);
    execute format($p$create policy %I on %I for all to authenticated using (
      exists (select 1 from usuarios u where u.id = auth.uid() and u.rol ilike '%%administrador%%'))
      with check (exists (select 1 from usuarios u where u.id = auth.uid() and u.rol ilike '%%administrador%%'))$p$, t || '_mod', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- Almacenamiento privado de los originales
-- insert into storage.buckets (id, name, public) values ('ork-originales', 'ork-originales', false) on conflict do nothing;
-- create policy "ork_originales_sel" on storage.objects for select to authenticated using (bucket_id = 'ork-originales');
-- create policy "ork_originales_ins" on storage.objects for insert to authenticated with check (bucket_id = 'ork-originales');
