# Experimento controlado con grupos ficticios

Mide qué tan bien GitSight detecta casos sembrados en 8 repositorios ficticios de la tarea
`curso-demo/tarea04-agenda`: detección de alertas, falsas alertas, estabilidad entre repeticiones,
cobertura de la rúbrica y evidencia.

| Archivo | Para qué sirve |
|---|---|
| `generar.py` | Crea los 8 repositorios ficticios (`equipo1` a `equipo8`) y su `.zip`. |
| `rubrica-tarea04.md` | Rúbrica C1–C5 que se carga como versión 1 de la tarea. |
| `respuestas-correctas.json` | Qué alerta o discrepancia se sembró en cada grupo (clave de corrección). |
| `metricas.py` | Calcula las métricas desde la base de GitSight. |

## Cómo repetirlo

1. **Generar los grupos.** Desde esta carpeta:

   ```bash
   python3 generar.py ~/experimento-gitsight/grupos
   ```

   Crea `experimento-tarea04/` (8 repos con historial git), `experimento-tarea04.zip`, y copias de la
   rúbrica y de las respuestas. No sobrescribe: si la carpeta ya existe, se detiene.
   Sin argumento escribe en `./salida-experimento`. Requiere `git` y `zip`.

2. **Cargarlos en GitSight por lote.** Levanta la app (`./start.sh`), abre el análisis por lote y
   escanea el `.zip` (o la carpeta `experimento-tarea04`); la tarea queda como
   `curso-demo/tarea04-agenda`. Antes de analizar, guarda el contenido de `rubrica-tarea04.md` como
   rúbrica de la tarea (será la v1) y las fechas: inicio 2026-11-02, entrega 2026-11-09 23:59.
   Configura el mismo modelo en todas las repeticiones (el experimento usó uno de Anthropic).

3. **Analizar 3 veces cada grupo.** Presiona **Analizar todos** y, cuando termine, repite el lote dos
   veces más (rescanea y vuelve a analizar los 8 grupos: cada corrida guarda un análisis nuevo y no
   reemplaza los anteriores). Debes terminar con exactamente 3 análisis por grupo; `metricas.py`
   avisa si algún grupo no los tiene.

4. **Calcular las métricas sobre una copia de la base.** Nunca leas la base original en uso:

   ```bash
   mkdir -p ~/experimento-gitsight
   cp backend/data/tid.db ~/experimento-gitsight/tid-copia.db
   python3 experimentos/metricas.py \
     --db ~/experimento-gitsight/tid-copia.db \
     --respuestas experimentos/respuestas-correctas.json \
     --out ~/experimento-gitsight
   ```

   Abre la copia en solo lectura y escribe en `--out` (fuera del repo): `resultados.md`, los CSV
   (`p1_*.csv`, `p2_*.csv`) y `casos-para-revisar.txt`.

## Qué calcula

- **Parte 1 (prueba controlada):** detección de alertas esperadas, falsas alertas, estabilidad
  (mismo conjunto de `alert_case` y media ± desviación de hallazgos por tipo), cobertura de C1–C5,
  evidencia (hallazgos con ≥1 cita y citas por hallazgo), y un archivo con los casos de `equipo2`,
  `equipo7` y `equipo8` para leer a mano.
- **Parte 2 (análisis reales):** todos los análisis que no son de `curso-demo/`, solo con cifras
  agregadas y nombres de tarea (sin nombres de estudiantes ni texto de hallazgos). La base no guarda la
  duración de cada análisis, así que no se reporta tiempo.

Las clasificaciones de `casos-para-revisar.txt` son preliminares: léelas y confírmalas tú.
No se versionan los resultados, los CSV ni la copia de la base.
