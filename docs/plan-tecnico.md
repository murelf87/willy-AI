# Plan técnico — Marina Workout

> Principio: empezar barato y crecer después, solo cuando una señal medible lo pida, con el código preparado desde el primer día. WILLY completa cada punto al planificar.

## Día 1: punto de partida

Programa que se instala en el equipo de cada usuario (con su instalador): el día 1 NO necesita servidor ni coste mensual. Si más adelante necesita cuentas, licencias, sincronización o actualizaciones automáticas, se añade un servidor pequeño aparte (VPS 1) solo para eso.

```
EQUIPO DEL USUARIO (programa instalado)
├── interfaz (ventana)
├── servicio local en segundo plano (si hace falta)
├── base de datos local (SQLite)
└── carpeta de datos del usuario

SOLO SI HACE FALTA MÁS ADELANTE: VPS 1 (API + PostgreSQL) para cuentas, licencias, sincronización o actualizaciones
```

## Hacia dónde puede crecer (sin rehacer el código)

```
            CDN
             │
        LOAD BALANCER
             │
   ┌─────────┴─────────┐
   │                   │
API 1               API 2
   │                   │
   └─────────┬─────────┘
             │
         PostgreSQL
             │
       Redis / Queue
             │
      ┌──────┴──────┐
      │             │
   Worker 1      Worker 2
      │
 Object Storage
```

## Código preparado para crecer desde el primer día

1. La API no guarda nada en su memoria entre peticiones (sesiones en la base de datos o en cookies firmadas): así mañana puede haber API 1 y API 2 detrás del balanceador.
2. Los archivos se guardan a través de una sola pieza de almacenamiento: hoy una carpeta del VPS, mañana Object Storage (compatible con S3), sin tocar el resto del código.
3. Las tareas largas van siempre a una cola y las hace el worker, nunca dentro de la petición del usuario: hoy la cola puede ser una tabla de PostgreSQL, mañana Redis u otra cola.
4. Cada tarea guarda su estado (pendiente, en curso, hecha, fallida) y se puede repetir sin estropear nada: así pueden trabajar Worker 1 y Worker 2 a la vez.
5. Toda la configuración (direcciones, claves, puertos) va en variables de entorno, nunca escrita en el código.
6. Los cambios de la base de datos se hacen con migraciones numeradas.
7. Una ruta de salud (/health) y registros por la salida estándar, para el balanceador y la monitorización.
8. Los archivos del frontend salen con nombre versionado, listos para servirse desde una CDN.
9. La caché va detrás de su propia pieza: hoy ninguna o una sencilla, mañana Redis, sin reescribir.

## Si el proyecto usa IA pesada

Detectado en tu idea: no (se aplica si más adelante la usa).

```
WEB / APP
   │
API PRINCIPAL
   │
QUEUE
   │
AI WORKER
   │
GPU SERVER / OLLAMA / COMFYUI
```

1. La API no ejecuta la IA: crea un trabajo en la cola y responde al momento con su número.
2. El AI WORKER lo hace en la GPU (Ollama, ComfyUI…) y la pantalla enseña el progreso y el resultado cuando termina.
3. Límites claros: tantos trabajos a la vez como quepan en la memoria de la GPU, tiempo máximo, reintentos y botón de cancelar.
4. Al principio el AI WORKER puede estar en tu propio ordenador con su GPU, o en el VPS 1 si la IA es ligera; al crecer, un servidor con GPU aparte.

## 1. Objetivo

_Pendiente._

## 2. Arquitectura

_Pendiente._

## 3. Frontend

_Pendiente._

## 4. Backend

_Pendiente._

## 5. Base de datos

_Pendiente._

## 6. Almacenamiento

_Pendiente._

## 7. Autenticación

_Pendiente._

## 8. APIs externas

_Pendiente._

## 9. Procesamiento en segundo plano

_Pendiente._

## 10. IA / GPU

_Pendiente._

## 11. Servidor inicial recomendado

_Pendiente._

## 12. CPU

_Pendiente._

## 13. RAM

_Pendiente._

## 14. Disco

_Pendiente._

## 15. Sistema operativo

_Pendiente._

## 16. Base de datos recomendada

_Pendiente._

## 17. Dominio

_Pendiente._

## 18. SSL

_Pendiente._

## 19. Email

_Pendiente._

## 20. CDN

_Pendiente._

## 21. Backups

_Pendiente._

## 22. Monitorización

_Pendiente._

## 23. Seguridad

_Pendiente._

## 24. CI/CD

_Pendiente._

## 25. Entornos

_Pendiente._

## 26. Coste inicial

_Pendiente._

## 27. Coste al crecer

_Pendiente._

## 28. Cuellos de botella

_Pendiente._

## 29. Plan de escalado

_Pendiente._

## 30. Qué alojar en el mismo servidor al principio

_Pendiente._

## 31. Qué separar al crecer

_Pendiente._

## 32. Qué servicios son opcionales

_Pendiente._

## 33. Qué servicios son imprescindibles

_Pendiente._

## Lo que NO hace falta al principio (y cuándo sí)

- **Varios servidores + balanceador de carga**: solo cuando el servidor va al límite de CPU o memoria de forma sostenida en horas punta (por ejemplo, por encima del 70 %) incluso después de optimizar, o el negocio no puede permitirse ni un minuto sin servicio.
- **Redis (caché o colas)**: solo cuando hay consultas lentas que se repiten muchísimo (medido, no supuesto) o las tareas en segundo plano ya no caben en la propia base de datos.
- **Kafka (flujo de eventos)**: solo cuando varios sistemas distintos necesitan recibir los mismos eventos en tiempo real y a gran volumen (miles por segundo).
- **Microservicios**: solo cuando varios equipos trabajan a la vez y se estorban, o una parte concreta necesita crecer de forma muy distinta al resto.
- **Kubernetes**: solo cuando hay muchos servicios y servidores que desplegar y vigilar a la vez, y alguien con tiempo para mantenerlo.
- **Base de datos en su propio servidor**: solo cuando la base de datos compite con la aplicación por memoria o CPU, o hacen falta réplicas y copias gestionadas.
- **CDN**: solo cuando hay muchas imágenes o vídeos, o visitantes lejos del servidor que notan lentitud.
- **Servidor con GPU propio**: solo cuando la IA se usa de forma constante y alquilarla por uso ya sale más cara que tenerla.
