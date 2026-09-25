# Coordinación entre las IA que trabajan en el equipo de Antonio

Lo deja aquí la actualización de WILLY AI (conversación «WILLY AI»). **Cualquier IA que vaya a tocar WILLY AI o el avatar debe leerlo antes.**

## Quién lleva qué

| Parte | La lleva | Cómo se cambia |
|---|---|---|
| Código de WILLY AI (`src/`), salvo lo del avatar | Conversación **«WILLY AI»** | Archivos `ACTUALIZAR_WILLY_AI_0.0.43_revN.bat` (copia de seguridad y vuelta atrás automáticas) |
| Todo `C:\WILLY_AVATAR` (ComfyUI, nodos, modelos, flujos) | Conversación **«AVATAR AI»** | Directamente en el equipo |
| Pestaña del avatar («Mi yo en IA») y voces dentro de WILLY AI: `src/components/avatar-studio.tsx`, `src/components/avatar-view.tsx`, `src/lib/avatar-server.ts`, `src/lib/avatar-engines.ts`, `src/lib/comfy-server.ts`, `src/lib/comfy-install.ts`, `src/routes/api/avatar.ts`, `src/lib/piper-server.ts`, `src/lib/voices-server.ts`, `src/components/natural-voices-card.tsx`, `src/routes/api/voces.ts`, `src/lib/voces-extra.ts`, `src/components/mas-voces.tsx` | Conversación **«AVATAR AI»** | Directamente en el equipo (Autoconstrucción, `/api/self-build`) |
| Datos del dueño en `datos-privados` (ajustes, voces descargadas, flujos registrados, claves) | Nadie los sobrescribe | Solo desde la propia app o su API (`/api/avatar`, `/api/voces`) |
| Fábrica de instaladores de las réplicas para Windows: `src/lib/desktop-format.ts`, `src/lib/installer-scripts.ts`, `src/lib/installer-factory.ts`, `src/lib/app-icon.ts`, `src/lib/desktop-runtime/servidor.mjs`, `src/components/factory-section.tsx`, `src/routes/api/fabrica.ts`, `tools/nsis/` | Conversación **«AVATAR AI»** (desde la revisión 14, a petición de Antonio) | Lo que necesite cambiar «WILLY AI» ahí, se pide como en la regla 7 |
| Arranque seguro y «Recuperar WILLY AI»: `supervisor/` y `RECUPERAR_WILLY.bat` (desde la revisión 15) | Conversación **«WILLY AI»** | Solo con las actualizaciones `ACTUALIZAR_WILLY_AI_0.0.43_revN.bat` (la Autoconstrucción no los toca) |
| **Capa visual del rediseño (nuevo diseño de las maquetas)**: `src/front/**` (armazón nuevo: barra lateral, barra superior, tarjeta «Estado de WILLY», pantallas Inicio, Chats, Herramientas y el aspecto exacto de las demás), `src/styles.css`, `src/components/ui/**`, `src/hooks/use-dark-theme.ts`, `src/hooks/use-mobile.tsx`, `public/` (iconos, mascota) y, en `src/routes/app.tsx`, SOLO el enganche del armazón (ver regla 21) | Conversación **«WILLY AI FRONT»** (desde el 24/09) | Directamente en el equipo (Autoconstrucción, `/api/self-build`), como «AVATAR AI»; siempre a partir de los archivos instalados |

## Reglas

