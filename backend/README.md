# TID — Triangulation Backend

Backend Python del sistema de triangulación de contribuciones estudiantiles
del proyecto TID (RepoSense + análisis con LLM).

En esta primera etapa solo validamos la conexión con OpenRouter usando el
modelo **NVIDIA Nemotron 3 Ultra (free)**. Más adelante este mismo proyecto
va a crecer para exponer endpoints FastAPI que consumen los datos de
RepoSense + PyDriller y le piden un análisis al LLM.

## Setup

1. Crear y activar un entorno virtual:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. Instalar dependencias:
   ```bash
   pip install -r requirements.txt
   ```

3. Configurar la API key:
   ```bash
   cp .env.example .env
   # Editá .env y pegá tu key de https://openrouter.ai/keys
   ```

4. Probar la conexión con el LLM:
   ```bash
   python scripts/test_openrouter.py
   ```

   Si todo va bien vas a ver la respuesta del modelo analizando un commit
   ficticio, más el conteo de tokens usados.

## Estructura

```
triangulation-backend/
├── .env                 # (no versionado) tu API key
├── .env.example         # plantilla
├── .gitignore
├── requirements.txt
├── README.md
└── scripts/
    └── test_openrouter.py    # smoke test de la conexión con el LLM
```

## Próximos pasos

- [x] Migrar la lógica del LLM a un módulo reutilizable (`app/llm.py`).
- [x] Levantar FastAPI con un endpoint `POST /api/analyze`.
- [x] Integrar PyDriller para extraer metadatos de commits.
- [x] Parsear `prompt-log.md` y `authorship.md` (formato pendiente de decisión con el profesor).
- [x] Diseñar el prompt de triangulación (commits + prompt-log + authorship → análisis).

## Backend FastAPI

La lógica validada en `scripts/` (ver más abajo) está envuelta en un servidor
local con un único endpoint flexible.

### Levantar el servidor

```bash
uvicorn app.main:app --reload
```

Swagger UI (documentación interactiva): http://localhost:8000/docs

### Ejemplo de request

```bash
curl -X POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "repo_path": "/ruta/al/repo/clonado",
    "include_prompt_log": true,
    "include_authorship": true
  }'
```

`include_prompt_log` e `include_authorship` son opcionales (default `false`).
Si el archivo correspondiente (`bitacora_de_prompts.md` / `Autoria.md`) no
existe en la raíz del repo, se ignora silenciosamente y `sources_used` en la
respuesta refleja lo que realmente se usó.

## Scripts de referencia

Los scripts en `scripts/` documentan cómo se llegó al diseño del backend,
de menor a mayor triangulación, y se mantienen como referencia (no se
ejecutan en producción):

- `test_openrouter.py` — smoke test de conexión con OpenRouter.
- `test_llm_repo_real.py` — análisis solo con commits de un repo real.
- `test_llm_triangulacion.py` — commits + bitácora de prompts.
- `test_llm_triangulacion_completa.py` — commits + bitácora + autoría (CRediT).

## Endpoints de análisis

- `POST /api/analyze`: además de `repo_url`, acepta `rubric`, `task_start` y `task_deadline`
  (`YYYY-MM-DD`; inicio 00:00 y entrega 23:59, hora de Chile). Devuelve hallazgos con
  `criterion` y la lista `not_assessable`.
- `POST /api/rubric/extract`: recibe un archivo (`multipart`, campo `file`; `.pdf`, `.docx`,
  `.md`, `.txt`; máx. 5 MB) y devuelve `{ "text": "..." }`. Solo extrae texto.

## Pruebas

```bash
.venv/bin/python -m pytest tests            # extracción de rúbricas, prompt y parseo
.venv/bin/python scripts/run_scenarios.py   # escenarios contra el LLM (necesita uvicorn en :8000)
.venv/bin/python tests/fixtures/make_fixtures.py  # regenera la rúbrica ficticia (.md/.docx/.pdf)
```

## Proveedor de LLM

El proveedor, el modelo y la API key los configura cada evaluador desde la interfaz. El backend los
recibe en cada petición (`llm: {provider, model, base_url}` en el body y la key en el header
`X-LLM-Api-Key`), no guarda la key y no la escribe en logs ni mensajes de error.

- `POST /api/llm/test` hace una llamada mínima con esa configuración y responde `{ok: true, ...}`
  o un error tipificado: `invalid_api_key`, `no_credit_or_rate_limit`, `model_not_found`,
  `provider_unreachable`, `timeout`, `provider_error`, `llm_not_configured`.
- Sin configuración en la petición se usa `OPENROUTER_API_KEY` del `.env` (solo para desarrollo,
  modo Automático con la cadena de `app/models_config.json`).

## Evidencia de los hallazgos

Cada hallazgo de `/api/analyze` trae `evidence`: referencias a commits (`{type: "commit", hash}`, con
el hash completo) y a líneas de la bitácora o la autoría (`{type: "prompt_log" | "authorship",
line_start, line_end}`, base 1). El LLM las cita sobre contenido con líneas numeradas, y el backend
descarta toda referencia que no exista en el repo. `no_evidence_needed` marca los hallazgos sobre un
archivo que falta o que tiene otro nombre.

- `GET /api/artifacts/{prompt_log|authorship}?repo_url=...` devuelve el archivo (`lines`) y el nombre
  real con que se encontró. Los archivos se buscan sin distinguir mayúsculas ni tildes y se aceptan
  nombres parecidos (`bitacora_de_propts.md`); si el nombre difiere del esperado, el análisis lo
  informa como hallazgo `info`.

## Versiones de la rúbrica

Cada tarea tiene un historial de versiones de su rúbrica (compartido por todos sus grupos). Subir una
rúbrica nunca sobrescribe: crea la versión siguiente con fecha, archivo original y nota opcional. Una
sola versión está **activa** por tarea, y es la que usan los análisis nuevos; cada análisis guarda con
qué versión se hizo (`rubric_version`, y `rubric_state`: `version`, `none` = sin rúbrica o `unknown` =
usó una rúbrica de la que no se sabe la versión).

- `GET  /api/tasks/{owner}/{name}/rubric`: la versión activa.
- `GET  /api/tasks/{owner}/{name}/rubric/versions[?include_content=true]`: lista (la más reciente primero).
- `POST /api/tasks/{owner}/{name}/rubric/versions`: `{content, filename?, note?, activate=true}`. Si el
  texto es igual al de cualquier versión existente no crea otra: devuelve esa y, con `activate`, la activa.
- `GET  /api/tasks/{owner}/{name}/rubric/versions/{n}` y `POST .../versions/{n}/activate`.
- `GET  /api/tasks/{owner}/{name}/rubric/compare?from=1&to=2`: criterios agregados, quitados y
  modificados. Los criterios se reconocen en el texto (`C1 - Título | descripción`, `1. Título`…); con
  menos de dos reconocidos responde `structured: false` y no marca diferencias.
- `/api/analyze` con `task_id` usa la versión activa si no recibe `rubric_version` ni `rubric`.

No se elimina ninguna versión. Al abrir una base anterior, la migración deja activa la rúbrica que había
en cada tarea, completa `rubric_state` sin inventar versiones y guarda antes un respaldo
`tid.db.bak-AAAA-MM-DD_HHMMSS` en la misma carpeta (solo si hay algo que cambiar; `data/` está en
`.gitignore`).
