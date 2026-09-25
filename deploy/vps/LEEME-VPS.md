# WILLY AI en tu VPS de IONOS (Linux L) — guía de 10 minutos

## Antes de empezar (importante)
1. **GitHub está desactualizado.** El repositorio `murelf87/willy-ai` contiene la versión **0.0.7** exportada desde Lovable (20/09) más dos commits pequeños. Tu WILLY instalado va por la **0.0.43** con el rediseño y AVATAR AI. Lo que se despliegue será lo que haya en GitHub. **Sube antes tu versión actual** (desde WILLY: menú GitHub → subir código; o desde tu PC con `git push`). El script se puede volver a ejecutar las veces que haga falta.
2. **Dominio.** Lo ideal es un dominio tuyo (IONOS) apuntando a la IP del VPS (registro A). Si no lo tienes todavía, el script usa uno gratuito `<ip>.sslip.io` para que ya haya HTTPS.
3. Ten a mano la **IP** y la **contraseña de root** que te dio IONOS (panel → Servidores → tu VPS).

## Pasos
En tu ordenador, abre PowerShell (Windows) y entra en el servidor:

```powershell
ssh root@IP_DEL_VPS
```

Dentro del servidor (copia y pega en bloque):

```bash
curl -fsSL -o instalar-willy-vps.sh https://raw.githubusercontent.com/murelf87/willy-AI/main/deploy/vps/instalar-willy-vps.sh
curl -fsSL -o actualizar-willy.sh   https://raw.githubusercontent.com/murelf87/willy-AI/main/deploy/vps/actualizar-willy.sh
DOMAIN=willy.tudominio.es ADMIN_USER=antonio bash instalar-willy-vps.sh
```

Si no tienes dominio, simplemente:

```bash
ADMIN_USER=antonio bash instalar-willy-vps.sh
```

Para subir los dos archivos desde Windows sin enlace:

```powershell
scp .\instalar-willy-vps.sh .\actualizar-willy.sh root@IP_DEL_VPS:/root/
```

Al terminar verás `¡Listo! Abre https://…`. La contraseña de acceso web queda en `/root/willy-vps-resumen.txt` (`cat /root/willy-vps-resumen.txt`).

## Qué queda instalado
| Pieza | Para qué | Cómo se comprueba |
|---|---|---|
| WILLY AI (Node 22, servicio `willy-ai`) | La aplicación, solo en 127.0.0.1:3000 | `systemctl status willy-ai` |
| Caddy (servicio `caddy`) | HTTPS automático + usuario/contraseña delante de todo | `systemctl status caddy` · abrir la URL sin contraseña debe dar 401 |
| Ollama (servicio `ollama`) + `llama3.2:3b` | IA local en CPU (4 vCores / 8 GB → modelos de 3–4B) | `ollama list` · en WILLY, Modelos debe mostrar el modelo |
| ufw + fail2ban + unattended-upgrades | Solo 22/80/443 abiertos, bloqueo de fuerza bruta, parches solos | `ufw status` · `fail2ban-client status sshd` |

## Actualizar cuando subas código nuevo a GitHub
```bash
bash /root/actualizar-willy.sh
```
Compila la versión nueva, la arranca y, si no responde, **vuelve sola a la anterior**.

## Límites honestos de este VPS
- **Sin GPU**: aquí no se genera vídeo ni imagen con IA. El VPS es la «recepción»: WILLY siempre encendido, accesible desde el móvil, cola de trabajos y copias. El «taller» (FLUX, avatar en movimiento, lip-sync) sigue siendo tu portátil (o un servidor con GPU más adelante).
- **IA en CPU**: `llama3.2:3b` va a unas pocas palabras por segundo; para razonar en serio WILLY debe seguir turnándose con los motores gratuitos en la nube (como hace Autoconstrucción) o delegar al portátil.
- **Los datos de WILLY 0.0.7 viven en el navegador** (localStorage), no en el servidor: cada dispositivo verá sus propios proyectos hasta que exista el backend real (el código lo prevé en `services/backend.ts`, puerto 4000, pero ese backend no está en GitHub).

## Seguridad (por qué hay contraseña delante)
El inicio de sesión de WILLY 0.0.7 es solo visual (se guarda en el navegador y la contraseña de administrador por defecto está en el código). Las rutas `/api/local-ai` (usar, descargar y borrar modelos), `/api/fetch-url` (abrir cualquier URL desde el servidor) y `/api/build-installer` no piden identificación. Por eso Caddy exige usuario y contraseña **antes** de llegar a WILLY. No quites esa capa hasta que el backend tenga autenticación real.

## Si algo falla
- Registro completo del instalador: `/var/log/willy-vps-install.log`
- WILLY: `journalctl -u willy-ai -n 80`
- Caddy / certificado: `journalctl -u caddy -n 80` (si Let's Encrypt rechaza el dominio sslip.io, vuelve a ejecutar con `TLS_MODE=internal` o con tu dominio)
- Ollama: `journalctl -u ollama -n 50`