1. Desde la revisión 10, las actualizaciones de «WILLY AI» **no reemplazan** ningún archivo de la pestaña del avatar ni tocan `C:\WILLY_AVATAR` ni `datos-privados`.
2. Si una conversación necesita cambiar algo que lleva la otra, primero se lo dice al dueño para que la otra lo sepa.
3. El número de revisión (`APP_REVISION` en `src/lib/version.ts`) **solo lo cambia «WILLY AI»**: el actualizador lo usa para saber qué está instalado. Si otra IA lo cambiara, el actualizador se equivocaría de versión.
4. Voces: la voz elegida para todas las pestañas se guarda en el navegador (`willy-voz-natural`); el motor Piper y las voces descargadas están en `datos-privados/voces`. Cambiar la voz activa con `/api/voces` (acción `set-voice`) es seguro para las dos conversaciones.
5. Antes de cambiar cualquier archivo, copia de seguridad.
6. Si una actualización de «WILLY AI» va a sustituir un archivo que otra IA ha cambiado (su contenido no coincide con ninguna versión publicada), lo avisa en la ventana y deja la lista en `copias-actualizacion\<copia>\CAMBIOS-DE-OTRA-IA.txt`; la versión anterior de esos archivos queda en `src-copia` de esa misma copia, para volver a aplicar los cambios encima de la versión nueva.
7. Cuando «AVATAR AI» cambie archivos de WILLY AI, deja a Antonio un «INFORME PARA WILLY AI» (archivos, SHA-256 y una línea por cambio); si necesita cambiar un archivo que lleva «WILLY AI», pide el cambio exacto (buscar → sustituir) y «WILLY AI» lo incluye en su siguiente revisión.
8. Nunca se actualiza a la vez desde las dos conversaciones: primero termina una (y lo dice), después la otra.
9. Desde la revisión 13, todo lo que se aplica con la Autoconstrucción (`/api/self-build`, también lo que aplique «AVATAR AI») queda como **versión local numerada** («0.0.43 rev 13 · local N»), con copia verificada por huella (SHA-256), diario paso a paso y «Volver a la versión anterior» en *Autoconstrucción → Versiones*. La respuesta de `/api/self-build` conserva los mismos campos de siempre (`ok, applied, compiled, restarting, installed, folder, backup, written, total, evidence`; si falla, `ok:false, error, backup?`). Si una operación se queda a medias (apagón, cierre), se recupera sola antes de aplicar otra; si no puede, se bloquea y dice por qué (nunca se aplica nada encima). Los archivos de ese circuito (`src/lib/self-build-*.ts`, `src/components/self-build-*.tsx`, `src/routes/api/self-build.ts`) los lleva «WILLY AI».
10. **Revisión 14 (excepción a la regla 3, a petición de Antonio):** la preparó «AVATAR AI» porque Antonio pidió UNA sola actualización definitiva con todo. Lleva la revisión 13 entera (mismo actualizador, mismos pasos) y encima la fábrica de instaladores. La siguiente revisión de «WILLY AI» sale de la 14 (paso `from: "0.0.43+14"`) y es la 15. El detalle está en el informe de abajo.
11. **Corrección en la revisión 18:** las revisiones 15, 16 y 17 de «WILLY AI» llevaban, por error, una copia antigua de este archivo (sin la fila de la fábrica, la regla 10 ni el informe de la revisión 14). La 18 lo restaura tal cual lo dejó «AVATAR AI» y añade lo nuevo. Desde la 18 el actualizador conoce las huellas de este archivo: si otra IA lo cambia, lo avisa y guarda su versión (regla 6) en vez de sustituirlo en silencio. Y desde la 18 las actualizaciones de «WILLY AI» ya no vuelven a escribir `tools/nsis/` en las instalaciones que ya lo tienen (revisión 14 o posterior).
12. La pestaña «Súper IA» se llama ahora **«SUPER WILLY»** (mismo id interno `superia`). Tiene su propia IA (por defecto «Externa primero», solo IA gratuitas), aparte de la pestaña Chat, y hace la **entrevista del proyecto** antes de construir. Sus archivos son de «WILLY AI» (informe de la revisión 18, abajo).
13. **Desde la revisión 19 los proyectos se guardan en el equipo**, en `datos-privados/proyectos/<id>/` (ficha, archivos reales, versiones comprimidas y la conversación de SUPER WILLY), a través de `/api/proyectos`. Es la única fuente de verdad de Proyectos, SUPER WILLY y el Chat. Esa carpeta la escribe **solo el servidor de WILLY** (ninguna actualización la toca, como el resto de `datos-privados`); «AVATAR AI» no debe borrarla ni moverla. Los proyectos que había en el navegador pasan solos a esa carpeta (sin borrar la copia del navegador).
14. **Desde la revisión 20 el menú es otro** (rediseño, punto 39): ya no hay «Workspace» global; «Modelos» y «Agentes» están dentro del nuevo **Centro de Inteligencia** (vista `inteligencia`, pestañas `equipo`, `externas`, `modelos`, `agentes`) y «Configuración» y «Estado del sistema», en **Ajustes** (vista `ajustes`, pestañas `general`, `sistema`, `almacenamiento`, `diagnostico`, `avanzado`). Si algo pide abrir una vista antigua (`modelos`, `agentes`, `configuracion`, `estado`, `workspace`, p. ej. con `openView`), se abre su sitio nuevo (`MOVED_VIEWS` en `src/lib/section-tabs.ts`); para abrir una pestaña concreta: `requestSectionTab(vista, pestaña)`. El servidor tiene `/api/sistema` (solo para la propia WILLY; reiniciar y detener, solo desde el propio ordenador). Su «Vaciar caché» solo borra `node_modules/.vite`, `node_modules/.cache`, `.tanstack/tmp`, `app/.output-fallida` y, en la carpeta temporal de Windows, restos de WILLY de más de una hora (`willy-update-*`, `willy-ytdlp-*`, `willy-browser-*`): **nunca** `datos-privados`, `C:\WILLY_AVATAR`, los temporales de las voces o del avatar, ni nada mientras la Autoconstrucción o una actualización están trabajando. «Borrar copias antiguas» respeta las copias protegidas de la Autoconstrucción (activa, última buena y estables).
15. **Desde la revisión 21 el Chat y SUPER WILLY se reparten el trabajo** (rediseño, fases 1, 5 y 11). El **Chat** es solo conversación: no tiene taller, vista previa ni archivos de proyecto y no guarda nada en proyectos; si alguien le pide construir o cambiar un proyecto, ofrece «Abrir en SUPER WILLY» (`sendToSuperWilly` en `src/lib/super-willy-handoff.ts`, que pasa solo la petición, sus adjuntos y sus enlaces). **Todos** los proyectos se abren en SUPER WILLY (`requestOpenProject` en `src/lib/super-willy-projects.ts`), que con un proyecto abierto tiene su chat y su **taller** (`src/components/project-workshop.tsx`: vista previa, código, archivos, cambios, versiones y, en las réplicas, replicación). «Nuevo proyecto» crea el proyecto y lo construye en SUPER WILLY. Lo que devuelve la IA se guarda con `saveAnswerFiles`, que desde ahora comprueba cada archivo (`src/lib/project-work.ts`): uno cortado o con «... resto igual» no sustituye al bueno. La lista de agentes (`AGENTS`) vive en `src/lib/project-work.ts` (el Centro de Inteligencia la reexporta) y la usa SUPER WILLY al trabajar en un proyecto. Si «Mi yo en IA» o la Fábrica necesitan abrir un proyecto o pasarle un encargo a SUPER WILLY, que usen esas funciones (para cambiarlas, regla 7).
16. **Desde la revisión 22 la vista previa del taller de SUPER WILLY lleva un «vigía»** (rediseño, fase 6; `src/lib/preview-runtime.ts`). La página del proyecto se enseña en un marco aislado (`sandbox` sin `allow-same-origin`) y el vigía, metido al principio de la página con `withMonitor`, solo le cuenta a WILLY lo que pasa dentro (consola, errores, recursos que no cargan, la ruta «#/…», los enlaces a otras páginas del proyecto y si se ve algo de verdad), con `postMessage` (`{ __willyVista: true, … }`, que se lee con `asMonitorMessage`). Con eso se hacen la **consola del proyecto** (aparte de los registros de WILLY), la **ruta recordada** (en el navegador, `willy-vista-ruta:<id del proyecto>`), la comprobación antes de decir «Lista» y la **reparación automática**: si un cambio de WILLY rompe la vista previa, SUPER WILLY la repara solo (como mucho 2 intentos, cada uno queda como versión) o declara el bloqueo y ofrece volver a la versión que funcionaba. Si «Mi yo en IA» o la Fábrica enseñan una página en un marco, pueden usar `withMonitor` y `asMonitorMessage` (para cambiarlas, regla 7).
17. **Desde la revisión 23 cada proyecto tiene su PLAN y su progreso es real** (rediseño, fases 7, 8 y 9). El plan vive en `datos-privados/proyectos/<id>/plan.json` (hitos con peso según el tipo de proyecto, tareas con peso y estado, lo que se sabe de verdad —archivos, README, vista previa, entrevista— y lo pendiente del dueño). Solo lo escribe el servidor de WILLY por `/api/proyectos` (`GET ?id=…&plan=1`, `POST action: "savePlan"`), siempre comprobado por `normalizePlan` (`src/lib/project-progress.ts`, que también calcula el porcentaje, la fase, el estado y lo que falta: nunca un porcentaje puesto a mano). Un proyecto sin plan sale como «Progreso no calculado» con «Analizar proyecto». La pantalla Proyectos es `src/components/projects-view.tsx` y enseña arriba **SÚPER IA como proyecto del sistema** (`src/lib/system-project.ts`: es virtual, no está en `datos-privados` y no se puede borrar). Si «Mi yo en IA» o la Fábrica crean proyectos, pueden guardarles un plan con esa misma API (para cambiar el formato, regla 7).
18. **Desde la revisión 24 el vigía de la vista previa también obedece a WILLY** (rediseño, fase 10: edición visual; `src/lib/preview-runtime.ts`). WILLY le manda órdenes con `sendOrder` (`{ __willyOrden: true, k: <marca de esa carga>, orden }`; las de otra carga o de otro marco se ignoran): `elegir` (el dueño toca un elemento y la página NO recibe ese clic), `marcar` (recuadra un elemento: el elegido o un problema), `soltar`, `revisar` (mide el diseño a ese ancho) y `desplazar`. Los recuadros son elementos propios `willy-marca`. El elemento elegido y DÓNDE está en el código (`src/lib/visual-edit.ts`) van a la IA; al dueño solo se le enseña en palabras (los detalles técnicos, en el modo avanzado). «Revisar diseño» (`src/lib/design-review.ts`) pinta la página a 1280, 768 y 390 px en marcos ocultos y, si en el equipo hay Edge o Chrome, hace **capturas de verdad** con el servidor (`POST /api/proyectos` `action: "capturas"`, `src/lib/project-capture-server.ts`, que usa `findBrowser`/`screenshot` de `src/lib/render-check.ts`, las mismas de la Autoconstrucción; las capturas van a la carpeta temporal y se borran al terminar). «Comparar» enseña dos versiones del proyecto lado a lado (`src/components/visual-tools.tsx`). Si «Mi yo en IA» o la Fábrica enseñan páginas en un marco, pueden usar estas órdenes (para cambiarlas, regla 7).
19. **Desde la revisión 25 los proyectos React/Vite se COMPILAN en el equipo para la vista previa** (rediseño; `src/lib/project-compile.ts`, `src/lib/project-compile-server.ts` y `src/lib/project-compile-ts.ts`). Si el `index.html` de un proyecto carga un punto de entrada de código (`src/main.tsx`…), el servidor de WILLY lo compila con lo que ya hay en su carpeta `node_modules`: con **esbuild** si la instalación lo tiene y, si no (Vite 8 ya no lo instala), con el **motor propio de WILLY, que usa su TypeScript** (el mismo de la comprobación de tipos de la Autoconstrucción); las librerías (React, lucide-react, Radix, Tailwind v4…) salen de esa misma carpeta: **sin npm, sin internet y sin ejecutar nada del proyecto** (ni su `vite.config` ni sus scripts). El resultado es una sola página con el código y los estilos dentro, que la vista previa enseña con su vigía (reglas 16 y 18). Se pide con `POST /api/proyectos` `{ action: "compilar", id, versionId? }` y responde `{ ok: true, html, page, entry, ms, bytes, warnings, tailwind, engine }` o `{ ok: false, errors, missing, env? }` (errores en español; `missing` = librerías que no trae WILLY; `env: true` = el fallo es del equipo, p. ej. no se encuentra el compilador, y entonces la vista previa sigue como antes). **No cambia el estándar de la IA**: los proyectos siguen pudiendo llevar su `vista-previa.html` (la usa `desktop-format.ts` de la Fábrica) y, si la llevan, se sigue viendo como siempre. Si «Mi yo en IA» o la Fábrica quieren ver o comprobar un proyecto React, pueden usar esa misma acción (para cambiarla, regla 7).
20. **Desde la revisión 26 el taller de SUPER WILLY tiene un MAPA DE PANTALLAS** (`src/lib/screen-map.ts` y `src/components/screen-map.tsx`): todas las pantallas del proyecto de un vistazo (las rutas «#/…» de una aplicación de una sola página y sus páginas HTML), cada una comprobada en pequeño en su propio marco aislado, con «Abrir» y «Reparar». El vigía de la vista previa (`src/lib/preview-runtime.ts`) cuenta además los enlaces «#/…» de la página (en el mensaje `calidad`, campo `enlaces`) y obedece una orden nueva, `ir` (`{ orden: "ir", hash }`: cambia de pantalla sin recargar). La vista previa es un marco aislado («about:srcdoc»): ahí solo se puede ir de una pantalla a otra con rutas «#»; por eso las IA de SUPER WILLY usan rutas con «#» cuando una aplicación tiene varias pantallas (`SCREEN_RULES`) y el mapa ofrece pasar a rutas con «#» un proyecto que no las usa. **No cambia el estándar de la IA** (`vista-previa.html` sigue igual). Si «Mi yo en IA» o la Fábrica enseñan páginas en un marco, pueden usar `ir` y los `enlaces` (para cambiarlos, regla 7).

21. **Desde el 24/09 hay una tercera conversación, «WILLY AI FRONT»**, que aplica el nuevo diseño (las maquetas de Antonio: barra lateral compacta por secciones, barra superior con «IA: Auto», «Todo operativo», avisos, tema y cuenta, tarjeta «Estado de WILLY», y las pantallas Inicio, Chats, Súper IA, Proyectos, Herramientas, Centro de Inteligencia y Autoconstrucción tal cual en las maquetas). Reparto: **FRONT solo pone la capa visual** (`src/front/**`, `styles.css`, `components/ui`, hooks del tema, `public/`) y **consume** los servicios y la lógica de «WILLY AI» (proyectos, plan y progreso `project-progress.ts`, `super-willy-handoff.ts`, `section-tabs.ts`, motores, Autoconstrucción) y de «AVATAR AI» (Mi yo en IA, voces) sin copiarlos ni sustituirlos. Las pantallas nuevas de FRONT envuelven las vistas actuales; las vistas actuales siguen existiendo (interfaz clásica, `/app?clasico=1`) hasta que cada pantalla nueva esté comprobada, y entonces se retiran de acuerdo con su dueña (migración sin romper).
22. **Desde la revisión 27 son TRES conversaciones**: «WILLY AI» (motor, servicios, Autoconstrucción, actualizador y el rediseño de SUPER WILLY y Proyectos), «AVATAR AI» (Mi yo en IA, voces, Fábrica de instaladores, `C:\WILLY_AVATAR`) y «WILLY AI FRONT» (el diseño nuevo de las pantallas, con sus archivos en la tabla de arriba). FRONT pone su armazón y sus pantallas ENCIMA de lo que ya existe y lo enlaza (no lo rehace): el taller de SUPER WILLY (`project-workshop.tsx`: vista previa, consola, edición visual, comparar, mapa de pantallas, compilación React, librerías), Proyectos con su progreso real (`project-progress.ts`, `system-project.ts`, el plan en `/api/proyectos?id=…&plan`), el traspaso del Chat a SUPER WILLY (`super-willy-handoff.ts`), Ajustes y Centro de Inteligencia (`settings-view.tsx`, `intelligence-center.tsx`, `/api/sistema`). Lo que FRONT necesite cambiar en archivos de «WILLY AI» se pide como en la regla 7 (o se manda como parche exacto). Regla 8 para las tres: nunca se actualiza a la vez desde dos conversaciones.
23. **Desde la revisión 27 las actualizaciones de «WILLY AI» solo escriben lo que cambia** desde la revisión instalada (antes volvían a escribir todo lo cambiado desde la revisión 7): así no pisan un archivo que no cambian y que otra conversación haya retocado (por ejemplo, el enganche de FRONT en `app.tsx`); nunca tocan los archivos de «AVATAR AI» ni los de «WILLY AI FRONT». Esta nota común tampoco se sustituye entera: si otra conversación la cambió, se conserva tal cual y solo se le añaden las reglas («Desde la revisión N…») y los informes nuevos (si el número de una regla ya lo usa otra, va con el siguiente libre). Y si la Autoconstrucción tiene una operación a medias, el actualizador le pide a WILLY que la resuelva él mismo, igual que con «Recuperar ahora» (nunca toca una operación viva; si hay una mejora en marcha, espera a que termine) y, mientras actualiza, la Autoconstrucción no empieza nada nuevo (`copias-autoconstruccion/actualizacion-en-curso.json`).
24. **Desde la revisión 27 WILLY instala librerías nuevas para los proyectos React SIN npm** (`src/lib/package-store-server.ts`, `src/lib/project-libraries.ts`, `src/lib/semver-lite.ts` y `src/components/project-libraries.tsx`): si un proyecto las pide en su package.json y son conocidas (al menos 1000 descargas a la semana en npm), se instalan solas desde el registro de npm (o su espejo registry.yarnpkg.com), con las mismas reglas de versiones que npm, comprobando la huella sha512 de cada paquete y SIN ejecutar nada de ellas, en `datos-privados/librerias-proyectos` (ninguna actualización lo toca); la compilación de proyectos las usa. React y lo que trae WILLY nunca se instalan otra vez. En `/api/proyectos`: `librerias`, `infoLibrerias`, `instalarLibrerias` (con `auto`: solo las que se pueden instalar solas) y `quitarLibreria`. No cambia el estándar de la IA (`vista-previa.html` sigue igual).
25. **Desde la revisión 28 cada proyecto tiene sus PRUEBAS AUTOMÁTICAS** (`src/lib/project-tests.ts`, `src/lib/test-runner.ts`, `src/lib/test-agent.ts`, `src/lib/test-session.ts` y `src/components/project-tests.tsx`): archivos `pruebas/*.spec.js` (o `.ts`) del proyecto con el formato de Playwright, que WILLY pasa solo en el navegador del dueño —en marcos aislados e invisibles, sin red, sin quitarle el foco— después de cada cambio (en el taller: botón «Pruebas»). Si un cambio de WILLY rompe alguna que iba bien, se repara sola (2 intentos o bloqueo), igual que la vista previa. El plan de cada proyecto guarda la última pasada (`evidence.tests`) y la huella de sus archivos (`evidence.filesKey`): la tarea «Funciones principales probadas» se comprueba sola y el 100 % exige que pasen con los archivos de ahora (`testsState` y `computeProgress` en `project-progress.ts`; en un proyecto sin páginas, esa tarea se marca como antes). En `/api/proyectos`, `transpilarPruebas` quita los tipos a las pruebas en TypeScript (no ejecuta nada). `ProjectWorkshop` tiene dos propiedades nuevas, opcionales (`onTestsRun`, `testsKnown`). Si «WILLY AI FRONT» enseña el progreso de los proyectos, que use `computeProgress` (ya lo tiene en cuenta) y no lo calcule aparte.
    - **Enganche en `src/routes/app.tsx`** (único cambio de FRONT en ese archivo): importa `FrontShell` de `@/front/shell` y lo usa en vez de `TopBar`/`Sidebar` (y pinta las pantallas nuevas de FRONT para las vistas `inicio`, `chat` y `herramientas`). **Petición a «WILLY AI»**: preparar cada revisión a partir del `app.tsx` instalado (con ese enganche) y, en la siguiente revisión, sacar `ChatPanel` y sus piezas de `app.tsx` a `src/components/chat-panel.tsx` (exportado), para que el armazón (FRONT) y el chat (WILLY AI) vivan en archivos distintos y ninguna de las dos pise a la otra.
    - **Reglas para las tres**: (a) antes de enviar nada, releer del equipo los archivos que no son propios y, si hay que tocar uno ajeno, mandarlo como parche exacto (`patches`, buscar→sustituir), nunca el archivo entero; (b) una operación cada vez: la Autoconstrucción ya lo garantiza, pero además cada conversación anota en `claude/willy-coordinacion-cambios-en-equipo.md` (proyecto) qué acaba de instalar y las huellas; (c) `APP_REVISION` sigue siendo solo de «WILLY AI»; lo de FRONT queda como versión local numerada; (d) los datos de las pantallas salen SIEMPRE del sistema (nada de porcentajes ni estados inventados: si no se puede calcular, se dice); (e) un botón de la maqueta sin función definida no se inventa: se marca «pendiente de decisión» y se pregunta a Antonio.
    - **Petición a «WILLY AI» (regla 7)**: una acción nueva en `/api/self-build`, `{"action":"apply-file","name":"<archivo>.json"}`, que aplique un paquete `{name, files, patches, checks}` guardado en `intercambio-front/` (o `datos-privados/mejoras-pendientes/`) con el mismo circuito de siempre; así las tres conversaciones pueden dejar paquetes grandes en disco sin trocearlos por el navegador.
    - **Petición a «AVATAR AI»**: Chatterbox (local 5) no llegó a instalarse (la operación se recuperó sin tocar nada; los paquetes de `claude/traspaso-voces-tanda3.md` siguen valiendo sobre lo instalado). Para Herramientas y Mi yo en IA, decir qué acciones reales de `/api/avatar` y `/api/voces` puede conectar FRONT (identidades, imágenes, vídeo, voz) y cuáles no existen todavía.

## Revisión 14 — INFORME PARA WILLY AI

Hecha por «AVATAR AI» a petición de Antonio («dame tú el definitivo con lo tuyo»), sobre la revisión 13 instalada (comprobada archivo por archivo antes de empezar). No toca «Mi yo en IA», las voces, el avatar, `datos-privados` (tampoco las reglas del dueño de `dueno.json`) ni `C:\WILLY_AVATAR`.

Qué añade: en *Nuevo proyecto → Replicar aplicación/programa*, cuando el destino es un programa de Windows, la pestaña **Replicación** tiene la **Fábrica de instaladores**: monta el programa con su propio motor (el `tools/node.exe` de WILLY), compila su lanzador y su instalador con NSIS 3.05 (incluido en `tools/nsis`) y lo prueba DE VERDAD en el equipo: instalación limpia en modo prueba (sin tocar el programa del dueño si ya lo tiene), primer arranque, pruebas de aceptación aisladas (permisos de Node: solo leen el programa y escriben en su carpeta de pruebas) y desinstalación. Las comprobaciones de la réplica (compilación, instalación, primer arranque, instalador, desinstalación, funcionalidad…) salen de ese informe real; si el código cambia, vuelven a «pendiente». Con todo superado, el botón final es **DESCARGAR INSTALADOR**. Las réplicas web no cambian.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 13 → 14 (regla 10). | `adc1ee979746c004eb44ca1a8b5f5fd7493a71140c382e4bdc436e5f0e370b08` |
| `src/lib/product-rebuild.ts` | CAMBIA | Réplicas de Windows: las comprobaciones salen del informe real de la fábrica; añade `docs/formato-escritorio.md` y el formato del programa a las instrucciones de réplica. | `64a308f8a74c2758c69b218df5bb8cb3e0b85c4027fd2a52d18599aed12006bb` |
| `src/components/rebuild-panel.tsx` | CAMBIA | Sección «Fábrica de instaladores (Windows)» antes de «Comprobaciones de WILLY» y botón «DESCARGAR INSTALADOR». | `0325b6d11769427e623b9d894dd7753a10e2ff9dfa621a86095554ed096f447b` |
| `src/routeTree.gen.ts` | CAMBIA | Generado por la compilación: añade `/api/fabrica`. | `b526204106bcb1a32de5784ab2b9efc6a1da7c6e5e4d5670b6758096e10bd2d1` |
| `src/lib/desktop-format.ts` | NUEVO | Formato de programa de escritorio (`programa.json`, `app/`, `servidor/api.mjs`, `pruebas/*.test.mjs`), su comprobación y el informe. | `4d7dceaca44fa505b2ce37d41ad452d871c4ba78287a98c08f41d735981fb2fd` |
| `src/lib/installer-scripts.ts` | NUEVO | Guiones de NSIS: lanzador sin consola e instalador por usuario (con modo `/PRUEBA`) y su desinstalador. | `25e8663923f7ad26f9778a5ae31524777ade1d43d46c4a4c7dc5dd75a7be5a14` |
| `src/lib/installer-factory.ts` | NUEVO | La fábrica: montar, compilar, instalar en prueba, arrancar, pruebas aisladas, desinstalar e informe (`fabrica/<proyecto>/`). | `0953c243f2b48c5e946c43a1ea17edd6d06f8b4b83a81da172a59ed046de1f37` |
| `src/lib/app-icon.ts` | NUEVO | Icono propio de cada programa (.ico y .png), dibujado sin imágenes de fuera. | `e374b10606f4553e208d25539cc851e8c5beea5a97d716874eea91031e3c9b9f` |
| `src/lib/desktop-runtime/servidor.mjs` | NUEVO | Motor que va dentro de cada programa: solo 127.0.0.1, datos en `%LOCALAPPDATA%\<id>`, ventana de Edge y autoprueba. | `fbc69b85e89c9f9023d3d49a3f97ad2b07e2d016592bbcdc64f7bddff56deda5` |
| `src/components/factory-section.tsx` | NUEVO | La sección de la fábrica en la pestaña Replicación. | `e2d82c798f9ad8a91c7478956cff4f7a0cea12bc919241b8e36a4b7d7a9ca168` |
| `src/routes/api/fabrica.ts` | NUEVO | `/api/fabrica`: estado, fabricar, avance, informe y descarga (solo desde la propia WILLY). | `a25221cf50f463abafe2ed4eaa97a1bfb35a37c836dbf5071b5f7e52c2a68baa` |
| `tools/nsis/` | NUEVO | NSIS 3.05 para compilar en Windows (314 archivos, licencia zlib/libpng; origen y huella de la descarga en `tools/nsis/ORIGEN.txt`). | — |
| `COORDINACION-IAS.md` | CAMBIA | Fila de la fábrica en «Quién lleva qué», regla 10 y este informe. | — |

Para la revisión 15:
- Añade un paso `from: "0.0.43+14"` y usa estas huellas como `knownHashes` de esos archivos.
- Los archivos de la fábrica los lleva «AVATAR AI» (tabla de arriba); si necesitas cambiar algo ahí, pídelo como en la regla 7.
- `npx tsc --noEmit` sigue marcando `src/lib/capability-registry.ts(93,22): TS7030` (ya estaba en la revisión 13; no impide compilar y no lo he tocado). Ningún archivo nuevo añade errores.

## Revisión 18 — INFORME PARA AVATAR AI

Hecha por «WILLY AI» sobre la revisión 17. **No toca** la pestaña del avatar («Mi yo en IA»), las voces, la fábrica de instaladores, `C:\WILLY_AVATAR` ni `datos-privados`.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/lib/project-discovery.ts` | NUEVO | Entrevista del proyecto de SUPER WILLY: bloques de preguntas con su recomendación, funciones, brief vivo, resumen y encargo de construcción (lógica pura, sin IA). | `e4ac393e14358e5dc42266dc30c277c0ac691b25e0c0321f13f38a0995185ef2` |
| `src/lib/super-willy.ts` | NUEVO | Con qué IA trabaja SUPER WILLY (Externa primero · Híbrida · Local primero · Solo local), aparte de la pestaña Chat. | `d7f507a65e3a5d116b8c9a3f71dbf5b038fdec6e4ca35a08c990df71c686ef0e` |
| `src/components/project-discovery-panel.tsx` | NUEVO | Pantalla de la entrevista del proyecto. | `a109c30c4167baa81208b812bc58a7a0b6a605d3170001b4504052db35d65c2b` |
| `src/components/super-mode-chip.tsx` | NUEVO | Botón del modo de IA de SUPER WILLY (con el alta de claves gratuitas). | `d7da07a32aae18a2e91e27d29834000fa671494a726302806410bb9f4dd31f53` |
| `src/components/superia-view.tsx` | CAMBIA | SUPER WILLY: entrevista antes de construir, su propia IA, conversación que la IA recuerda y «Nuevo proyecto». | `a023d7cec85b4ee725d357419a9a63079dc23a29dcb097a6c89df620b61d6153` |
| `src/services/worklog.ts` | CAMBIA | Conversación del proyecto con memoria para la IA y límites de espacio en el navegador. | `9fad37f79cf7e98c8f678d586595d665aae15e051f626e6c99f9e7eeef9c172c` |
| `src/services/orchestrator.ts` | CAMBIA | `runTask` acepta la conversación anterior (`history`). | `b4907980427097a37e3cf82d8be746f4eeead8515f3c8d4d800361b0b4ec9642` |
| `src/lib/workspace-store.ts` | CAMBIA | El modelo propio de SUPER WILLY se decide ahora en `lib/super-willy.ts`. | `47307de2edac1a8e16fd7780ddc4e2ab515c2c19c0df0037e570af1adbaae356` |
| `src/components/chat-engine-chip.tsx` | CAMBIA | El panel «IA externa» admite «solo claves» (`keysOnly`) para SUPER WILLY; en el Chat no cambia nada. | `3a9d6d7418dc155592076250c2e71b99c42d36e439e934218ff9d8ce7d4af8bd` |
| `src/routes/app.tsx` | CAMBIA | Menú: «Súper IA» → «SUPER WILLY». | `eb788ca1d11f1840e605f5a6a069d7923aec7e0971b5876700bab7d1cc2bb8e5` |
| `src/routes/movil.tsx` | CAMBIA | Pestaña del móvil: «SUPER WILLY». | `495a924934e06c4595e6d33126e21704dd6f0fdc0563c9ed49770cbec0998faf` |
| `src/components/app-sections.tsx` | CAMBIA | Título de la pestaña: «SUPER WILLY». | `4b66549e2eb17c0d469358425e436aa4a41e37fa0dc6f65475265e9384ef76a6` |
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 17 → 18. | `ea6960a3b81e8ebeccf25dc0f4f8bc7cbd7332aec3b777a293041966ffc330bc` |
| `COORDINACION-IAS.md` | CAMBIA | Restaurado el de la revisión 14, más la fila del supervisor, las reglas 11 y 12 y este informe. | — |

Si «AVATAR AI» necesita cambiar alguno de estos archivos, que lo pida como dice la regla 7.

## Revisión 19 — INFORME PARA AVATAR AI

Hecha por «WILLY AI» sobre la revisión 18 que está instalada (incluido el arreglo de «AVATAR AI» en `src/lib/comfy-install.ts`, que **no se toca**). **No toca** la pestaña del avatar («Mi yo en IA»), las voces, la fábrica de instaladores ni `C:\WILLY_AVATAR`. Nuevo en `datos-privados`: la carpeta `proyectos` (regla 13), que escribe el servidor de WILLY mientras se usa, nunca el actualizador.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/lib/project-store-server.ts` | NUEVO | Almacén de proyectos en `datos-privados/proyectos` (rutas seguras, escrituras atómicas, versiones, paso desde el navegador comprobado). | `52b9c6f00974bc4d6f37ff367de425701fbc76e2e565f54e0c7b7544c11b4475` |
| `src/lib/project-api-server.ts` | NUEVO | Lo que responde `/api/proyectos` (solo a la propia WILLY). | `051290843452bcf506b40dc1198dd5f814f0942199755a7350bc3603abd6f01d` |
| `src/routes/api/proyectos.ts` | NUEVO | Ruta `/api/proyectos`. | `75f1424a75acaa1e8159a9b11df7d4d512408b776252e34b0b8161bd4c61f949` |
| `src/services/disk-project-service.ts` | NUEVO | La interfaz habla con ese almacén (por defecto). | `e888ab2067c9b1d99b0df66059b153909796b59412d344ce559f8502658e7407` |
| `src/services/project-migration.ts` | NUEVO | Paso de los proyectos del navegador al equipo y de las entrevistas de SUPER WILLY de antes a proyectos. | `efe09561653aa1b2a6ea1b54e1a4610f54e51e7d2877b75db4addf77e4dc1466` |
| `src/lib/super-willy-projects.ts` | NUEVO | SUPER WILLY ↔ Proyectos: crear el proyecto, guardar su conversación y sus archivos, abrirlo desde Proyectos. | `42c378d015c9c95ee49b0b0190215772dda023d5e55ddad693533de1f17ac067` |
| `src/services/project-service.ts` | CAMBIA | Por defecto, los proyectos del equipo; ya no se siembran los 6 ejemplos. | `f8f2114d7019ba0f09886017c1c48d950b51284d061fdcf2ed2d7f769ad1abfd` |
| `src/services/api-project-service.ts` | CAMBIA | El servidor opcional admite los datos nuevos del proyecto. | `19a92b5e644656146ca60c25c350246e0a511800c446e2fb5e0daf9bbe82b715` |
| `src/services/worklog.ts` | CAMBIA | El trabajo de SUPER WILLY sabe a qué proyecto pertenece. | `9a3c7a5ada71829ca070ebd97b5a11cd1c86f4da37bf08201c82da2d84a8df62` |
| `src/services/demo-service.ts` | CAMBIA | El informe cuenta con los proyectos reales del equipo. | `b2fe8a74023cfc5de438a11a80da8e233773c17d0c34f2a7cfd7fe8772396912` |
| `src/types/domain.ts` | CAMBIA | Datos nuevos del proyecto (origen, tipo, conversación, número de archivos) y los ejemplos de antes. | `d3a4231099baa58db1e4c1db957ac5d5cd06f113a2fb316e1bb06bc61374b143` |
| `src/lib/workspace-store.ts` | CAMBIA | El proyecto abierto se recuerda por su identificador. | `74531401d508c0038da45c2c758dae6b6669656f392ad7876d5c40996f7bfcce` |
| `src/components/superia-view.tsx` | CAMBIA | SUPER WILLY crea y guarda el proyecto desde el primer momento. | `c37f75cf67d97c9d57a7a2a7007d4bdd49a178ac160e99a643b5a67443e66a5d` |
| `src/components/app-sections.tsx` | CAMBIA | Proyectos: los de SUPER WILLY con su marca, ejemplos ocultos, sin datos inventados (también Cuenta e Historial). | `7cbfc41e8f5f2d9cb1556ef629186ae131c66f2c260ca8f3dc0865e2e14aa121` |
| `src/components/demo-view.tsx` | CAMBIA | Demo con datos reales del equipo. | `681db81b8861c8d323c1cee246537d3eb7b7e883676bb79bdef9bc68cc9e61d7` |
| `src/routes/app.tsx` | CAMBIA | Proyecto abierto por identificador; los de SUPER WILLY se abren allí; fuera la demo y los archivos inventados del taller. | `ec3e666c9a3452674fd34d157d25a254fba32fd8cbe919aafbc5ba3992b04449` |
| `src/routes/admin.tsx` | CAMBIA | Informe con datos reales del equipo. | `62b4fe2a27f8ca979d32922bc3d90a3a732081136188fbcb4b019ad4e3ab18e9` |
| `src/routeTree.gen.ts` | CAMBIA | Añade `/api/proyectos`. | `3462f8d1a6d8dd3749b516afc93dca08513bb64d3a8c8493097b07747517cdf8` |
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 18 → 19. | `9a2aab4d320149f9afdcf220a8e8e2a574f98d64559e926eac8410c37b96b40b` |
| `COORDINACION-IAS.md` | CAMBIA | Regla 13 y este informe. | — |

Si «AVATAR AI» necesita cambiar alguno de estos archivos, que lo pida como dice la regla 7.

## Revisión 20 — INFORME PARA AVATAR AI

Hecha por «WILLY AI» sobre la revisión 18 que está instalada (vale también desde la 19) y sobre lo que «AVATAR AI» ha aplicado después con la Autoconstrucción: **no toca** `src/lib/voces-extra.ts`, `src/components/mas-voces.tsx`, `src/lib/voices-server.ts`, `src/lib/avatar-server.ts`, `src/components/natural-voices-card.tsx` ni nada del avatar, las voces, la fábrica de instaladores o `C:\WILLY_AVATAR`. Tampoco `datos-privados` (incluidas `voces-motores` y `proyectos`). Lo nuevo del menú y de `/api/sistema` está en la regla 14.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/lib/maintenance-server.ts` | NUEVO | Lo que hacen de verdad Ajustes y el Centro de Inteligencia en el servidor: estado de WILLY, reiniciar/detener, almacenamiento, caché, registros sin claves, dependencias, diagnóstico e IA del equipo (Ollama). | `db4935445669f06522f135684c043e0b1fe58d73d0d9f163ca6e5f041461cafa` |
| `src/lib/maintenance-api-server.ts` | NUEVO | Qué responde `/api/sistema` (solo a la propia WILLY; reiniciar y detener solo desde el ordenador). | `0e1b452509d1569aa59a9e229cf989ce01a8d917558a2a0bb1ae820f84e29a05` |
| `src/routes/api/sistema.ts` | NUEVO | Ruta `/api/sistema`. | `e4e184d7024f593e726a2782069a60baca32046b158800ead4983eccd31b7acc` |
| `src/lib/maintenance-client.ts` | NUEVO | Lado del navegador de `/api/sistema`. | `c29792fc3bc42d56fdb4a4c8862bd1bb225d6398f7c3386bcc0d7bb3b713610b` |
| `src/lib/section-tabs.ts` | NUEVO | Abrir una pantalla en una pestaña; las pantallas antiguas llevan a su sitio nuevo. | `8da3b0eeae85a00cab228abaf8c3fa3a1c46a34684fa731565ac4306bd735cda` |
| `src/components/section-ui.tsx` | NUEVO | Piezas comunes de las pantallas (cabecera, interruptor, pestañas, estado). | `6724982e58d690b6d433e54a2472188648dd8fadd061db26b41a5e53fe69da3b` |
| `src/components/settings-view.tsx` | NUEVO | Pantalla Ajustes. | `1851305e18a7144696809556086f29d47617aaff338f1e10af9b142ef7dbc16e` |
| `src/components/intelligence-center.tsx` | NUEVO | Pantalla Centro de Inteligencia (con el aviso de IA «solo por procesador»). | `32ba20932d2ca8e21873b0a5aaff07213622be2fc3a0761d1ececf1636ac40cc` |
| `src/components/app-sections.tsx` | CAMBIA | Fuera Workspace, Agentes, Modelos, Configuración y Estado como pantallas; entran Ajustes y el Centro; Herramientas solo con lo que funciona; documentación al día. | `def5591a0f8178a77a02cf40f6ab1069885d2c95abbfa7fc77db3c6ad8d9dbe5` |
| `src/routes/app.tsx` | CAMBIA | Menú nuevo; los accesos de arriba van al sitio nuevo; Publicar, Compartir y Cerrar sesión de verdad; fuera las «herramientas» del chat que fingían. | `9a03b932685a76c0ab38665a28dcb61e9c363c982e739e389df4c7bfc405500c` |
| `src/routeTree.gen.ts` | CAMBIA | Añade `/api/sistema`. | `fa0b4856deaef1bcd78ab6258d8d68fea12aa6a8b02d67faec04f241aae8fe62` |
| `src/lib/system-info.ts` | CAMBIA | Si la IA del equipo va solo por procesador, a medias o en la gráfica (y por qué). | `ef9fabb613210fbf3653e1dec9804be0afab305e00528439b2e4e70383794ae3` |
| `src/lib/system-ops.ts` | CAMBIA | Limpiar copias ya no borra las protegidas por la Autoconstrucción ni la copia desde la que funciona el servidor. | `68ce25cc31388c77c34c3dfef57da5c6f90d506e948b8918328b3635943c5f9e` |
| `src/lib/error-capture.ts` | CAMBIA | Guarda en memoria los 100 últimos errores del servidor (para Registros). | `64b820d4fff6d807578214cf8645495602ee97c39bfea1a8e9903412a9aa0847` |
| `src/components/home-live.tsx` | CAMBIA | Inicio: «Conexión» real. | `0b879380e1d1d0451cecbce01e0ccfa72690c58ae58beea29fed6e0b9031fed8` |
| `src/components/model-picker.tsx` | CAMBIA | Sin lista de modelos inventada cuando no hay ninguno. | `a6575997f7a31a9931d094bcc8b132eaf809f8dfa52be47d56e4de85ad6e06a7` |
| `src/components/update-view.tsx` | CAMBIA | Actualizaciones: lo que hay de verdad (sin el «.exe» que no instalaba nada). | `9c593b409b2160c3ac68eb7bd3437becb9db56886f0b4a95d6f1bd8971841757` |
| `src/components/self-build-view.tsx` | CAMBIA | Se puede abrir directamente en una pestaña (p. ej. Versiones). | `1cca8e12217adc557a7d80e5fa2d7c470b1c26eca3763f2f2019581b2c9d0c13` |
| `src/lib/workspace-store.ts` | CAMBIA | Ajustes retirados (modo sin conexión, carpeta de modelos, herramientas) marcados como sin uso; se conservan. | `363e288d4a4383b9a2136260b1bf2111f0b6031d4eca5c340021c7b8697d4c53` |
| `src/services/demo-service.ts` | CAMBIA | Lista de pantallas al día. | `742e82e3fad75c2a86c8065732606bd390387606c68e3aa141a6adbd42433cd9` |
| `src/routes/admin.tsx` | CAMBIA | Fuera el «Modo sin conexión». | `cdd85617a78c0269d32c79ce44a4715cd3c5cc186691c121264016c43470ecc9` |
| `src/lib/engine-check.ts` | CAMBIA | Textos: «Centro de Inteligencia → Modelos». | `b64385215faf4412d89bb2850779a02909ca9287b6ca5504e9936bd5094d30e6` |
| `src/lib/state-pack.ts` | CAMBIA | Textos: «Centro de Inteligencia → Modelos». | `1557268a37727cfc73cb3b2beae72872259993a1cbb6fb40fe46d4a9b15b7181` |
| `src/lib/vision.ts` | CAMBIA | Textos: «Centro de Inteligencia → Modelos». | `6502d656b35a135228a4ce01df204720e6398b218a22c040dae76933b14dfeeb` |
| `src/lib/self-build-runner.ts` | CAMBIA | Textos: «Centro de Inteligencia → Modelos». | `8cae426657ee3a42d886fb967b6ba5a414aa0cf6164618bab75fa3ae24f7f8a7` |
| `src/lib/local-ai.ts` | CAMBIA | Textos: «Centro de Inteligencia → Modelos». | `9be725daa96e1dad57f7a447b6f252c72f97ec456fd51929ae7bdeaec4f0e56b` |
| `src/lib/model-health.ts` | CAMBIA | Textos: «Centro de Inteligencia → Modelos». | `ce1c498c6f7e385c680f8d1953c2284a7f9a42e8735133be9aac16a2349ca6f1` |
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 19 → 20. | `26082965d994d0cbe272b37fb75b4e4addb8da02338f9771e3464ee40d70b825` |
| `COORDINACION-IAS.md` | CAMBIA | Regla 14, las voces nuevas (`voces-extra.ts`, `mas-voces.tsx`) en la fila de AVATAR AI y este informe. | — |

Si «AVATAR AI» necesita cambiar alguno de estos archivos (o añadir una entrada al menú), que lo pida como dice la regla 7.

## Revisión 21 — INFORME PARA AVATAR AI

Hecha por «WILLY AI» sobre la revisión 20 (vale desde la 4). **No toca** nada del avatar, de las voces (`voces-extra.ts`, `mas-voces.tsx`, `voices-server.ts`, `piper-server.ts`, `natural-voices-card.tsx`, `/api/voces`), de la Fábrica de instaladores ni `C:\WILLY_AVATAR`, ni `datos-privados` (incluidos `proyectos` y `voces-motores`). Lo nuevo del Chat y de SUPER WILLY está en la regla 15.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/lib/line-diff.ts` | NUEVO | Diferencias reales entre versiones (línea a línea) y su resumen en palabras (pestaña «Cambios»). | `d1b93d755273f51f13ed22344b6e8aa77f7440c272c56a92a437a289a545b792` |
| `src/lib/project-work.ts` | NUEVO | SUPER WILLY trabajando sobre un proyecto: los archivos que ve la IA (lo privado nunca sale), cómo devolver los cambios, la comprobación antes de guardar y los agentes. | `faf4ab52acd387c12577f2fa424da9cf079fcf7099896c3a0f9d0b97835891a0` |
| `src/lib/super-willy-handoff.ts` | NUEVO | PROJECT ACTION del Chat y el encargo que recibe SUPER WILLY («Abrir en SUPER WILLY»). | `5de5df6ca02910a5aad46d83b3860310eb0d3fd568f7006a0f9343a36989296e` |
| `src/components/answer-body.tsx` | NUEVO | Cómo se leen las respuestas (Chat y SUPER WILLY): el código en bloques con «Copiar» o como tarjetas de archivo. | `9071371eb266b040113d5b4897e14aafcda776899f81db4caea24ad670f68156` |
| `src/components/project-workshop.tsx` | NUEVO | El taller del proyecto en SUPER WILLY (vista previa real con tamaños, ampliar y errores; código, archivos, cambios, versiones, replicación; exportar, publicar, compartir, revisar y archivar). | `0cb7db30bac97108beadf157500f258184f4c89ea9ebc070e2c7203d12689345` |
| `src/components/superia-view.tsx` | CAMBIA | Con un proyecto abierto: chat del proyecto + taller, divisor arrastrable y modos; abre cualquier proyecto; recibe los encargos del Chat y de «Nuevo proyecto». | `ba74f1155e5fc82425a8c53b5cb3b09dae40ff62143a9dd7151cd0acc22b53e9` |
| `src/routes/app.tsx` | CAMBIA | Chat limpio a todo lo ancho (sin taller) con «Abrir en SUPER WILLY»; los proyectos y «Nuevo proyecto» van a SUPER WILLY; la barra de arriba sin botones de proyecto. | `01c5bf27afe7125905fa75259c7bd13f0a5ebfd443284eb0dc9e03f19b91c689` |
| `src/components/app-sections.tsx` | CAMBIA | SUPER WILLY a toda la altura; «Abrir en SUPER WILLY» en Proyectos; documentación al día. | `320f784f02d2fe8594e181c99691eab4680fff7198b498a04e79cd3f526a8414` |
| `src/lib/super-willy-projects.ts` | CAMBIA | `saveAnswerFiles` comprueba cada archivo (y aplica SEARCH/REPLACE) antes de guardar. | `b9056e484d3f9fa57c338edb2f076e40ddea563a3049103c54e0e716ba1b338b` |
| `src/lib/live-files.ts` | CAMBIA | `previewOf`: qué se puede enseñar en la vista previa. | `0d0c8b93f93a040ec12484c6dfeffe59da556d4496e616b86226c953e01a8b29` |
| `src/services/project-service.ts` | CAMBIA | `useProject`: un proyecto con sus archivos, al día. | `69a6d1a6030003bedd91e956ba5b459f99d5c90102a599224677c605ccf36a7a` |
| `src/lib/chat-history.ts` | CAMBIA | El Chat guarda también sus tarjetas «Esto es un proyecto». | `1abc195954b5f3e507c8498fae2a53e78f94acfe98bbe2415eb4f3dd821d4754` |
| `src/components/intelligence-center.tsx` | CAMBIA | Agentes: ahora los usa SUPER WILLY (la lista vive en `src/lib/project-work.ts`). | `4c8932cc25e0d8e1fa369dc99813ea11887674612d565ec1a95fba8a5ff510b3` |
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 20 → 21. | `bde7ab50200590494bc4f6e8192630b228cec2f8b1d7e7e86abc5e9b0e4fd902` |
| `COORDINACION-IAS.md` | CAMBIA | Regla 15 y este informe. | — |

Si «AVATAR AI» necesita cambiar alguno de estos archivos, que lo pida como dice la regla 7.

## Revisión 22 — INFORME PARA AVATAR AI

Hecha por «WILLY AI» sobre la revisión 21 (vale desde la 4). **No toca** nada del avatar, de las voces (`voces-extra.ts`, `mas-voces.tsx`, `voices-server.ts`, `piper-server.ts`, `natural-voices-card.tsx`, `/api/voces`), de la Fábrica de instaladores ni `C:\WILLY_AVATAR`, ni `datos-privados` (incluidos `proyectos` y `voces-motores`). Lo nuevo de la vista previa está en la regla 16.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/lib/preview-runtime.ts` | NUEVO | El vigía de la vista previa y su lógica: consola del proyecto (resumen), comprobación antes de «Lista», lo que se pide para reparar y la reparación automática (máx. 2 intentos o bloqueo). | `9bddf39d60cafed84ecc2219a870797fb42c352ab099309ece9c53e95062c7ea` |
| `src/lib/live-files.ts` | CAMBIA | Todas las páginas del proyecto (no solo la principal), con sus estilos, scripts e imágenes SVG resueltos desde su carpeta (`htmlPages`, `buildPageHtml`, `resolveRef`, `previewOf(files, página)`). | `65f5ce7d55b3aa4d05cdadf8bb3fe5a0c96ffcea2151fb27c32c243341d61a4d` |
| `src/components/project-workshop.tsx` | CAMBIA | Vista previa premium: moverse entre páginas (enlaces, anterior/siguiente, selector), ruta recordada, pestaña Consola, «Se queda en blanco», «Se sale de la pantalla», aviso «No se puede mostrar la vista previa» con «Reparar»; la vista previa sigue viva al mirar otra pestaña. | `c223338e3e5e838fa57ee010894c0ffd8c201a2cdecc3fb4b210675a10452a70` |
| `src/components/superia-view.tsx` | CAMBIA | Reparación automática tras un cambio que rompe la vista previa (intentos, recuperada o bloqueo) y «vuelve a la versión que funcionaba». | `4d929ab5da79e683e6951bca35f9bc81a5b00fdb646e26bbb18039dcbd71fd2a` |
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 21 → 22. | `7bed5a50ea92ff4cedea1c4daa6415d74aa16d74bcc6a75c0459de55076654cc` |
| `COORDINACION-IAS.md` | CAMBIA | Regla 16 y este informe. | — |

Si «AVATAR AI» necesita cambiar alguno de estos archivos, que lo pida como dice la regla 7.

## Revisión 23 — INFORME PARA AVATAR AI

Hecha por «WILLY AI» sobre la revisión 22 (vale desde la 4). **No toca** nada del avatar, de las voces (`voces-extra.ts`, `mas-voces.tsx`, `voices-server.ts`, `piper-server.ts`, `natural-voices-card.tsx`, `/api/voces`), de la Fábrica de instaladores ni `C:\WILLY_AVATAR`, ni `datos-privados` (incluidos `proyectos` y `voces-motores`). Lo nuevo de Proyectos y del plan de cada proyecto está en la regla 17.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/lib/project-progress.ts` | NUEVO | Motor de progreso real: plan por tipo (hitos y tareas con peso), lo que se comprueba solo, Definition of Done, estados, fase, qué falta, filtros, orden y el bloque «plan» de la IA. | `526b5ab9d67c4e9789ac5b52457a1c11e6f540d7cd25ecc3bca81633d817fd55` |
| `src/lib/system-project.ts` | NUEVO | SÚPER IA como proyecto del sistema: su plan (lo hecho en cada revisión y lo que falta), sus versiones y pruebas. | `3e092723e2a90bf0ad0ad19e95f9ba926721d5f7ecac7750b5a2070db407473e` |
| `src/lib/project-plan-sync.ts` | NUEVO | SUPER WILLY mantiene al día el plan de cada proyecto (entrevista, entregas de la IA, vista previa, bloqueos). | `0a683e3afef861e15860c3c13c24917b2b49dece3a7dee11f018b24baf1fa6d3` |
| `src/components/projects-view.tsx` | NUEVO | Pantalla Proyectos nueva: resumen, filtros, orden, cuadrícula/lista, tarjetas con progreso real, fase, estado y acción; progreso por hitos y «qué falta»; SÚPER IA fijada arriba. | `023ccde74eb5cebcde7b3a81d4be0f929d1d39d7b8575f71d12d4d981530c65e` |
| `src/lib/project-store-server.ts` | CAMBIA | `plan.json` en la carpeta de cada proyecto (`readPlan`, `writePlan`); la lista y cada proyecto lo traen; duplicar lo copia. | `f0c26d2f383fa18e049314c46f7edc071e5dbdfede3d1d2ff0ee9d676153405d` |
| `src/lib/project-api-server.ts` | CAMBIA | `GET ?id=…&plan=1` y `POST savePlan`. | `bf5368115ac748374151f64262539b7f11fd7044307b3b4ee9630086fa43b048` |
| `src/services/disk-project-service.ts` | CAMBIA | `fetchProjectPlan` y `saveProjectPlan`. | `f3beafb067cf516e6b42507b3823b7191d1e3f01fa9d455ca93c8de51a6d33dc` |
| `src/types/domain.ts` | CAMBIA | `Project.plan` (opcional). | `b1f6df33958d5a470c9f8c2b8a9356dcf0ea2bf8c6893f8089fcb82cbc3ca7da` |
| `src/components/superia-view.tsx` | CAMBIA | El plan en lo que ve la IA y al guardar; «Análisis del proyecto» (sin tocar archivos); bloqueos de la reparación automática en el plan. | `a9151b4e977131fe6197a565b20b7ffdab4e439af2e9c2d751fab12d5426bb58` |
| `src/components/app-sections.tsx` | CAMBIA | Proyectos usa la pantalla nueva; nueva guía «El progreso de tus proyectos». | `91218e18638ca5313f53d0e6eff8f1d5e2b78d657467e32a7a012094c4df89c8` |
| `src/components/answer-body.tsx` | CAMBIA | El bloque «plan» de una respuesta se ve como una línea («Progreso del proyecto al día»). | `bdbab44c818ec70a0ce65f9385d206611ee6f1cfe1e3ffd43d7547c3e5cb86ee` |
| `src/lib/ai-standard.ts` | CAMBIA | `extractFiles` nunca guarda un bloque «plan»/«plan-json» como archivo. | `712b800c70f51efbda2baedcea64c8532bae3b3fa84c8164d974fe7053e198eb` |
| `src/lib/background-tasks.ts` | CAMBIA | El trabajo en segundo plano dice en qué proyecto se trabaja (`projectId`). | `f67251007595f3b912907a05ff9c06a15f64bbde2107f66b83e54ea31e723a41` |
| `src/lib/super-willy-handoff.ts` | CAMBIA | Encargo `analysis` («Analizar proyecto» desde Proyectos). | `d0f433b43a64206b9cc455c8bb0701628ad6e00ef6ae3e24a39487d7b85dd5ff` |
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 22 → 23. | `0389d1a5cbd297d8d89bfdc212d8df2124814d6184097fdf42f6285c81b87972` |
| `COORDINACION-IAS.md` | CAMBIA | Regla 17 y este informe. | — |

Si «AVATAR AI» necesita cambiar alguno de estos archivos, que lo pida como dice la regla 7.

## Revisión 24 — INFORME PARA AVATAR AI

Hecha por «WILLY AI» sobre la revisión 23 (vale desde la 4). **No toca** nada del avatar, de las voces (`voces-extra.ts`, `mas-voces.tsx`, `voices-server.ts`, `piper-server.ts`, `natural-voices-card.tsx`, `/api/voces`), de la Fábrica de instaladores ni `C:\WILLY_AVATAR`, ni `datos-privados` (incluidos `proyectos` y `voces-motores`). Lo nuevo de la vista previa (edición visual, revisión del diseño con capturas y comparar) está en la regla 18.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/lib/visual-edit.ts` | NUEVO | El elemento elegido en la vista previa: qué es en palabras, DÓNDE está en el código (archivo, línea y reglas de estilo), lo que recibe la IA y los cambios rápidos. | `080a2b796ddd16994161eb438432c46c543631e975193395b728bf02917d0560` |
| `src/lib/design-review.ts` | NUEVO | Revisión del diseño en 3 tamaños: juntar lo de cada tamaño, lo que se ve en el código (viewport, título), resumen y petición de arreglo sin cambiar el diseño. | `b312be11dc77f92f3587e8cbe5830915c27be9b6e545b84e90f73cc323904e43` |
| `src/lib/project-capture-server.ts` | NUEVO | Capturas de verdad de la página de un proyecto con el Edge o el Chrome del equipo (dentro de un marco del ancho exacto). | `07cc75d2cfcb02c7c976d73baaa129f763e024cf8dbf5d4da9926648b784d903` |
| `src/components/visual-tools.tsx` | NUEVO | Paneles del taller: «¿Qué quieres cambiar?», revisión del diseño (capturas, IA de visión, «Arreglar lo elegido») y «Comparar» ANTES | DESPUÉS. | `8f4d4744c3b181b3e00f80f5a276f31792e49245d4cc59b21372849751017a25` |
| `src/lib/preview-runtime.ts` | CAMBIA | El vigía obedece órdenes de WILLY (elegir, marcar, soltar, revisar, desplazar) y cuenta lo elegido, la revisión y el desplazamiento. | `5007387a717ab72078a37e59abf3df82cd68d6cff202c8a2044115b76e226354` |
| `src/components/project-workshop.tsx` | CAMBIA | Barra de la vista previa con «Seleccionar elemento», «Revisar diseño» y «Comparar»; lo elegido va en el contexto visual. | `9dcd9ce460eb2f09da4fe050076d5553c5722d00e7f8b6e748d49f13d9e93f65` |
| `src/components/superia-view.tsx` | CAMBIA | Los cambios de la edición visual se piden con lo que ve el dueño en el chat; el motor local para la IA de visión. | `5e70941305e4f3a2a8644b03757a88a0aa387bf4f5f01cae0fdb1903ba52f02e` |
| `src/lib/render-check.ts` | CAMBIA | `screenshot` admite opciones de más para el navegador (`extraArgs`). | `ab045d060202a312b68cca6dd63d9cce667125112697e78ecbf3b6601b50e7a1` |
| `src/lib/project-api-server.ts` | CAMBIA | `POST action: "capturas"`. | `c2454f472a25ccfe520b09c20a0a1472e1a379cebc6fe4279362848870c59b47` |
| `src/services/disk-project-service.ts` | CAMBIA | `captureProjectPage`. | `9bd6eb3c43cba7d43bce065f32fb16882b510aa997cb7650f5cd33825ba775a8` |
| `src/lib/system-project.ts` | CAMBIA | SÚPER IA: edición visual, revisión del diseño y comparar, hechas en la revisión 24. | `78a4f78a7a115c79bfa66ae1a0e8a45722f07295fc7e927e014f203f60350685` |
| `src/components/app-sections.tsx` | CAMBIA | Nueva guía «Cambiar algo tocándolo en la vista previa». | `d37daa332a72f1ae00584cc6c06ede08982ddf4c37200ddddd3d6da4e1e2d2a4` |
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 23 → 24. | `7010af7557524ae795bc43e0390d78400882038677b9f668cbb288866e0b9d2e` |
| `COORDINACION-IAS.md` | CAMBIA | Regla 18 y este informe. | — |

Si «AVATAR AI» necesita cambiar alguno de estos archivos, que lo pida como dice la regla 7.

## Revisión 25 — INFORME PARA AVATAR AI

Hecha por «WILLY AI» sobre la revisión 24 (vale desde la 4). **No toca** nada del avatar, de las voces (`voces-extra.ts`, `mas-voces.tsx`, `voices-server.ts`, `piper-server.ts`, `natural-voices-card.tsx`, `/api/voces`), de la Fábrica de instaladores (tampoco el estándar de `vista-previa.html` que usa `desktop-format.ts`) ni `C:\WILLY_AVATAR`, ni `datos-privados` (incluidos `proyectos` y `voces-motores`). Lo nuevo (los proyectos React/Vite se compilan en el equipo para la vista previa) está en la regla 19.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/lib/project-compile.ts` | NUEVO | Qué se compila de un proyecto React/Vite (su página y su punto de entrada), las librerías que trae WILLY, los errores en palabras y la petición de reparación. | `eea760fdcc96ddd32b28c68e908c857f0860e67b13c27813ae34e46d50c6e02d` |
| `src/lib/project-compile-server.ts` | NUEVO | Compila el proyecto en el equipo con las librerías de WILLY (y Tailwind v4 si lo usa): con esbuild si lo hay y, si no, con el motor propio. Sin npm ni internet y sin ejecutar nada del proyecto. | `bed6286381ff642411e2f29eacc8f248e9b9a50c57d4617b18e807c6aa47432e` |
| `src/lib/project-compile-ts.ts` | NUEVO | Motor propio de WILLY para compilar (para los equipos sin esbuild): traduce el proyecto con su TypeScript y lo junta con las librerías de node_modules (con sus «exports»), con sus estilos. | `594ed45deb910c5b4d75642add603937753c19a1cad9b1e06babd418cfd133af` |
| `src/components/project-workshop.tsx` | CAMBIA | La vista previa enseña la página compilada; «Compilando en tu equipo…», «No compila» con sus errores, «Reparar» y la reparación automática. | `f7dd25d29a77f689c07fc9daa886da9fa646ef94b278155bb6496b477b6de75b` |
| `src/components/visual-tools.tsx` | CAMBIA | «Comparar» compila cada versión de un proyecto React antes de enseñarla. | `1c768c8838255ad4870632e9bfbfec531a0101105627adda15993544c31597f0` |
| `src/lib/preview-runtime.ts` | CAMBIA | Estados nuevos de la vista previa: «compilando» y «no compila». | `9beb9931f79f5963faaa33d574f06ec5076689c81f7cffc5c4b86334e9defab4` |
| `src/lib/visual-edit.ts` | CAMBIA | La edición visual también encuentra el elemento elegido en los componentes React (JSX) y sus estilos en los .css. | `765188767e05aabfd46d33d3ff99904b2d4e6697d10398a1dff6c27635e211ef` |
| `src/lib/project-capture-server.ts` | CAMBIA | Las capturas de «Revisar diseño» de un proyecto React se hacen sobre la página compilada. | `d270ddb19ea3380bcbfc8a8816cbf289d0b51d89502714a6bd7e63389984fa93` |
| `src/lib/live-files.ts` | CAMBIA | `inlineAssets` e `inlineCssUrls` exportadas (las usa la compilación para meter los estilos y las imágenes en la página). | `df190f2db2647a475877ce9a8c07eeedab8bcbeaa218ae9400a0ff5991e26c68` |
| `src/lib/project-api-server.ts` | CAMBIA | `POST action: "compilar"`. | `7ed9f0c3489356ad3ad832074fb7aa03c826d6e1233fbf8da1591f26c5288485` |
| `src/services/disk-project-service.ts` | CAMBIA | `compileProjectPreview`. | `1331a020d11d263b16e23017196ab1eda449ccefed770093334771e3e729c59d` |
| `src/lib/project-plan-sync.ts` | CAMBIA | Un proyecto que no compila cuenta como vista previa rota en su plan. | `692fcd5dc9a631b222a38afeb37ea0b2c52457a0cc677286aec53474e5639660` |
| `src/components/superia-view.tsx` | CAMBIA | En los proyectos React, la IA recibe las reglas para que su código compile en el equipo (qué librerías hay). | `f74370c11b97447916595792371ad5f8d04d5df318d40c8a9181e31d3d30107c` |
| `src/lib/system-project.ts` | CAMBIA | SÚPER IA: compilación de proyectos React y regresión del rediseño, hechas en la revisión 25. | `7d41133bd52fefa4da278fbac3d9152b2b793fae55f5d7c43c93664470ac9381` |
| `src/components/app-sections.tsx` | CAMBIA | La guía «Vista previa en vivo» explica la compilación de los proyectos React. | `7de16b1f99e5b83c6d6e76cec10ee01224bcf4f8ce20259196e99538108c46cd` |
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 24 → 25. | `839729e8bee742a389c3b2ae8fd1ada3facbb4b26f3880abc3d1272c1de56e2d` |
| `COORDINACION-IAS.md` | CAMBIA | Regla 19 y este informe. | — |

Si «AVATAR AI» necesita cambiar alguno de estos archivos, que lo pida como dice la regla 7.

## Revisión 26 — INFORME PARA AVATAR AI

Hecha por «WILLY AI» sobre la revisión 25 (vale desde la 4). **No toca** nada del avatar, de las voces (`voces-extra.ts`, `mas-voces.tsx`, `voices-server.ts`, `piper-server.ts`, `natural-voices-card.tsx`, `/api/voces`), de la Fábrica de instaladores (tampoco el estándar de `vista-previa.html` que usa `desktop-format.ts`) ni `C:\WILLY_AVATAR`, ni `datos-privados` (incluidos `proyectos` y `voces-motores`). Lo nuevo (el mapa de pantallas) está en la regla 20.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/lib/screen-map.ts` | NUEVO | Qué pantallas tiene un proyecto (del código, de los enlaces de la página y las visitadas), cómo va de una a otra (rutas con «#», sin «#» o sin rutas), el resumen y lo que se le pide a WILLY (reparar una pantalla, pasar a rutas con «#»). | `b4ee13567d0dfed94d89d4e85b05d750c348f9e57c2f5726a02f08054cbdc306` |
| `src/components/screen-map.tsx` | NUEVO | El panel «Mapa de pantallas»: cada pantalla en pequeño (la página de verdad en su marco aislado), si se ve bien o da error, «Abrir» y «Reparar». | `d4c57f59792d0414172c6a431f94e2d37340ec9f051991a9b8c982f092b23ee8` |
| `src/lib/preview-runtime.ts` | CAMBIA | El vigía cuenta los enlaces «#/…» de la página y obedece «ir» (a otra pantalla, sin recargar). | `724d41a1fabf12edb98f6bc7d368294665ca5199b595e7162499c32ccda2fd2c` |
| `src/components/project-workshop.tsx` | CAMBIA | Botón «Pantallas» en la barra de la vista previa y el mapa; la IA sabe qué pantallas tiene la aplicación. | `cffcf972e721f21c428be424f21310c18949daecb68eb5c0d9dab04efaf876af` |
| `src/components/superia-view.tsx` | CAMBIA | Con varias pantallas, las IA usan rutas con «#» (para poder abrir cada una en la vista previa y en el mapa). | `8cee20c3a15b5ca10473409dc24c9790f68921f38f4876c3322c471a2189c0e3` |
| `src/lib/system-project.ts` | CAMBIA | SÚPER IA: el mapa de pantallas, hecho en la revisión 26. | `a9eaf53d9568ea86a4a2637e66cb0225a49e2b4923a958d9e80ef66fa3735710` |
| `src/components/app-sections.tsx` | CAMBIA | La guía «Cambiar algo tocándolo en la vista previa» explica el mapa de pantallas. | `2066e0b0d5f8f9feace5c1812ef231711e6f3608cc45b448bfda8eea4b2d7a29` |
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 25 → 26. | `83ef18423e70064dcad6a21817e6f7e054635748e23014e918cc1f204340d6ed` |
| `COORDINACION-IAS.md` | CAMBIA | Regla 20 y este informe. | — |

Si «AVATAR AI» necesita cambiar alguno de estos archivos, que lo pida como dice la regla 7.

## Revisión 27 — INFORME PARA AVATAR AI Y WILLY AI FRONT

Hecha por «WILLY AI» sobre la revisión 26 (vale desde la 4). **No toca** nada del avatar, de las voces (`voces-extra.ts`, `mas-voces.tsx`, `voices-server.ts`, `piper-server.ts`, `natural-voices-card.tsx`, `/api/voces`), de la Fábrica de instaladores (tampoco el estándar de `vista-previa.html` que usa `desktop-format.ts`), ni `C:\WILLY_AVATAR`, ni `datos-privados`, ni nada de «WILLY AI FRONT» (`src/front/**`, `src/styles.css`, `src/components/ui/**`, los dos hooks, `public/`, su enganche en `app.tsx`). Desde la 26 solo escribe los archivos de esta tabla (regla 23). Lo nuevo (las librerías de los proyectos) está en la regla 24.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/lib/semver-lite.ts` | NUEVO | Las versiones como npm (rangos ^, ~, x, guiones, ||, prerelease): qué versión se instala. | `3cdcfeef454ee8855cc708ee25dac032ebf214f62fed8d66ef709de777682afd` |
| `src/lib/project-libraries.ts` | NUEVO | Lo que comparten pantalla y servidor: nombres válidos, qué pide el package.json, qué se puede instalar solo y cómo se cuenta. | `6c442f679cfdfa360a0a3be5442c50d5a5d6d7392e2c20fd1dd3ca960980d169` |
| `src/lib/package-store-server.ts` | NUEVO | El instalador sin npm: registro de npm (y su espejo), colocación como npm, huella sha512, sin ejecutar nada, sin dejar nada a medias; quitar sin romper lo compartido. | `713377652464dae8989b3c860b7f634a9b517ab2a727e82198fd3321b8a061bf` |
| `src/components/project-libraries.tsx` | NUEVO | El aviso de «faltan librerías» (se instalan solas o con «Instalar») y «Librerías instaladas» con «Quitar». | `9b3e2a625e067c377dd063c604ac859ceed3394c96f329fe39fc5d79ed62a5fa` |
| `src/lib/project-compile.ts` | CAMBIA | Las reglas para la IA con las librerías instaladas y cómo pedir otra (declarándola en package.json). | `eb34d2f8465ac4cc0b898af2ac694cd0311b432f66e2b64c8dcd4db4279eb1ce` |
| `src/lib/project-compile-server.ts` | CAMBIA | La compilación usa el almacén de librerías (y se entera cuando se instala o se quita algo). | `40887cdb6cf0f1259f5b80cbda22fa94fd90e1af40c14bf049627ebe973e067b` |
| `src/lib/project-compile-ts.ts` | CAMBIA | El motor propio entiende las importaciones internas de las librerías («#…», campo «imports»). | `43888a780eacf66b95f4671cadce2c1abd8f5cc0febb867f7de06e0cdf19ebf9` |
| `src/lib/project-api-server.ts` | CAMBIA | `/api/proyectos`: las acciones de las librerías. | `e7fac25d6c40da46c8febc23a5af7700df8f798b30098b73011a6564ae95fef4` |
| `src/services/disk-project-service.ts` | CAMBIA | Las llamadas de la pantalla a esas acciones. | `134ae7d0d5d8277e883688e389a0cf74a79081807e3e11d29fe6ff83919d06aa` |
| `src/components/project-workshop.tsx` | CAMBIA | El taller: instala solas las que faltan (la vista previa espera y la reparación automática también) y vuelve a compilar. | `5c512f98a8eefa82c75218fb8b28d807a11ef55d432f20168c13393133758aca` |
| `src/components/superia-view.tsx` | CAMBIA | Las IA de SUPER WILLY saben qué librerías hay instaladas. | `af48c04c0c749cd8a8ef62c4fabcf8b51feb07e9495592ebd0628787de791d36` |
| `src/lib/maintenance-server.ts` | CAMBIA | Ajustes → Almacenamiento cuenta lo que ocupan las librerías de los proyectos. | `68a4b41889f672ce6d9f0083d3f5d492d0397075faf7f0745908c93d1c9419cc` |
| `src/components/app-sections.tsx` | CAMBIA | La guía de SUPER WILLY explica lo de las librerías. | `9beeebc10b9aec563f3d2220456523e47e0a853e2a4a19abaaf7ecdfe333cb5c` |
| `src/lib/system-project.ts` | CAMBIA | SÚPER IA: «Instalar librerías nuevas» hecho en la revisión 27. | `ca310c3cec5c29914d1e06718a86790be3af7224f0546e606996c8d74f560405` |
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 26 → 27. | `be76d3175d06618541a21e53e218b0b3d43d7be4618084151bc81c87abe853e6` |
| `COORDINACION-IAS.md` | CAMBIA | La fila de «WILLY AI FRONT», las reglas 22 a 23 y este informe. | — |

Si «AVATAR AI» o «WILLY AI FRONT» necesitan cambiar alguno de estos archivos, que lo pidan como dice la regla 7.

## Revisión 28 — INFORME PARA AVATAR AI Y WILLY AI FRONT

Hecha por «WILLY AI» sobre la revisión 27 (vale desde la 4). **No toca** nada del avatar, de las voces (`voces-extra.ts`, `mas-voces.tsx`, `voices-server.ts`, `piper-server.ts`, `natural-voices-card.tsx`, `/api/voces`), de la Fábrica de instaladores (tampoco el estándar de `vista-previa.html` que usa `desktop-format.ts`), ni `C:\WILLY_AVATAR`, ni `datos-privados`, ni nada de «WILLY AI FRONT» (`src/front/**`, `src/styles.css`, `src/components/ui/**`, los dos hooks, `public/`, su enganche en `app.tsx`). Desde la 27 solo escribe los 16 archivos de esta tabla (regla 22). Lo nuevo (las pruebas automáticas de cada proyecto) está en la regla 25.

Huellas SHA-256 (del archivo con saltos de línea LF, como las calcula el actualizador):

| Archivo | | Qué | SHA-256 |
|---|---|---|---|
| `src/components/project-tests.tsx` | NUEVO | El botón y el panel «Pruebas» del taller (y que se pasen solas después de cada cambio). | `2efaf7fa442b9408b02b410f8fc4c01147c2ea9b12fbb5ae066a8b0c828ceac9` |
| `src/lib/project-tests.ts` | NUEVO | Qué archivos son pruebas, cómo se preparan, a qué página va cada «goto», cómo se cuentan y se explican, qué se le pide a la IA y la reparación automática. | `6ddc216604d70542fe0939e78887d89f7fc3a888dfc242382fbff8988ed4d435` |
| `src/lib/test-agent.ts` | NUEVO | El probador que va dentro de la página: busca como Playwright (getByRole, getByText…), pulsa, escribe… con el foco «de mentira». | `4d4cb795ff5015f343b5e4e1f1f06a02093c41364634b27585afcc189d9645c3` |
| `src/lib/test-runner.ts` | NUEVO | El pasador (una versión pequeña de Playwright: test, expect, page, locator…) que corre en un marco aislado y sin red. | `84746cd0f7e612a9e2159908745549f0c1df0fa469ac1331d8b24f38d025702d` |
| `src/lib/test-session.ts` | NUEVO | Una pasada: junta el pasador, la página y WILLY (sin que se vea ni se lleve el foco). | `6d115dcea661a416d724b45b4fee5f02cd315baf78822541d2f696a28af505d0` |
| `src/components/app-sections.tsx` | CAMBIA | La guía: «Pruebas automáticas». | `c458072c3e9ba9dfef021626ee72350539a81f8aae2f3e8d0780bbb498babf3d` |
| `src/components/project-workshop.tsx` | CAMBIA | El taller: botón y panel «Pruebas», consola, lo que ve la IA; dos propiedades nuevas opcionales. | `9ea80087d5b9136c79fdff8c486fa510e12549c5f00263b532146b9e2a7488d1` |
| `src/components/projects-view.tsx` | CAMBIA | Proyectos: el progreso de cada proyecto dice cómo van sus pruebas. | `a0a4c7415a3765dfd0cad767790a9e19b51510e7191c758e405c9a2d69d3013e` |
| `src/components/superia-view.tsx` | CAMBIA | Las reglas de las pruebas para la IA, la reparación automática si un cambio las rompe y la línea «🧪 Pruebas» bajo la respuesta. | `f6f87fea18def87fbdeed6203a9312fbd1304dae27b58af6f093adb47bb1890d` |
| `src/lib/project-api-server.ts` | CAMBIA | `/api/proyectos`: la acción `transpilarPruebas`. | `a2d073ad84307430a6298099fb13a0c7abece766e224d7a85e74426a310461ca` |
| `src/lib/project-compile-server.ts` | CAMBIA | `transpileTestFiles`: pruebas en TypeScript sin tipos, con el TypeScript de WILLY (no ejecuta nada). | `a6dcb55a26fed989b5b9b01366ad5dbdf0b351c70379fbdfb81e89d49c66c624` |
| `src/lib/project-plan-sync.ts` | CAMBIA | `recordTests` y `recordFilesKey`: la pasada y la huella de los archivos, al plan del proyecto. | `33ae2576c71e31eba51795ceb53626ba52b1d4040ee72a107808659b9de33bb8` |
| `src/lib/project-progress.ts` | CAMBIA | La evidencia de las pruebas en el plan; «Funciones principales probadas» se comprueba sola; el 100 % exige que pasen. | `9dcca84d37e197256e3b227082241aaf2a5de2e66b08f940b2bd7a77baa50fec` |
| `src/lib/system-project.ts` | CAMBIA | SÚPER IA: «Pruebas automáticas de cada proyecto» hecho en la revisión 28 (y su evidencia de pruebas). | `692deac3343f73d0b1f4fe2aa6f0be6aef436b433efc43cd0dde9601d36aef88` |
| `src/lib/version.ts` | CAMBIA | `APP_REVISION` 27 → 28. | `e78853961e5e022b3ef4f95fb7df517f6fd766643ae8d8ff0bae34f877974e31` |
| `src/services/disk-project-service.ts` | CAMBIA | La llamada de la pantalla a esa acción. | `6876ef2f0af882b3975d2732f30a6ebce069af913518a304e2ccceb14f55d9aa` |
| `COORDINACION-IAS.md` | CAMBIA | La regla 25 y este informe. | — |

Si «AVATAR AI» o «WILLY AI FRONT» necesitan cambiar alguno de estos archivos, que lo pidan como dice la regla 7.

---

## TRASPASO A WILLY AI (de «AVATAR AI», 24/09/2026 ~15:15 UTC)

Por decisión del dueño, desde ahora todo lo lleva la conversación «WILLY AI». «AVATAR AI» deja de tocar el equipo. En el equipo no queda nada a medias. No hay ninguna operación de Autoconstrucción abierta por «AVATAR AI» (`self-status` → recuperación «nada»). No dejé nada en marcha en el navegador. El único archivo de prueba que creé (`.output/public/downloads/prueba-avatar.txt`) ya está borrado.

### Hecho e instalado (de «AVATAR AI»)
- **Mi yo en IA** (23/09). Archivos:
  - `avatar-view.tsx`: 4 pestañas (Tu perfil, Escribir como tú, Crear vídeo, Ajustes).
  - `avatar-studio.tsx`: Crear vídeo en 4 pasos con la lista de lo que falta.
  - `avatar-server.ts`, `avatar-engines.ts`, `comfy-server.ts`, `comfy-install.ts`, `routes/api/avatar.ts`.
  - LivePortrait + Wav2Lip sobre ComfyUI en `C:\WILLY_AVATAR`, con la GTX 1660 Ti de 6 GB.
- **Voces, tandas 1 y 2**, en «rev 18 · local 4» (las rev 26, 27 y 28 no las tocan):
  - Piper: Davefx, Sharvard (hombre y mujer) y Carlfm.
  - Gemini TTS (funciona de verdad) y Kokoro (funciona con el procesador; por DirectML falla en la 1660 Ti y vuelve sola al procesador).
  - ElevenLabs y Chirp 3 HD, solo con clave del dueño; Chirp además necesita facturación en Google Cloud.
  - Archivos: `voces-extra.ts`, `voices-server.ts`, `piper-server.ts`, `mas-voces.tsx`, `natural-voices-card.tsx`, `routes/api/voces.ts`.
  - La voz activa ya es `gemini:Sulafat`. Kokoro y Piper siguen instalados.
- **Fábrica de instaladores** (rev 14): réplicas de programas Windows con NSIS. Falta verificarla en Windows real con el programa de muestra.

### Preparado y SIN instalar: voces, tanda 3
Está en `C:\WILLY_AVATAR\voces-tanda3\`:
- `ACTUALIZAR_VOCES_WILLY.bat` (versión 2; sha256 empieza por `3866a004f22f11ef`). Se ejecuta con doble clic con WILLY abierto y deja el informe en `C:\WILLY_AVATAR\informe-voces.txt`.
- `traspaso-voces-tanda3.md`: qué hace, las huellas esperadas, los pasos a mano y las dos cargas (A y B) en gzip+base64 para `POST /api/self-build`.

Qué hace:
1. **Operación A.** Archivos nuevos `src/lib/voz-limpia.ts` (`cleanForSpeech`: ninguna voz lee asteriscos, almohadillas, enlaces, código ni emojis) y `src/lib/voces-chatterbox.ts` (Chatterbox, la voz local de España, con sitio en la gráfica frente a Ollama y ComfyUI). Además, 43 parches exactos en `voces-extra.ts`, `voices-server.ts`, `avatar-server.ts`, `routes/api/voces.ts`, `mas-voces.tsx` y `natural-voices-card.tsx`: modo `onlyNatural`, acción `only-natural`, voces de reserva y el botón «Volver a mostrar las voces básicas».
2. **Operación B (opcional).** 3 parches en `src/lib/natural-voice.ts`, que limpian el texto también en el navegador.
3. Después:
   - `cb-install` (descarga ≈ 6 GB);
   - `set-voice gemini:Sulafat`;
   - `only-natural`, que borra Piper y, solo si Chatterbox quedó lista, también Kokoro (el dueño lo autorizó expresamente);
   - una prueba de `speak` con Markdown.

Comprobado a las 15:10 UTC de hoy sobre el equipo (rev 28 instalada, salud PASS): las 7 huellas coinciden con las esperadas y `voz-limpia.ts` / `voces-chatterbox.ts` no existen, así que el `.bat` v2 se aplicaría limpio. El intento de las 12:43 (v1) se paró sin tocar nada por una huella antigua de `natural-voices-card.tsx`, ya corregida en la v2.

Pruebas pasadas fuera del equipo:
- `tsc` sin errores (librerías e interfaz);
- 98 pruebas automáticas: limpieza 20, Chatterbox 47 y «solo naturales» 31;
- ensayo completo del `.bat` contra un WILLY simulado, que deja los 9 archivos idénticos a los probados.

**Si alguna revisión futura toca un archivo de voz antes de instalar esto, el `.bat` se para sin cambiar nada y dice cuál. En ese caso hay que regenerar los parches sobre el archivo nuevo.** Una vez instalado, cualquier paquete posterior debe conservar esas versiones. Huellas tras la tanda 3 (LF, primeros 8 caracteres):

| Archivo | Huella |
|---|---|
| `voces-extra.ts` | aa14380b |
| `voices-server.ts` | a3bcf49e |
| `avatar-server.ts` | cb58255d |
| `routes/api/voces.ts` | 0e3f5f7c |
| `mas-voces.tsx` | 1674a265 |
| `natural-voices-card.tsx` | 64854857 |
| `natural-voice.ts` | 18e85eea |
| `voces-chatterbox.ts` | 71d4a9a6 |
| `voz-limpia.ts` | e560edc5 |

### Falta (de lo que era de «AVATAR AI»)
- Instalar la tanda 3 (arriba) y confirmar con el dueño que ya no se leen los símbolos.
- Centro de Inteligencia: mostrar el estado de los motores del avatar (`/api/avatar status`) y de las voces (`/api/voces status` → `extra`), leyéndolo de esos servicios.
- Herramientas: la entrada «Mi voz» (Chatterbox) cuando la tanda 3 esté instalada.
- Conversión decidida de «Mi yo en IA» en «IA Influencer + Creative Studio», con asistente guiado de personaje. Antes hay que hacer el inventario real de `C:\WILLY_AVATAR` (modelos en `ComfyUI/models`, `Personajes/Laura`). Hoy no hay código de identidades ni de generación de imagen.
- Video Dubbing Studio: sigue en cola, solo especificado.
- Verificar la fábrica de instaladores en Windows real.

### Decisiones pendientes del dueño
- Permiso para borrar la instalación duplicada de ComfyUI: `C:\ComfyUI` frente a `C:\WILLY_AVATAR\ComfyUI`, que usan el mismo puerto 8188 y no deben arrancar a la vez.
- Qué abre «Vídeo IA» en Inicio y Herramientas: Traducir, un centro de vídeo que reúna Traducir + Mi yo en IA + Dubbing Studio, u otra cosa.

---
## TRASPASO A WILLY AI (24/09/2026, desde «WILLY AI FRONT»)

El dueño decidió que a partir de ahora lleva todo la conversación «WILLY AI». FRONT deja de trabajar de forma autónoma a partir de este traspaso. Nada quedó a medias en el equipo: el puente con el PC estuvo caído desde ~13:50 UTC hasta el momento de este traspaso, así que FRONT no llegó a enviar ningún `/api/self-build` en todo este tramo.

### Lo que está hecho y verificado en vivo
- Armazón nuevo (rev 26 · local 1): `src/front/shell.tsx`, `inicio.tsx`, `chats.tsx`, `status.ts`, `mascot.tsx`, `chat-handoff.ts`, `chat-meta.ts`, `src/styles.css`, enganche en `src/routes/app.tsx`, fuentes Manrope en `public/fonts`.
- Refinamiento visual de Chat (rev 27 · local 2): icono de cabecera dinámico por etiqueta + render markdown-ligero en `src/components/answer-body.tsx` (archivo compartido, se tocó con parche).
- Herramientas / Tool Center (rev 27 · local 1).
- Centro de Inteligencia: YA ESTABA CONSTRUIDO desde antes de este tramo (se autodenomina "revisión 20" en su cabecera) — `src/components/intelligence-center.tsx`, 4 pestañas reales con datos reales (Tu equipo/Ollama, IA externas, Modelos, Agentes), enlazado en el armazón y en `model-picker.tsx`. Verificado en vivo con capturas.

### Lo que falta (pantallas del rediseño)
- 3 arreglos pequeños ya especificados, sin código escrito todavía: en Chats "IA IA externa" → "IA externa"; en Inicio "Fase actual" solo cuando hay plan (si no, "Sin plan todavía" + "Analizar proyecto"); en Herramientas, comprobar/conectar las 4 entradas confirmadas por AVATAR AI (Leer en voz alta→`speakBest`, Voces→`NaturalVoicesCard`, Vídeo con tu cara→`AvatarView`/Crear vídeo, Escribir como tú→`AvatarView`/Escribir).
- Pantalla Proyectos (nueva, reutilizando rev19: `project-store-server.ts`, `/api/proyectos`, `disk-project-service.ts`).
- Súper IA / Project Command Center (envolver `superia-view.tsx` + taller de proyecto en pestañas).
- Autoconstrucción con las pestañas de la maqueta sobre las acciones reales existentes.
- Responsive (cajón lateral + navegación inferior) y retirada de la interfaz clásica cuando todo lo anterior esté hecho.
- Extraer `ChatPanel` a `src/components/chat-panel.tsx` (pedido repetidamente a «WILLY AI», nunca implementado).
- Migrar `chat-meta.ts` (localStorage) a campos `favorite`/`tag` de `chat-history.ts` (necesita que WILLY AI añada esos campos primero).
- Añadir al Centro de Inteligencia el estado de los motores de avatar/voces (leyendo `/api/avatar status` y `/api/voces status`, sin mover lógica).
- Localizar dónde quedó `project-progress` (se especificó pero no aparece en los despliegues listados) y dejarlo en `src/lib`.
- Backend: unificar los 5 routers de IA duplicados (`engines-server.ts` PROVIDERS vs `capability-registry.ts` PROVIDERS_INFO, y los 3 órdenes de proveedores distintos) — siempre fue trabajo de «WILLY AI», nunca de FRONT.
- Petición pendiente y repetida a «WILLY AI»: acción `apply-file` en `/api/self-build` (aplicar un paquete `{name, files, patches, checks}` dejado en `intercambio-front/`, sin pasar por el navegador).

### Preparado pero NO instalado
- **Voces, tanda 3 (Chatterbox)**: es trabajo de «AVATAR AI», no de FRONT. Según lo último que FRONT sabía, los paquetes estaban listos en un documento del proyecto claude.ai llamado `claude/traspaso-voces-tanda3.md`, pendientes de desplegar sobre la base "rev 26/27 · local 1" (esa base no toca los archivos de voces). Ese documento y otros 10 del proyecto **desaparecieron del proyecto claude.ai "WILLY AI" hacia las 14:42 UTC de hoy** (causa desconocida); si «AVATAR AI» tiene el contenido en su propia memoria de conversación, debería volver a dejarlo por escrito aquí o en un documento nuevo del proyecto.
- FRONT no dejó ningún paquete a medio enviar ni ninguna operación de Autoconstrucción a medias.

### Riesgo detectado, estado sin confirmar
Hacia las 13:57 UTC de hoy, FRONT detectó que OTRA sesión (no «WILLY AI FRONT») tenía una tarea programada para instalar sola una revisión 28 (`ACTUALIZAR_WILLY_AI_0.0.43_rev28.bat`) en cuanto pudiera conectar con el PC, sin supervisión. FRONT nunca pudo confirmar si esa instalación llegó a ejecutarse (el puente estuvo caído para todos desde ese momento). **Lo primero que debería hacer «WILLY AI» al retomar es comprobar `APP_REVISION` real y, si ya está en 28, releer todo `src/front/**` y comparar huellas contra las de `claude/willy-coordinacion-cambios-en-equipo.md`** (documento del proyecto claude.ai) antes de dar nada por supuesto.

### Decisiones pendientes del dueño (recopiladas por FRONT, ninguna inventada)
1. Centro de Inteligencia: ¿se queda con las 4 pestañas actuales (Tu equipo/IA externas/Modelos/Agentes) o se reorganiza a las 7 de la especificación (RESUMEN/ESPECIALISTAS/MODELOS/PROVEEDORES Y APIs/ROUTING/RENDIMIENTO/AVANZADO)?
2. Agentes: ¿se muestran los 5 fijos que existen (Analyst/Programmer/Tester/Debugger/Designer), o se amplía a los 6 de la maqueta o a los 10 de la especificación?
3. Súper IA: ¿qué deben hacer exactamente los botones "Deploy" y "Compartir"? (hoy "Deploy" solo empaqueta un ZIP, "Compartir" no existe)
4. Autoconstrucción: "Visión", "Roadmap de WILLY" y "Módulos" no existen como datos hoy — ¿de dónde deberían salir?
5. Chats: las etiquetas (Ideas/General/Trabajo) ¿las pone WILLY automáticamente o siguen siendo manuales?
6. Inicio > "Vídeo IA": ¿abre Traducir (lo único que ya funciona), un centro de vídeo nuevo que reúna Traducir + Mi yo en IA + futuro Dubbing Studio, u otra cosa?
7. Mascota de Inicio/Chats: sigue con el SVG provisional (`src/front/mascot.tsx`) salvo que el dueño dé un archivo de ilustración.
8. (Ya decidida, no repreguntar) "IA Influencer": conversión de "Mi yo en IA" en "IA Influencer + Creative Studio" con asistente guiado de personaje.

Fin del traspaso. «WILLY AI FRONT» no toca nada más a partir de aquí.

---
## MAQUETAS DEL DUEÑO RECIBIDAS (24/09/2026, en la conversación «WILLY AI» que ahora lleva todo)

Antonio ha adjuntado 5 imágenes con las maquetas reales del rediseño, guardadas en
`maquetas-dueno/` (misma carpeta que este archivo): 01-resumen-7-pantallas.png,
02-inicio-chat-superia-herramientas.png, 03-centro-inteligencia.png, 04-chats.png,
05-inicio-completo.png. Esto resuelve el bloqueo "no tengo las maquetas" señalado en el
traspaso de FRONT del 24/09.

### Lo que las maquetas confirman (decisiones antes pendientes del dueño)

1. **Centro de Inteligencia**: 6 pestañas, no 4 ni las 7 de la especificación original:
   `Resumen · Modelos · Proveedores · Agentes · Routing · Uso y costes`. La pestaña
   "Resumen" reúne: Modo actual, Proveedores activos, Modelos locales, Salud general
   (4 tarjetas arriba), Enrutado inteligente (con las 5 etapas: Chat general → Súper IA →
   Herramientas → Traducción → Código), Proveedores y APIs (tarjetas con estado y botón
   Probar/Configurar), Salud y diagnóstico (con botón "Ejecutar diagnóstico" y "Ver logs"),
   Preferencias globales (toggles), Capacidades por tarea, Agentes y especialistas
   (resumen), Modelos en uso reciente (tabla).
2. **Agentes**: la maqueta muestra al menos 6 tarjetas en "Agentes y especialistas":
   Arquitecto (Diseño y planificación), Programador (Código y depuración), Diseñador UI
   (Interfaces y UX), y al menos 3 más recortadas en la imagen (Analista, Revisor,
   Orquestador aparecen en la vista de Súper IA / Autoconstrucción — confirmar los
   nombres exactos ampliando la imagen si hace falta). Se descarta la opción de 5 fijos
   o de 10: la maqueta muestra 6.
3. **Súper IA**: cabecera con selector de proyecto, estado "En desarrollo", y botones
   `Ejecutar` · `Deploy` · `Compartir` · menú "···" — los tres son acciones reales de
   primer nivel, no solo Deploy. Pestañas internas del taller: `Chat del proyecto / Vista
   previa · Código · Archivos · Cambios · Consola · Versiones`, con la vista previa
   embebida en un iframe con barra de URL simulada y botón "Abrir en pantalla completa".
4. **Autoconstrucción**: pestañas confirmadas: `Visión · Roadmap · Módulos · Tareas ·
   Cambios · Versión · Logs`, con un roadmap visual tipo lista de nodos (Project Command
   Center 78%, Visual Element Selection 45%, Test Center 62%, Centro de Inteligencia v2
   38%) y un botón "+ Nueva mejora".
5. **Proyectos**: pantalla con buscador, filtro "Actividad reciente", tarjeta "SISTEMA
   WILLY" fija arriba (con "Fase: Project Command Center", 78%) y el resto de proyectos
   en tarjetas de cuadrícula con barra de progreso, fase actual y "hace X".
6. **Herramientas**: confirma exactamente las 4 entradas ya verificadas en
   `tools-registry.ts` (Traducir, OCR, IA Influencer, Video IA como favoritas) más
   categorías: Documentos y texto, Traducción, Imagen, Video, Audio y voz, Creación IA,
   Datos y web, Desarrollo, Automatización.
7. **Mascota**: la maqueta trae ilustración propia — un robot azul con auriculares/visor
   morado, estilo flat/3D suave, usado en Inicio (grande, con globo de diálogo "Tus
   ideas, mis herramientas, sin límites.") y en Chats (pequeño, cabecera). **Hay que
   pedir a Antonio el archivo de la ilustración en sí (SVG/PNG) — en la maqueta solo se
   ve renderizada dentro del diseño**, no viene como asset aparte.
8. **Chats**: etiquetas de color por chat visibles como pastillas (Ideas=naranja,
   General=azul/gris, Trabajo=morado) asignadas por chat en la lista, con filtros
   `Todos · Recientes · Favoritos` arriba. No se ve en la maqueta si la etiqueta la pone
   WILLY solo o el dueño a mano — sigue siendo una decisión de comportamiento, no de
   diseño.
9. **Inicio**: confirma el diseño ya implementado en `src/front/inicio.tsx`
   (Continúa donde lo dejaste / Necesita tu atención / WILLY está trabajando / Proyectos
   recientes / Herramientas rápidas), con el añadido de una tarjeta "Actividad reciente"
   a la derecha que hoy no existe en el código.

### Siguiente paso
WILLY AI (ahora conversación única) implementa estas pantallas siguiendo estrictamente
estas maquetas, reutilizando todo el código ya existente en `src/front/**`,
`intelligence-center.tsx`, `superia-view.tsx`, `projects-view.tsx` y `app-sections.tsx`
antes de escribir nada nuevo. Sigue pendiente pedir al dueño: el archivo de la mascota
(punto 7) y confirmar si las etiquetas de Chats son automáticas o manuales (punto 8).


---
## DESPLIEGUES DEL 25/09/2026 (conversación «WILLY AI», la que lleva ahora todo)

- **Voces tanda 3 INSTALADA** (0.0.43 rev 28 · local 6 y 7). Quien prepare una revisión nueva debe llevar estos archivos TAL COMO ESTÁN EN EL EQUIPO (si no, las voces vuelven a leer asteriscos y se pierde Chatterbox). Huellas (LF, 8 primeros): voces-extra.ts aa14380b · voices-server.ts a3bcf49e · avatar-server.ts cb58255d · routes/api/voces.ts 0e3f5f7c · mas-voces.tsx 1674a265 · natural-voices-card.tsx 64854857 · natural-voice.ts 18e85eea · voces-chatterbox.ts 71d4a9a6 · voz-limpia.ts e560edc5.
  - Chatterbox listo con la GTX 1660 Ti (CUDA). Voz por defecto: Gemini Sulafat. `onlyNatural` activado: Piper y Kokoro quitados (lo autorizó Antonio).
  - El paquete quedó archivado en `C:\WILLY_AVATAR\voces-tanda3\INSTALADO-2026-09-25\` (no volver a ejecutar el .bat).
- **Enrutado en un solo sitio** (local 8): `src/lib/routing-table.ts` guarda `CHAT_ORDER`, `BUILD_ORDER` y `KIND_CLOUD_ORDER`. `chat-cloud.ts`, `engine-plan.ts` (`PROVIDER_ORDER = BUILD_ORDER`) y `auto-engine.ts` los reexportan con su nombre de siempre. Si hay que cambiar un orden, se cambia SOLO en routing-table.ts.
- **Centro de Inteligencia → Routing** (local 9): 6.ª pestaña de la maqueta, con la tabla real, «ahora mismo» según el estado de cada IA externa, capacidades por tarea (principal, respaldo y modelo de tu equipo) y las preferencias que existen de verdad (interruptor de IA externas y calidad/ahorro); las reglas fijas se enseñan como tales. La fila «Motor de voces» del Resumen enseña ahora la voz activa (antes decía «Piper», que ya no existe).
- **Aviso para paquetes nuevos**: los `checks.mustContain` de `/api/self-build` se buscan en el programa COMPILADO. Nombres de variables o `export const …` no sirven (desaparecen al compilar); hay que usar textos que se vean en pantalla.
- **Chats: favoritos y etiquetas dentro de cada conversación** (local 10): `src/front/chat-meta.ts` es ahora un adaptador sobre `chat-history.ts` (`favorite`/`tag` del hilo, `updateThreadMeta`). El almacén provisional `willy-front-chat-meta` se migra una vez y se borra. No crear otro almacén para esto.
- **ChatPanel en su propio archivo** (local 11): `src/components/chat-panel.tsx` (ChatPanel, Msg, Chip, ProjectActionCard, ownerSystem, CHAT_PROMPT, INSTALLER_ASK…). `src/routes/app.tsx` solo lo importa (bajó de 1.359 a 559 líneas). Los cambios del chat van en chat-panel.tsx.
- **Autoconstrucción según la maqueta** (local 12): pestañas Visión · Roadmap · Módulos · Tareas · Cambios · Versión · Logs y botón «Nueva mejora» (la antigua «Salud» vive dentro de Visión; los enlaces a «versiones» siguen valiendo). Las vistas nuevas están en `src/components/self-build-roadmap.tsx` y leen datos reales (`systemPlan()`/`computeProgress()`, `SYSTEM_HISTORY`, diario de operaciones). La pestaña Logs reutiliza `LogsCard` de `settings-view.tsx` (ahora exportada).
- **Aviso para paquetes nuevos**: `Button` (src/components/ui/button.tsx) solo acepta `variant` = `primary`, `secondary`, `outline` o `ghost`. Con `default` falla la comprobación de tipos (así se descartó el primer intento de local 12, sin tocar nada).
- **Ollama va solo con el procesador**: en la instalación de Ollama falta `lib/ollama/cuda_v12/ggml-cuda.dll` (actualización automática a medias). El controlador de la gráfica está bien. Arreglo: cerrar WILLY y Ollama y ejecutar el instalador ya descargado (`%LOCALAPPDATA%\Ollama\updates_v2\…\OllamaSetup.exe`). Pendiente de Antonio.
- **Plan del sistema con el hito «Diseño del dueño»** (local 13): en `src/lib/system-project.ts` (PLAN.diseno) y la plantilla `sistema` de `project-progress.ts`. Las tareas hechas llevan su fecha (`"AAAA-MM-DD"` en `Item.rev`); las pendientes (`null`) son las de verdad: 6 agentes, mascota, IA Influencer/Vídeo IA. Cuando se termine una, se cambia su `null` por la fecha: el Roadmap, Módulos, Tareas y la tarjeta de SÚPER IA lo recalculan solos.
- **Mi yo en IA → Crear vídeo, «Leer un texto»** (local 14): la voz es la natural de Lectura → Voces más humanas (`naturalVoice()` en `avatar-server.ts`, campo `natural` del estado). No volver a exigir una voz de Piper: con «solo voces naturales» Piper no se usa nunca.
- **Herramientas** (local 15): «Mi voz» disponible (Chatterbox); la tarjeta «Voces» ya no nombra Piper ni Kokoro.
- **Leer en voz alta** (local 16): `speakBest` (`natural-voice.ts`) da la voz por lista si hay una voz natural (id con «proveedor:») o Piper con voces; ya no sale «Preparando la voz natural…» en cada lectura.
- **Reparación de la vista previa** (local 17): `repairHints()` en `preview-runtime.ts` añade una pista concreta para «Unexpected token '<'» (JSX sin compilar). Para otros errores repetidos, añadir la pista ahí, no en otro sitio.
- **Huellas de la tanda 3 que ya no valen**: `avatar-server.ts` (cambiado en local 14) y `natural-voice.ts` (local 16). Quien prepare una revisión nueva lleva los archivos TAL COMO ESTÁN EN EL EQUIPO.
- **Aviso para paquetes nuevos**: nada de comentarios con «…» o «...» junto a «igual que», «resto», «sin cambios» u «omitido» en la misma línea: el chequeo de código omitido de `patch-apply.ts` descarta la mejora (así cayó el primer intento de local 16).
- **Ollama**: preparado `C:\WILLY_AVATAR\INSTALAR_OLLAMA_GPU.bat` (lanza el instalador 0.34.4 ya descargado, que está completo y firmado, y comprueba `ggml-cuda.dll`). Pendiente de que Antonio lo ejecute.
- **Agentes en español** (local 18): `intelligence-center.tsx` enseña los 5 papeles de `project-work.ts` como Analista, Programador, Revisor, Depurador y Diseñador UI (`agentLabel`). Sus nombres internos NO cambian (van en las peticiones y en los ajustes guardados).
- **Transcribir audio o vídeo** (local 19): pantalla `transcribe-view.tsx` (vista `transcribir`), servidor `lib/transcribir.ts` por las acciones `stt-*` de `/api/voces`. Reutiliza el Python de Chatterbox (`cbPaths`, ahora exportado) y el ffmpeg de `findFfmpeg`; modelo `openai/whisper-large-v3-turbo` en float32. El modelo (1,6 GB) solo se baja cuando el dueño pulsa «Preparar la transcripción». No crear otro Python ni otra ruta para esto.
- **Documentación** (local 20): página «Transcribir audio o vídeo» y los agentes con sus nombres en español (lista `DOCS` de `app-sections.tsx`).
- **Súper IA: selector de proyecto** (local 21): en la cabecera del proyecto abierto, «Proyecto: «…» ▾» lista tus proyectos (sin ejemplos ni archivados) y abre otro con el mismo `openProject`; «Ver todos en Proyectos» abajo.
- **Transcribir: «Resumir en el Chat»** (local 22): usa `sendToChat` (`front/chat-handoff.ts`), deja el texto escrito sin enviarlo.
- **«Arrancar ComfyUI»** (local 23): acción `comfy-start` de `/api/avatar` (con `check: true` solo dice qué lanzador usaría). Abre `C:\WILLY_AVATAR\ARRANCAR_WILLY_AVATAR.bat` (o `run_nvidia_gpu.bat` de la portable) con `cmd /c start "ComfyUI" /min …`: queda una ventana minimizada que el dueño puede ver y cerrar. No lanzar ComfyUI oculto.
- **Aviso de fin en SUPER WILLY** (local 24): «Hecho: Cambio (con …)» en lugar de «Cambio resuelta por …» (la etiqueta puede ser masculina o femenina).
- **Estándar de código (`ai-standard.ts`, regla 10)** (local 25): «vista-previa.html» sigue siendo obligatoria, pero ahora se dice expresamente que se abre sin compilar: JavaScript normal, nada de JSX, TypeScript ni `import` de librerías desde internet (fue la causa de la vista previa rota de «Mundo jamon»). Las «Instrucciones permanentes del dueño» (`self-build-store.ts`) NO se han tocado: son suyas.
