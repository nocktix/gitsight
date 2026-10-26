# GitSight — guía para desarrollo

Esta guía es para quien quiera modificar o ampliar GitSight. Si solo vas a usarlo, basta con el
[README](../README.md).

## Estructura del repositorio

```
gitsight/
├── start.sh / start.ps1 / start.bat   arranque con un solo comando (macOS-Linux / Windows)
├── backend/                            API FastAPI (Python ≥ 3.12) con base SQLite local
│   ├── app/
│   │   ├── main.py                     rutas y manejo de errores
│   │   ├── llm_providers.py            proveedores de IA (compatible con OpenAI y Anthropic)
│   │   ├── llm_errors.py               errores tipificados del proveedor
│   │   ├── llm.py                      prompt de triangulación y reintento por JSON inválido
│   │   ├── evidence.py                 validación de la evidencia de cada hallazgo
│   │   ├── artifacts.py                búsqueda tolerante de bitácora y autoría
│   │   ├── rubrics.py                  criterios de una rúbrica y comparación entre versiones
│   │   ├── repository.py, db.py        acceso a datos, esquema y migración de la base
│   │   ├── routes_db.py                tareas, rúbricas, análisis e importación
│   │   ├── git_analyzer.py             commits con PyDriller
│   │   ├── repo_cache.py               repos clonados desde GitHub (caché local)
│   │   └── config.py                   cuentas excluidas (TID_EXCLUDED_AUTHORS)
│   └── tests/                          pytest
├── frontend/                           React + TypeScript + Vite
│   ├── src/                            componentes, contextos, utilidades y estilos
│   │   └── styles/tokens.css           paleta y colores (único lugar con colores)
│   └── tests/                          pruebas con el ejecutor de Node (`node --test`)
└── docs/                               esta guía, rúbricas de ejemplo e imágenes
```

## Preparar el entorno a mano

```bash
# backend (Python 3.12 o superior; en Windows usa .venv\Scripts\activate)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000     # documentación interactiva: http://localhost:8000/docs

# frontend (Node 22.18 o superior)
cd frontend
npm install
npm run dev                                   # http://localhost:5173
```

El frontend espera el backend en `http://localhost:8000`. Para apuntar a otro, define
`VITE_API_BASE_URL` al arrancar Vite (por ejemplo `VITE_API_BASE_URL=http://localhost:8001 npm run dev`);
el backend solo acepta los orígenes `localhost:3000`, `5173` y `5174`.

## Pruebas y comprobaciones

```bash
cd backend  && python -m pytest                       # backend
cd frontend && npm test && npx tsc -b && npm run lint  # frontend: tests, tipos y lint
```

`frontend/tests/palette.test.ts` comprueba el contraste de los colores (WCAG AA), que no haya colores
fuera de `tokens.css` y que no queden tokens sin uso.

## Variables de entorno (backend/.env)

| Variable | Para qué sirve |
|---|---|
| `OPENROUTER_API_KEY` | Respaldo para desarrollo: se usa si la interfaz no manda un proveedor propio. |
| `TID_EXCLUDED_AUTHORS` | Cuentas que no son estudiantes (bots, profesores, ayudantes), separadas por comas. |
| `TID_DB_PATH` | Ruta de la base SQLite (por defecto `backend/data/tid.db`). |
| `TID_CACHE_DIR` | Carpeta donde se guardan los repos clonados (por defecto `~/.tid-cache/repos`). |

## Proveedor de IA

El proveedor, el modelo y la API key los configura cada persona desde la interfaz. El backend los
recibe en cada petición (`llm: {provider, model, base_url}` en el cuerpo y la key en el header
`X-LLM-Api-Key`), no guarda la key y no la escribe en registros ni en mensajes de error.

- `POST /api/llm/test` hace una llamada mínima con esa configuración y responde `{ok: true, ...}` o un
  error tipificado: `invalid_api_key`, `no_credit_or_rate_limit`, `model_not_found`,
  `provider_unreachable`, `timeout`, `provider_error`, `llm_not_configured`.
