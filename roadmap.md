# Roadmap

- [x] Añadir registro, recuperación de contraseña y enlaces funcionales que faltan.
- [x] Añadir selector de tema claro y oscuro a la portada.
- [x] Validar en ordenador y móvil y actualizar el ZIP de la portada.
- [x] Sustituir la cuadrícula por un fondo profesional propio, sin usar las tres propuestas descartadas.
- [x] Adaptar y validar la portada en móviles, tabletas, iOS y Windows.
- [x] Equilibrar visualmente toda la portada y actualizar su ZIP.
- [x] Construir, validar y exportar el panel principal interior (willy-ai-panel.zip).
- [x] Hacer funcionales todos los botones del menú con sus pantallas (Inicio, Proyectos, Workspace, Agentes, Modelos, Herramientas, Documentación, Configuración, cuenta, estado) y el modal de Nuevo proyecto; entregar ZIP.
- [x] Plegar menú lateral y chat para dar espacio a la vista previa; código y terminal abajo al pulsar su pestaña; sub-pestañas de nuevo diseño; todos los botones del panel funcionales (willy-ai-panel-plegable.zip).
- [x] Llegar al 100% funcional fuera de la vista previa: menús de proyecto y modelo, Ejecutar, Deploy, Compartir, chat con búsqueda/export/comparación/chips, Workspace con acciones reales, Configuración persistente con prueba de conexión, Cuenta con copia de seguridad y cierre de sesión, Documentación con guías reales, WorkPanel con historial atrás/adelante, pantalla completa y selección de elemento.
- [x] Conectar el chat al motor de IA local (Ollama/Forge/LM Studio): streaming en vivo, estándar de calidad de código, extracción de archivos a Archivos/Código/vista previa y modo demostración si el motor no responde. Queda pendiente "Ejecutar" y "Deploy" reales.
- [x] Garantizar vista previa responsive y simétrica siempre: el estándar de calidad enviado al motor local exige responsive 320-2560px, simetría y botones 100% funcionales; guard de CSS inyectado en todo HTML mostrado y lienzo nuevo fluido (verificado en escritorio y móvil).
- [x] Sistema de notificaciones: campana junto al selector de tema con contador de no leídas, panel de avisos (marcar leídos, descartar, vaciar), avisos de cada paso completado con sonido opcional, y ajustes en Configuración (activar/desactivar, pasos, sonido) persistidos en el equipo.

- [x] Exportar el código real en ZIP desde «Más opciones» y conexión con GitHub (token personal, subir código a un repositorio).
- [x] Instalación como aplicación: PWA (manifest + service worker + iconos propios) y lanzadores para Windows, macOS y Linux en la pantalla «Acceso directo»; conectada al menú lateral junto a GitHub.
- [x] Bloque 1: capa de servicios y tipos (proyectos, auth, archivos, IA, tema, flags) con adaptadores locales marcados como temporales.
- [x] Bloque 2: proyectos reales (crear, abrir, renombrar, duplicar, estado, papelera, restaurar, eliminar), recientes reales, historial de versiones con restauración.
- [x] Bloque 3: Ejecutar valida el código generado de verdad y Deploy empaqueta y descarga el ZIP real (ya no hay temporizadores simulados).
- [x] Bloque 4: demo para cliente con un botón (informe con avance diario y mensual, abrir/descargar HTML/PDF), pantallas de error (403, 404, 500, sin conexión) en español, panel de administrador /admin con acceso restringido, y modelos con disponibilidad real comprobada contra el motor local.
- [x] Bloque 5: pestañas nuevas 100% funcionales — Lectura en voz alta de PDF con 8 voces españolas naturales (4 mujer, 4 hombre), OCR de documentos (imagen/PDF escaneado), Mi yo en IA (foto, vídeo de referencia, perfiles y generación de contenido), Traducir enlace/documento/texto a 11 idiomas, y Nuevas funciones (crear herramientas propias sin programar). Micrófono de dictado solo icono a la derecha en Súper IA; eliminado «Traducir PDF al español». Validado: tsgo limpio, build OK, Playwright sin errores.
- [x] WILLY AI 0.0.3: funcionamiento solo local, modelos mediante servidor local, Autoconstrucción controlada, actualización e instalador/ZIP finales.
- [x] WILLY AI 0.0.4: chat limpio (la IA no habla sin que la preguntes), sin texto de ejemplo, historial de conversaciones guardado en Recientes, botón de stop junto al clip que conserva lo generado, autoconstrucción obligatoria sin excusas, y botón de descarga de modelos siempre activo + «Descargar todos» con cola; instalador 0.0.4 entregado.
