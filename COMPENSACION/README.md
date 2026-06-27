# Facturas de Compensación — Gstar Services S.A.

Aplicación web para generar automáticamente las facturas de compensación
(PROFORMA) a partir del archivo consolidado de ventas/premios, replicando
exactamente la plantilla oficial de la empresa.

## Cómo usar la aplicación

1. Descomprime esta carpeta donde prefieras (escritorio, una memoria USB,
   una carpeta compartida de la oficina, etc.).
2. Abre el archivo **`index.html`** con doble clic. Se abrirá en tu
   navegador (Chrome, Edge o Firefox recomendados).
3. ¡Listo! No requiere instalación, servidor ni conexión a internet para
   funcionar — todas las librerías necesarias (lectura de Excel, generación
   de PDF) están incluidas dentro de la carpeta `assets/vendor`.

> **Tip:** también puedes subir esta carpeta a un servicio de hosting
> estático (por ejemplo una intranet, Google Drive con extensión, Netlify,
> etc.) si varias personas en la oficina necesitan acceder a ella desde
> distintos computadores. Ten en cuenta que cada navegador guarda sus
> propios datos por separado (ver siguiente sección).

## ¿Dónde se guardan los datos?

La aplicación guarda todo (clientes, facturas, numeración, configuración)
en el **almacenamiento local del navegador** (`localStorage`) — no se
envía nada a internet ni a ningún servidor. Esto significa:

- Los datos quedan disponibles automáticamente la próxima vez que abras
  `index.html` **en el mismo navegador y el mismo computador**.
- Si abres la app en otro computador o en otro navegador, empezará con la
  base de 50 clientes original y sin facturas (cada navegador tiene su
  propio almacenamiento independiente).
- Borrar el historial/caché del navegador puede borrar estos datos.

**Por eso es muy importante usar el respaldo regularmente** (ver abajo).

## Respaldo y restauración de datos

En **Configuración → Datos del sistema**:

- **Descargar respaldo (JSON):** genera un archivo con todos tus clientes,
  facturas y configuración. Guárdalo en un lugar seguro (Drive, USB, etc.)
  periódicamente, especialmente antes de cerrar el mes.
- **Restaurar respaldo:** carga un archivo de respaldo previamente
  descargado (por ejemplo, si cambias de computador o si necesitas
  recuperar información).
- **Borrar todos los datos:** reinicia la aplicación a su estado original
  (los 50 clientes precargados, sin facturas). Esta acción no se puede
  deshacer — usa el respaldo antes si tienes dudas.

## Novedades de esta versión

**1. Descarga en lote (ZIP / PDF combinado)**
En la vista **Facturas**, el botón **"Descargar todas en ZIP"** genera un
archivo `.zip` con un PDF independiente por cada factura (nombrado
`FC-000001_Cliente.pdf`). Si no seleccionas ninguna factura con los
checkboxes, descarga **todas** las que coinciden con los filtros activos;
si seleccionas algunas, descarga solo esas. Justo después de generar
facturas desde un archivo cargado, las recién creadas quedan
preseleccionadas automáticamente para que el botón funcione con un solo
clic. También existe **"PDF combinado"**, que arma un único PDF con todas
las facturas seleccionadas, una por página.

**2. Factura estándar simplificada**
Las facturas individuales ya no muestran la línea de "Cargo
Administrativo": el cliente solo ve el concepto de la compensación y el
monto final total. El 2% sigue calculándose y guardándose internamente
(visible en el historial y los reportes), solo se ocultó de la factura
impresa.

**3. Factura consolidada del Grupo UD**
Los consorcios que aparecen en el listado oficial de clientes UD ya **no**
generan factura individual. En su lugar, todos los consorcios UD de una
misma carga se consolidan en **una sola factura** con dos secciones:
*Cuentas por Cobrar (CXC)* — consorcios con balance negativo — y *Cuentas
por Pagar (CXP)* — consorcios con balance positivo. El resultado neto
(Total CXC − Total CXP) determina si la factura indica "A PAGAR" o
"A COBRAR". En la vista **Cargar Excel** aparece una tarjeta "Factura
consolidada — Grupo UD" con el resumen y un checkbox para incluirla o no
en esa generación. Si necesitas actualizar la lista de consorcios UD,
edita `assets/js/ud_seed.js`.

**4. Corrección del PDF al abrir con doble clic (`file://`)**
Se eliminó por completo la causa de que "Imprimir/Descargar PDF" fallara
en silencio al abrir la app con doble clic: el logo, el sello y la marca
de agua ahora viven embebidos directamente en el código (`assets/js/assets.js`)
en vez de cargarse como archivos de imagen aparte, evitando el error de
"canvas tainted" que algunos navegadores generan con imágenes locales.
Además, cualquier error real durante una exportación ahora se muestra
como aviso en pantalla en vez de fallar sin explicación.

## Flujo de trabajo recomendado

1. **Cargar Excel** → sube el archivo de "Compensación Consolidado"
   (`.xls`/`.xlsx`) de la semana correspondiente.
2. La aplicación detecta automáticamente el periodo (DESDE/HASTA), calcula
   el 2% de compensación, y muestra qué consorcios tienen balance negativo
   (los que se deben facturar).
3. Los nombres se vinculan automáticamente con la base de clientes cuando
   es posible. Si algún consorcio no se reconoce, usa **"Vincular
   cliente"** para asociarlo a un cliente existente o crear uno nuevo al
   vuelo.
4. Revisa/ajusta el periodo y el vendedor si hace falta, y pulsa
   **"Generar facturas seleccionadas"**.
5. En **Facturas** puedes ver, filtrar, cambiar el estado (Pendiente /
   Pagada / Anulada), imprimir o descargar cada factura en PDF, o exportar
   varias a la vez en un solo PDF.
6. En **Reportes** puedes exportar el consolidado general en Excel o PDF.

## Datos de la empresa (fijos en la plantilla)

- **Razón social:** Gstar Services S.A. — RNC 131751016
- **Dirección:** Av. Winston Churchill No. 1099, Citi Tower, Acrópolis
  Center, Piso 16-AB
- **Teléfono:** (809) 262-1001
- **Cuenta:** 9605078497 del Banco de Reservas

Estos datos están integrados en la plantilla de factura y no requieren
edición. Lo que sí es editable desde **Configuración** es el porcentaje de
compensación (2% por defecto), los días de vencimiento, el vendedor y la
firma de "Entregado por".

## Notas sobre los datos de clientes

La base de 50 consorcios viene precargada con **Nombre y Teléfono**
únicamente (los únicos datos disponibles en el archivo origen). Los campos
RNC, Dirección, Correo y Contacto principal quedan en blanco y son
completamente editables desde **Clientes → ✏️ Editar** en cualquier
momento.

## Estructura del proyecto

```
index.html                  → aplicación (ábrelo en el navegador)
assets/css/                 → estilos
assets/img/                 → logo, sello y marca de agua oficiales
assets/js/                  → lógica de la aplicación
assets/vendor/               → librerías de terceros empaquetadas
                               (lectura de Excel y generación de PDF)
```

## Soporte de archivos de entrada

La aplicación reconoce automáticamente dos formatos:

- El archivo real de "Compensación Consolidado" (técnicamente es HTML
  aunque tenga extensión `.xls`) — el mismo que ya usa el sistema.
- Archivos `.xlsx`/`.xls` binarios genéricos, siempre que tengan una
  columna de Consorcio/Cliente y una columna de Balance/Monto.