- Sin configuración en la petición se usa `OPENROUTER_API_KEY` del `.env` (solo desarrollo, modo
  Automático con la cadena de `app/models_config.json`).

## Endpoints principales

- `POST /api/analyze`: analiza un repositorio (`repo_url`, `include_prompt_log`, `include_authorship`,
  `task_id`, `rubric_version`, fechas de la tarea, `llm`). Devuelve hallazgos con `criterion`, `evidence`
  y la lista `not_assessable`.
- `GET /api/commits`, `GET /api/commits/{hash}/diff`, `POST /api/commits/{hash}/summary`: commits, cambios
  y resumen con IA de un commit.
- `GET /api/artifacts/{prompt_log|authorship}?repo_url=...`: contenido del archivo y el nombre real con
  que se encontró.
- `POST /api/rubric/extract`: recibe un archivo (`.pdf`, `.docx`, `.md`, `.txt`; máx. 5 MB) y devuelve su
  texto. No guarda nada.
- `/api/tasks/...`: tareas, fechas, grupos y versiones de la rúbrica (ver más abajo).
- `GET /api/analyses?group_url=...`: historial de análisis de un grupo.

### Evidencia de los hallazgos

Cada hallazgo trae `evidence`: referencias a commits (`{type: "commit", hash}`, con el hash completo) y a
líneas de la bitácora o la autoría (`{type: "prompt_log" | "authorship", line_start, line_end}`, base 1).
El modelo las cita sobre contenido con líneas numeradas, y el backend descarta toda referencia que no
exista en el repositorio. `no_evidence_needed` marca los hallazgos sobre un archivo que falta o que tiene
otro nombre.

### Versiones de la rúbrica

Cada tarea tiene un historial de versiones de su rúbrica, compartido por todos sus grupos. Subir una
rúbrica nunca sobrescribe: crea la versión siguiente con fecha, archivo original y nota opcional. Una sola
versión está **activa** por tarea, y es la que usan los análisis nuevos; cada análisis guarda con qué
versión se hizo (`rubric_version` y `rubric_state`: `version`, `none` = sin rúbrica, `unknown` = usó una
rúbrica de la que no se sabe la versión).

- `GET /api/tasks/{owner}/{name}/rubric`: la versión activa.
- `GET /api/tasks/{owner}/{name}/rubric/versions[?include_content=true]`: lista, la más reciente primero.
- `POST /api/tasks/{owner}/{name}/rubric/versions`: `{content, filename?, note?, activate=true}`. Si el
  texto es igual al de cualquier versión existente no crea otra: devuelve esa y, con `activate`, la activa.
- `GET /api/tasks/{owner}/{name}/rubric/versions/{n}` y `POST .../versions/{n}/activate`.
- `GET /api/tasks/{owner}/{name}/rubric/compare?from=1&to=2`: criterios agregados, quitados y modificados.
  Los criterios se reconocen en el texto (`C1 - Título | descripción`, `1. Título`…); con menos de dos
  reconocidos responde `structured: false` y no marca diferencias.

No se elimina ninguna versión. Al abrir una base anterior, la migración deja activa la rúbrica que había en
cada tarea, completa `rubric_state` sin inventar versiones y guarda antes un respaldo
`tid.db.bak-AAAA-MM-DD_HHMMSS` junto a la base (solo si hay algo que cambiar).

## Colores y estilos

Todos los colores viven en `frontend/src/styles/tokens.css`, en dos capas: una paleta base (`--ocean-*`) y
una capa semántica (`--color-*`) que es la única que usan los componentes. Un modo oscuro sería otro bloque
`[data-theme="dark"]` con los mismos nombres `--color-*`.

## Datos locales

Nada de esto se versiona (`.gitignore`): `backend/.env`, `backend/data/` (base SQLite y sus respaldos),
`~/.tid-cache/` (repos clonados), `.tid-logs/` (registros de los scripts de arranque), `backend/.venv/` y
`frontend/node_modules/`.
