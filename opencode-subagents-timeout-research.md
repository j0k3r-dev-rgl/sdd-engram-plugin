# Investigación: subagentes y timeouts en OpenCode

## Contexto

Se investigó cómo trabaja OpenCode con la delegación de agentes/subagentes para evaluar dos necesidades:

1. Si es posible soportar un **timeout global real** para todos los providers/modelos sin inflar `opencode.json`.
2. Si existe alguna forma de **intervenir subagentes colgados** o, al menos, mejorar el fallback sin reiniciar manualmente el proceso.

Restricción importante: **no podemos modificar el core de OpenCode**. La solución debe venir desde el plugin/orquestador.

---

## Conclusión ejecutiva

### Sobre timeouts globales

OpenCode expone hoy `timeout` y `chunkTimeout` **por provider**, no de forma global.

Según la documentación y el schema oficial:

- `provider.<id>.options.timeout`
- `provider.<id>.options.chunkTimeout`

No se encontró un ajuste nativo tipo:

```json
{
  "timeout": 60000,
  "chunkTimeout": 30000
}
```

que aplique automáticamente a todos los providers/modelos.

### Sobre subagentes

Los subagentes funcionan como **child sessions**. El modelo/provider se fija en el momento de enviar el prompt y no se encontró soporte para:

- cambiar provider/model **en caliente** sobre una ejecución ya iniciada,
- ni “migrar” un subagente vivo a otro modelo sin reiniciar.

Por lo tanto, **la estrategia correcta sin tocar el core no es mutar el timeout global ni hot-swap de modelo**, sino implementar desde el plugin/orquestador un sistema de:

- **watchdog de delegación**,
- **detección de estancamiento**,
- **cancelación o abandono controlado del subagente**, y
- **relanzamiento de fallback con progreso parcial**.

---

## Hallazgos clave

### 1. Los timeouts son por provider

En el schema de configuración oficial de OpenCode, `timeout` y `chunkTimeout` viven dentro de cada provider.

Valores relevantes:

- `timeout`: timeout total del request
- `chunkTimeout`: timeout entre chunks del stream SSE
- default documentado para `timeout`: **300000 ms (5 minutos)**

Esto implica que, sin tocar el core:

- no existe un timeout global raíz,
- y replicarlo a todos los providers desde el plugin sería posible pero poco limpio.

### 2. El modelo se fija al enviar la ejecución

En el flujo de envío del prompt, OpenCode toma el modelo/provider seleccionado al momento del submit y lo pasa a:

- `sdk.client.session.prompt(...)`
- `sdk.client.session.command(...)`
- `sdk.client.session.shell(...)`

Eso sugiere que:

- el modelo queda fijado al iniciar la ejecución,
- y cambios posteriores aplican solo a ejecuciones futuras.

### 3. Los subagentes son sesiones hijas

La arquitectura de subagentes se apoya en **child sessions**. El padre puede:

- navegar a la sesión hija,
- inspeccionarla,
- abortarla,
- y lanzar otra ejecución.

Pero no se encontró evidencia de una API o mecanismo para:

- entrar en una ejecución viva,
- reemplazarle provider/model,
- y continuar el mismo stream.

### 4. Sí existe una vía realista para fallback robusto

Aunque no se pueda hacer hot-swap del modelo, sí se puede diseñar desde el plugin/orquestador una estrategia robusta basada en:

- monitorear actividad/progreso del subagente,
- detectar idle/stall,
- cancelar o dar por muerto al subagente,
- leer progreso parcial persistido,
- relanzar el fallback con el delta pendiente.

---

## Análisis de opciones

### Opción A — Mutar `opencode.json` en runtime

#### Idea

Que el plugin, al iniciar la sesión, modifique `opencode.json` para inyectar `timeout` y `chunkTimeout` a todos los providers.

#### Problemas

- No está claro que OpenCode relea la config dinámicamente para cada request.
- No garantiza impacto sobre requests ya iniciados.
- Puede ensuciar el archivo del usuario.
- Puede generar condiciones de carrera entre sesiones.
- Sigue siendo una solución pesada y frágil.

#### Veredicto

**Poco viable / poco recomendable.**

