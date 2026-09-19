# WILLY AI 0.0.3: funcionamiento local, autoconstrucción y entrega

## Objetivo
Entregar una nueva versión instalable de Windows que trabaje únicamente con servicios del propio ordenador, conserve las instrucciones completas de WILLY y permita mejorar la IA local desde una pantalla propia. Preparar también una copia del repositorio en ZIP.

## Cambios
1. **Funcionamiento completamente local**
   - Eliminar la dirección fija de la vista previa y cualquier relevo automático hacia una IA externa.
   - Fijar WILLY en `localhost:3000`, el motor local en `localhost:11434` y el servidor de datos local en `localhost:4000`.
   - Corregir los textos y acciones de Workspace que todavía muestran el puerto de desarrollo antiguo.

2. **Descarga de modelos**
   - Hacer que la aplicación instalada gestione descargas mediante su propio servidor local, evitando bloqueos del navegador.
   - Mantener progreso, cancelación, selección y borrado de modelos.
   - Mostrar mensajes claros si Ollama aún no está disponible.

3. **Pestaña Autoconstrucción**
   - Añadir una pantalla separada de los proyectos para mejorar exclusivamente WILLY y su IA local.
   - Incorporar instrucciones permanentes del dueño, memoria de mejoras, propuestas, revisión, copia de seguridad previa y aplicación controlada.
   - Impedir que una mejora se confunda con el código de los proyectos y conservar las reglas de no romper lo existente.

4. **Versiones y actualizaciones**
   - Publicar esta entrega como **v0.0.3** (posterior a v0.0.2).
   - Mostrar la versión instalada y añadir una pantalla para buscar e instalar actualizaciones locales desde un archivo `.exe`, manteniendo copia de seguridad.
   - Ajustar el instalador de un solo archivo para actualización sobre instalaciones anteriores.

5. **Entregables y validación**
   - Validar navegación, Autoconstrucción y Modelos en escritorio y móvil.
   - Comprobar compilación y arranque local en `localhost:3000`.
   - Generar un único instalador `.exe` y un ZIP limpio del repositorio, sin dependencias ni archivos temporales.

## Límite importante
La IA podrá mejorar sus instrucciones, memoria, catálogo y archivos de configuración de forma controlada. Los cambios al programa instalado se aplicarán mediante una actualización versionada, con copia de seguridad previa; no se sobrescribirá a sí mismo mientras está ejecutándose.
