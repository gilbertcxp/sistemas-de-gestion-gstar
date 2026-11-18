# Integración ORKAPI (Facturación)

Automatiza la integración semanal de los cuatro reportes de ORKAPI (LOTO 5, PRIMERITA, QUINIELÓN y QUINIELÓN FLASH):
carga, validación, comisiones, consolidado general, consolidado con saldo a favor, control semanal y Excel de seis hojas.

Flujo de cada semana: **seleccionar semana → subir los cuatro reportes → validar → procesar → revisar el consolidado → aprobar → descargar el Excel.**

## Cómo está construido

| Pieza | Archivo |
|---|---|
| Dinero en centavos enteros, redondeo explícito | `assets/js/dinero.js` |
| Motor de comisiones y consolidados (+ verificación independiente con BigInt) | `assets/js/calculo.js` |
| Lectura de reportes ORKAPI (HTML con extensión .xls, Excel, CSV; mapeo de columnas) | `assets/js/parser.js` |
| Validación por archivo y del conjunto; vinculación por **código** de ORKAPI | `assets/js/validacion.js` |
| Catálogo de consorcios | `assets/js/catalogo.js` |
| Semana: estados, recálculo, diferencias, conciliación previa a aprobar | `assets/js/semana.js` |
| Libro auxiliar de saldos a favor (solo crece; se corrige con reversiones) | `assets/js/libro.js` |
| Lectura/conciliación contra el Excel de integración original | `assets/js/referencia.js` |
| Excel de seis hojas | `assets/js/exportador.js` |
| Persistencia y sincronización | `assets/js/storage.js`, `assets/js/sync.js` |
| Pantallas | `app.js`, `cargar.js`, `reportes.js`, `consolidados.js`, `control.js`, `dashboard.js`, `config.js` |

### Datos (tabla `app_state` de Supabase; no requiere SQL)
`ork_config` · `ork_catalogo` · `ork_semanas` (índice) · `ork_sem_AAAA-Sxx` (detalle de una semana: archivos originales, filas, resultados) · `ork_creditos` (libro) · `ork_auditoria`.
Las semanas se bajan **bajo demanda** (no todas al abrir). Cada acción vuelve a traer lo último de Supabase, guarda y **confirma** que llegó; si falla, revierte.

### Reglas de cálculo (hojas del Excel)
`comisión ventas = ventas × %` · `comisión premios = premios × %` · `subtotal = ventas − com. ventas − premios − com. premios` ·
`total a facturar = subtotal + ajuste de semana anterior`. Tasas: LOTO 5 8 %/2 %, PRIMERITA 5 %/2 %, QUINIELÓN 8 %/2 %, QUINIELÓN FLASH 5 %/2 %.
Cada semana **guarda la tasa con la que se calculó**: cambiar un porcentaje no altera semanas ya procesadas.
Redondeo: centavos, mitad hacia afuera de cero, línea por línea; los totales suman líneas ya redondeadas. Con importes en pesos enteros (los de ORKAPI) el resultado es exacto.

### Permisos
- Cualquier usuario con acceso al módulo: consultar, cargar, validar, procesar, enviar a revisión y exportar.
- Administrador + PIN: aprobar, cerrar, reabrir; tasas, catálogo y reglas; libro de créditos (aplicar, registrar, revertir); ajustes.

## Pendientes de validación (documentados, no asumidos)
1. **Tipo UD / no UD.** En el Excel la columna TIPO está vacía para varios consorcios (incluidos algunos que llevan “UD” en el nombre) y marca como UD a dos que no lo llevan. El módulo importa el tipo tal cual, lo deja **sin validar** y trata “sin clasificar” como no UD en los subtotales hasta que el responsable lo confirme (Configuración → Catálogo).
2. **“TOTAL UD” del Excel.** Se calcula con `SUBTOTAL(9, rango de filas)`; depende del rango elegido y de los filtros activos en la hoja, y los rangos difieren entre las hojas TOTAL y TOTAL CON SALDO. El módulo calcula UD por **tipo de consorcio**; la diferencia se explica por lo anterior.
3. **Celdas auxiliares de TOTAL CON SALDO A FAVOR** (filas de `SUBTOTAL` anidados y `SUM(K10:K77)`): suman subtotales sobre subtotales, por lo que no se incorporaron como reglas.
4. **Hoja SALDOS A FAVORES** (columnas EXCEL y SISTEMA): su relación con la columna H de TOTAL CON SALDO no está clara; no se usa.
5. **Segundo consolidado.** El Excel suma el *Subtotal* (H) en TOTAL CON SALDO y el *Total a facturar* (J) en TOTAL. El módulo usa *Total a facturar* en ambos; es idéntico mientras la semana anterior sea cero.
6. **Origen de los saldos a favor.** El Excel no dice en qué semana se generó cada crédito. Al importarlos se registran como *saldo inicial* con la referencia “origen por documentar”.
7. **Crédito desde resultados negativos:** desactivado por defecto; existe un modo “propuesta” que solo lista los negativos. Nada se convierte en crédito sin decisión de un responsable.
8. **Reportes semanales de LOTO 5, PRIMERITA y QUINIELÓN FLASH.** Los textos de “Grupos de Juegos” (`LOTOS (LOTO5 Y LOTO 5+)`, `PRIMERITAS`, `EL QUINIELON`, `QUINIELON FLASH`) se tomaron de reportes reales de ORKAPI; el reporte global `NO TRADICIONALES` se rechaza como producto. Conviene probar la primera semana real de cada uno.
9. **Cálculos en el backend / archivos en almacenamiento privado.** Hoy el cálculo corre en el navegador con una verificación independiente (BigInt) y los originales se guardan dentro de la semana en `app_state`. La propuesta de tablas, RLS, funciones transaccionales y bucket privado está en `sql/propuesta_integracion_orkapi.sql` (no ejecutada).
10. En la exportación se corrigió el rótulo del Excel original “TRANDICIONALES” → “TRADICIONALES”.
