@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo  === WILLY AI - Configurar todas las IA gratuitas ===
echo.
echo  Vamos a abrir las paginas de claves gratuitas de cada proveedor.
echo  En cada una: registrate (si no tienes cuenta) y crea una clave API.
echo  Luego introdúcela en WILLY AI: Ajustes - Centro de Inteligencia - Motores.
echo.
echo  -------------------------------------------------------
echo  PROVEEDORES (todos gratuitos, sin tarjeta):
echo.
echo   1. Google Gemini     - muy potente, limite generoso
echo   2. Groq              - el MAS RAPIDO, ideal para codigo
echo   3. OpenRouter        - acceso a docenas de modelos gratis
echo   4. Mistral           - bueno para idiomas y codigo
echo   5. Cohere            - robusto, estable
echo   6. NVIDIA            - modelos avanzados, incluye DeepSeek
echo  -------------------------------------------------------
echo.
pause

echo.
echo  [1/6] Abriendo Google Gemini (AI Studio)...
echo  - Inicia sesion con Google
echo  - Pulsa "Get API key" o "Create API key"
echo  - Copia la clave que empieza por AIza...
echo.
start "" "https://aistudio.google.com/apikey"
timeout /t 4 >nul

echo  [2/6] Abriendo Groq...
echo  - Registrate o inicia sesion
echo  - Ve a "API Keys" y pulsa "Create API key"
echo  - Copia la clave que empieza por gsk_...
echo.
start "" "https://console.groq.com/keys"
timeout /t 4 >nul

echo  [3/6] Abriendo OpenRouter...
echo  - Registrate o inicia sesion
echo  - Ve a "Keys" y pulsa "Create Key"
echo  - Copia la clave que empieza por sk-or-...
echo.
start "" "https://openrouter.ai/settings/keys"
timeout /t 4 >nul

echo  [4/6] Abriendo Mistral...
echo  - Registrate o inicia sesion
echo  - Ve a "API Keys" y pulsa "Create new key"
echo  - Copia la clave generada
echo.
start "" "https://console.mistral.ai/api-keys/"
timeout /t 4 >nul

echo  [5/6] Abriendo Cohere...
echo  - Registrate o inicia sesion
echo  - La clave de prueba aparece automaticamente en el dashboard
echo  - Copia la clave que empieza por ...
echo.
start "" "https://dashboard.cohere.com/api-keys"
timeout /t 4 >nul

echo  [6/6] Abriendo NVIDIA...
echo  - Registrate o inicia sesion con NVIDIA
echo  - Ve a "API Keys" y genera una clave
echo  - Copia la clave generada
echo.
start "" "https://build.nvidia.com/settings/api-keys"
timeout /t 4 >nul

echo.
echo  -------------------------------------------------------
echo  DONDE INTRODUCIR LAS CLAVES EN WILLY AI:
echo.
echo    Abre WILLY AI
echo    Ve a: Ajustes (icono engranaje)
echo    Seccion: "Centro de Inteligencia" o "Motores de IA"
echo    Cada proveedor tiene su campo de clave API
echo    Pega la clave y guarda
echo.
echo  COMO FUNCIONA EL SISTEMA AUTOMATICO:
echo.
echo    - WILLY probara cada motor en orden de calidad
echo    - Si uno falla o llega al limite diario, pasa al siguiente
echo    - Los que fallan se desactivan automaticamente con cooldown
echo    - Los que funcionan se priorizan en el siguiente intento
echo    - Con LM Studio local configurado, es el ultimo recurso
echo.
echo  CONSEJO: configura al menos Gemini + Groq. Con esos dos
echo  la Autoconstruccion funcionara casi siempre sin fallos.
echo.
echo  -------------------------------------------------------
echo.
pause
