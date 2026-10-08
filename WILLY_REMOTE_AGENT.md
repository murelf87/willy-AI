# WILLY Remote Agent

WILLY Remote Agent es el agente propio de WILLY para trabajar en el ordenador sin depender de Desktop Commander.

## Seguridad por defecto

- El agente escucha únicamente en 127.0.0.1:4050.
- Cada acción sobre el equipo requiere aprobación explícita en WILLY > Equipo remoto.
- Las solicitudes y ejecuciones se registran en datos-privados/willy-agent/audit.jsonl.
- Desktop Commander se conserva solo como compatibilidad opcional.
- El agente no publica el PC en Internet por sí mismo.

## Endpoint MCP

Endpoint local:

    http://127.0.0.1:4050/mcp

El servidor implementa initialize, ping, tools/list, tools/call y transporte HTTP/SSE básico.

## Herramientas iniciales

- agent_status
- approval_status
- system_info
- fs_list
- fs_read
- fs_write
- fs_replace
- fs_delete
- shell_run
- process_list
- process_kill
- open_url
- screen_capture

Todas las herramientas que acceden o modifican el equipo pasan por la cola de aprobación local.

## Flujo de aprobación

1. Una IA solicita una herramienta.
2. El agente responde approval_required con un approval_id.
3. La petición aparece en WILLY > Equipo remoto.
4. El usuario pulsa Permitir o Denegar.
5. Si se permite, WILLY ejecuta la acción y guarda el resultado.
6. La IA consulta approval_status para recuperar el resultado.

## Conexión desde fuera del PC

Para no exponer puertos públicos, se recomienda conectar el endpoint local mediante un túnel MCP seguro. ChatGPT admite MCP remoto y Secure MCP Tunnel según el plan y los permisos disponibles.

## Arranque

Desde WILLY > Equipo remoto pulsa Activar WILLY Agent.

También puede iniciarse manualmente con Node:

    node willy-agent-server.mjs

Variables opcionales:

- WILLY_AGENT_PORT: puerto, por defecto 4050.
- WILLY_AGENT_BIND: interfaz, por defecto 127.0.0.1.
- WILLY_ROOT: raíz de datos de WILLY.
