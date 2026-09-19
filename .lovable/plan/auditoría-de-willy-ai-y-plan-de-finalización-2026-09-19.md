# Auditoría de WILLY AI y plan de finalización

## A. Estado actual (resumen honesto)

**Stack detectado:** TanStack Start 1.x + React 19 + TypeScript + Tailwind v4 + shadcn/Radix (46 componentes ya instalados) + lucide + sonner + recharts + zod + Bun. Compilación limpia, build OK. **No se migra nada:** la arquitectura es la correcta y se conserva.

**Rutas existentes:** solo dos — `/` (portada, 284 líneas) y `/app` (panel, 1.169 líneas). No hay 404 propia de sección, ni `/admin`, ni rutas por proyecto.

**Lo que ya está bien y NO se toca:**
- Portada completa (hero, precios, recursos, acceso anticipado, modales de acceso/registro, tema claro/oscuro).
- Panel `/app`: barra superior, menú lateral plegable, chat, vista previa, código abajo, terminal, 13 pantallas de sección.
- Chat conectado de verdad al motor local (streaming, estándar de calidad, extracción de archivos a Archivos/Código/Vista previa).
- Notificaciones con campana, perfil con foto, adjuntos, exportación ZIP real, GitHub con token, pantalla de instalación y lanzadores.
- Lenguaje visual (oscuro azul/violeta, Manrope/Space Grotesk): aprobado, se conserva íntegro.

## B. Problemas detectados y clasificación

**CRÍTICO**
1. No existe capa de servicios. La lógica del motor local, GitHub y proyectos está dispersa en los componentes. Sin esto, conectar un backend después obliga a reabrir la interfaz entera.
2. No existe panel de propietario (`/admin`) ni sistema de roles. Hoy cualquiera que abra la app entra al panel.
3. «Ejecutar» y «Deploy» siguen simulados con temporizadores (800 ms / 1.200 ms): son los dos únicos controles del panel que mienten al usuario.
4. Los proyectos no persisten como datos: `PROJECTS` es una lista fija en el código. No se puede crear, renombrar, duplicar ni borrar de verdad.

**ALTO**
5. Sin estados formales de acción (cargando / correcto / error / vacío) en varias pantallas; los fallos acaban en un aviso genérico.
6. Sin historial de versiones ni deshacer/rehacer de lo que genera la IA: una segunda generación pisa la anterior sin retorno.
7. `app.tsx` con 1.169 líneas mezcla ocho responsabilidades; cada cambio arriesga romper algo.
8. Sin pantallas de error dedicadas (403, 500, sin conexión) ni estado offline visible.

**MEDIO**
9. Un solo proveedor de IA cableado (compatible OpenAI). Falta la abstracción para elegir local/remoto y comprobar disponibilidad real en la pantalla de Modelos.
10. Sin búsqueda global, papelera, duplicar/renombrar proyecto ni actividad reciente real.
11. Accesibilidad parcial: faltan etiquetas en varios botones de solo icono y recorrido de teclado en los menús propios.
12. Sin pruebas automatizadas de los flujos críticos.

**BAJO**
13. Código muerto residual (listas de ejemplo `FILES`, `CODE`, `PLAN` usadas solo como relleno).
14. Pequeñas diferencias de altura/espaciado entre botones equivalentes de distintas pantallas.

**LO QUE NO RECOMIENDO AÑADIR ahora:** editor visual de arrastrar y soltar con reordenación libre de bloques, registro de componentes/páginas completo y publicación borrador/publicado. Son coherentes con la visión, pero sin proyectos persistentes ni backend detrás se convierten en maquetas vacías. Se dejan preparados, no construidos.

## C. Plan de implementación (orden exacto, por bloques validados)

**Bloque 1 — Capa de servicios y tipos** (base de todo lo demás)
`src/services/` con contratos claros: `ProjectService`, `AIService` (con `AIProvider`: local compatible-OpenAI y hueco para remoto), `FileService`, `GitHubService`, `SettingsService`, `AuthService`. Implementación actual = adaptador local (navegador) claramente marcado, misma firma que tendrá el backend. Tipos y validación con zod en `src/types/`.

**Bloque 2 — Proyectos reales**
Crear, abrir, renombrar, duplicar, exportar, archivar y eliminar con papelera y restauración, persistido en el equipo a través de `ProjectService`. Las pantallas existentes se conectan; su diseño no cambia.

**Bloque 3 — Ejecutar y Desplegar reales**
«Ejecutar» pasa a validar de verdad el código generado y mostrar los errores en la terminal. «Deploy» genera el paquete real descargable (ya tenemos ZIP) y registra el resultado. Se elimina todo temporizador simulado.

**Bloque 4 — Historial, versiones y deshacer**
Cada generación crea una versión con fecha y resumen; se puede comparar, restaurar y deshacer/rehacer. Pantalla de Historial en el menú, con el mismo lenguaje visual.

**Bloque 5 — Estados, errores y pantallas que faltan**
Estados de carga, vacío y error unificados; límite de error con reintento; pantallas 403, 500, sin conexión y mantenimiento; aviso de conexión perdida con el motor local.

**Bloque 6 — Panel de propietario `/admin`**
Ruta protegida con rol de propietario a través de `AuthService` (frontend oculta, backend autorizará; se deja el punto de verificación listo y documentado). Dentro: apariencia (colores, tipografía, radios, espaciado sobre los tokens existentes), contenido de la portada, marca (logo, favicon, nombre), interruptores de funciones y diagnóstico técnico. Los cambios se ven al instante y se guardan por versiones.

**Bloque 7 — Modelos y proveedores**
Pantalla de Modelos comprobando disponibilidad real contra el motor configurado, con estado local/remoto y error de conexión visible. Nada de disponibilidad inventada.

**Bloque 8 — Limpieza, accesibilidad, responsive y pruebas**
Dividir `app.tsx` en piezas por zona sin cambiar un píxel; etiquetas y teclado; revisión en 320, 375, 390, 430, 768, 1024, 1280, 1440 y 1920; pruebas automatizadas de los flujos críticos; eliminar código muerto verificando referencias.

Cada bloque: modificar → comprobar tipos → compilar → probar en el navegador → comparar visualmente → continuar. Nada de refactorizaciones masivas sin validar.

## D. Detalles técnicos
- Se conserva TanStack Start; nuevas rutas como archivos en `src/routes` (`/admin`, `/app` sin cambios de ruta).
- Sin dependencias nuevas: shadcn/Radix, zod, sonner y recharts ya cubren todo lo previsto.
- Persistencia actual en el navegador tras los servicios; sustituirla por backend será cambiar la implementación del servicio, no la interfaz.
- Interruptores de funciones para lo experimental (editor visual, borrador/publicado).

## E. Antes de empezar
Este plan cubre 8 bloques y es trabajo extenso. Puedo ejecutarlo entero seguido, o parar tras cada bloque para que lo revises.