---

### Opción B — Expandir timeout por provider/model desde el plugin

#### Idea

Detectar providers/modelos del usuario y escribir todas las entradas necesarias en `opencode.json`.

#### Problemas

- Providers con decenas de modelos.
- `opencode.json` crecería muchísimo.
- Mantenimiento muy malo.
- Realmente el timeout es por provider, no por modelo, pero incluso así sigue siendo una mala UX si se hace de forma masiva.

#### Veredicto

**Técnicamente posible, pero mala solución.**

---

### Opción C — Watchdog lógico en el plugin/orquestador

#### Idea

No depender del timeout del transporte de OpenCode, sino implementar un control lógico por delegación:

- `started_at`
- `last_activity_at`
- `last_progress_at`
- `max_runtime_ms`
- `max_idle_ms`
- `artifact_topic_key`
- `task_slice`

Luego el plugin/orquestador monitorea si hubo progreso útil.

Si no lo hubo dentro del umbral:

1. marca el subagente como `stalled`,
2. intenta cancelarlo si tiene API/capacidad,
3. lee su progreso parcial,
4. calcula lo pendiente,
5. lanza `sdd-*-fallback` con el resto.

#### Ventajas

- No toca el core.
- No ensucia `opencode.json`.
- Funciona aunque no exista timeout global real.
- Se alinea con la arquitectura actual de OpenCode.
- Encaja muy bien con artifacts como `apply-progress`.

#### Veredicto

**Es la opción recomendada.**

---

## Definición recomendada de “progreso útil”

Para evitar que el fallback se dispare por falsos positivos, conviene medir no solo tiempo bruto sino **actividad útil**.

Se propone considerar como progreso útil cualquiera de estos eventos:

- nueva respuesta del subagente,
- tool call completada,
- actualización de artifact en memoria/persistencia,
- avance de `apply-progress`,
- cambio de estado observable en la sesión hija.

Esto permite trabajar con un **idle timeout funcional**, aunque no se pueda leer el stream chunk por chunk desde el plugin.

---

## Diseño recomendado

### 1. El agente principal no debe tener timeout agresivo

El principal/orquestador debe mantener el control del flujo y supervisar delegaciones.

### 2. Cada subagente debe ejecutarse con un TTL lógico

Ejemplo:

- `max_runtime_ms = 10 min`
- `max_idle_ms = 45 s`

### 3. Todo subagente debe persistir progreso parcial

Especialmente en fases como:

- `sdd-apply`
- `sdd-verify`
- cualquier tarea por slices o batches

Esto es indispensable para que el fallback pueda reanudar por delta y no desde cero.

### 4. Si un subagente se estanca

El plugin/orquestador debe:

1. marcarlo como `stalled`,
2. intentar abortarlo/cancelarlo si es posible,
3. leer el artifact parcial,
4. reconstruir lo ya hecho,
5. delegar al fallback solo lo pendiente.

---

## Integración con el sistema `sdd-*-fallback`

Esta investigación refuerza que el enfoque actual de fallback por relanzamiento es correcto.

Flujo recomendado:

1. lanzar `sdd-*` primario,
2. monitorear progreso/actividad,
3. si se estanca o excede TTL lógico:
   - cancelar o abandonar controladamente,
   - leer progreso parcial,
4. lanzar `sdd-*-fallback`,
5. pasarle:
   - task slice original,
   - progreso parcial,
   - artifact refs,
   - delta pendiente.

Esto simula continuidad sin necesitar hot-swap de modelo.

---

## Recomendación final

### No recomendado

- Mutar `opencode.json` al vuelo
- Replicar timeouts sobre todos los providers/modelos
- Intentar cambiar provider/model de un subagente ya ejecutándose

### Recomendado

Implementar desde el plugin/orquestador:

1. **watchdog de subagentes**
2. **detección de stall/idle por falta de progreso útil**
3. **persistencia frecuente de progreso parcial**
4. **fallback automático por reanudación**

En una línea:

> Sin tocar el core de OpenCode, la solución correcta no es un timeout global runtime sino un watchdog de subagentes con progreso parcial persistente y fallback por reanudación.
