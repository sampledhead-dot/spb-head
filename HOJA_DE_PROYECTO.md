# Hoja de proyecto — Sample Pack Builder (web)

## Qué es
App 100 % en el navegador: cargas una canción, la analiza (tempo, tonalidad), separa stems y genera un pack de samples (breaks, loops de bajo/instrumentos, golpes de batería, notas de bajo, acordes). Todo mono, normalizado a -1 dBFS, nombres con tempo, ZIP por carpetas, con lista previa para escuchar y excluir.

## Arquitectura
Tres archivos en el repo (GitHub Pages): `index.html`, `app.js`, `worker.js`. `spb-standalone.html` es una copia de un solo archivo para probar en local/móvil.
- worker.js: DSP puro (FFT, onsets, tempo, tonalidad, loops, golpes, HPSS, escaneo de batería sola).
- app.js: interfaz, decodificación, Demucs (onnxruntime-web, opcional), previsualización, ZIP.

## Reglas permanentes (aplican a TODAS las apps)
1. Cada actualización se entrega **numerada y en un zip** (`nombre-vN.zip`, carpeta `nombre-vN`, versión visible en el pie de página).
2. **Informe de error automático**: ante cualquier error la app genera y descarga un `.txt` con todo lo necesario para diagnosticarlo, y deja un botón "Descargar informe (.txt)". Debe incluir: versión de la app, fecha, dónde ocurrió, etapa/progreso, mensaje y stack del error (también del worker), navegador/UA, plataforma, núcleos, RAM, pantalla, URL/protocolo, contexto seguro, COOP/COEP, WebGPU, estado de audio, memoria JS, almacenamiento, opciones elegidas, nombre/tamaño/tipo del archivo (nunca el contenido), resultado parcial, cronología de pasos y últimas ~300 líneas de consola. Captura `window.onerror` y `unhandledrejection`.
3. Estructura de tres archivos + versión standalone para pruebas locales.

## Historial
- **v14** (19-11-2026): conexión con todas las apps de Sampled Head (sh-core): botón «⇄ Apps» con «Recibido» y «Enviar a…»; en Windows/Mac usa la carpeta Documentos/SampledHead. Recibe una canción o un stem. Modelos en la caché común `sh-models-v1` (reaprovecha `spb-models-v1`); en escritorio, carpeta compartida.
- **v13** (19-11-2026) — zona segura: la cabecera (y, donde las hay, las ventanas a pantalla completa y la barra inferior) deja libre la franja de la hora, la batería y la cámara del móvil con `env(safe-area-inset-*)`. Comprobado en Chrome simulando un móvil con 48 px arriba y 24 px abajo: ningún botón tapado. En ordenador no cambia nada. También en `spb-standalone.html`.
- v1–v2: versión Python, luego port a navegador; avisos al abrir en local.
- v3: script clásico + fallback sin Worker. v4: standalone de un archivo.
- v5: reducción de memoria (Demucs por trozos, límites, defaults móvil).
- v6: (retirado en v7) escaneo previo de batería sola en la mezcla original (breaks sin stems, sin pérdida; categoría `Solo_Original`), modo "Solo batería sola del original", informe de error .txt automático.
- v7: se quita la detección de batería sola. Rejilla de tempo **variable** (sigue el pulso real; antes era rígida y en canciones con tempo no fijo se desplazaba hasta segundos). Estructura por secciones y frases: los loops no cruzan cambios de sección, empiezan a inicio de frase y se descartan los que son un loop más corto repetido. Cortes al inicio real del ataque y final justo antes del ataque siguiente. Cada loop lleva su tempo local en el nombre. Golpes sueltos recortados antes del siguiente golpe y sacados de su pieza; filtro de ruidos que no son caja. Batería separada por piezas (bombo/caja/hats/toms, por DSP) y `01_Drum_Breaks/Parts`. Modo Demucs 6 stems (guitarra y piano) → `03_Instrument_Loops/Guitar` y `/Keys`.
- v8: se quitan los breaks por piezas. Golpes sueltos sin hats colados: se eligen los bombos/cajas/toms con menos agudos ajenos y se filtra el hat tras el ataque (bombo >2,5 kHz, tom >4,5 kHz, caja >9 kHz).
- v9: caja/tom se distinguen por el ruido de bordonera tras el ataque, comparando los golpes de la propia canción (antes salían intercambiados).
- v10: seguimiento de pulsos nuevo (curva de tempo local + programación dinámica); en prueba con tempo variable ±3 % y posiciones conocidas: 0 de 24 loops mal colocados (v9: 9 de 24), error máx. 6 ms. "By SampledHead" en cabecera y en pack_info.txt (con versión, fecha, canción y separador). Un color por sección.
- v11: logo nuevo (en la cabecera, como icono de pestaña y en `logo.svg`).
- v12: instalable como app (PWA): `manifest.json`, `icon-192.png`, `icon-512.png`, `sw.js`. Estos 4 archivos van al repo junto a los tres principales.

## Límites conocidos
- En móvil la separación con IA no es viable (memoria); solo separación rápida.
- El modo de 6 stems (modelo StemSplitio/htdemucs-6s-onnx) solo se probó con un motor simulado; si falla cae a 4 stems y genera informe. Separa piano, no cualquier teclado.
- La separación de piezas de batería es por DSP (máscaras por bandas), no un modelo de IA: hay algo de sangrado entre piezas.
- El motor nuevo se probó con la canción real del usuario usando stems DSP, no Demucs (no disponible en desarrollo).
- Demucs en navegador no se pudo probar en el entorno de desarrollo (sin acceso a CDN); si falla, cae a DSP básico y genera informe.
- Compás 4/4.

## Bloque estándar para pegar en la hoja de proyecto de otras apps
> **Estándares de entrega:** (1) Cada versión se entrega numerada y en un zip (`app-vN.zip`), con la versión en el pie. (2) Ante cualquier error la app genera y descarga automáticamente un `.txt` de diagnóstico (versión, fecha, etapa, mensaje+stack, navegador/UA, plataforma, RAM/CPU, URL/protocolo, opciones elegidas, metadatos del archivo sin contenido, cronología de pasos, últimas líneas de consola; captura errores globales y promesas rechazadas) y ofrece un botón "Descargar informe (.txt)". Incluir en la siguiente versión generada.
