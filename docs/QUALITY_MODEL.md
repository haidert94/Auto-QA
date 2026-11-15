# Modelo de evaluación de calidad
**Separar preparación de calidad real.** No equiparar porcentaje de pruebas exitosas con ausencia de defectos.

## IPA — Índice de preparación para automatización (0–100)
Pesos iniciales orientativos: aplicación/autorización 15, documentación funcional 30, accesos/permisos 20, datos/preparación 20, alcance/seguridad 15. Adaptar criterios no aplicables al contexto y documentar la normalización. Sin autorización/alcance seguro, estado BLOQUEADO aunque la puntuación sea alta. Una casilla marcada solo prueba disponibilidad declarada, no calidad documental validada. Guardar evidencia y explicación por criterio.

## ICSP — Índice de calidad de suite de pruebas (0–100)
Pesos iniciales: cobertura de requisitos verificables 30%, calidad de aserciones 25%, estabilidad/reproducibilidad 20%, cobertura de escenarios/roles 15%, trazabilidad/evidencias 10%. Solo calcular con evidencia real; indicar NO EVALUABLE cuando faltan ejecuciones o denominadores confiables.

## Reporte
Mostrar: requisitos conocidos y verificables; cubiertos/no cubiertos; escenarios creados, ejecutados, aprobados, fallidos y bloqueados; resultados por rol; severidad y confianza de hallazgos; referencias a evidencias; limitaciones; preguntas de aclaración y acciones prioritarias. Diferenciar defecto confirmado de sospecha, fallo de test y falta de especificación.

## Trazabilidad
Cada aserción debe enlazar a un requisito/criterio validado o marcarse explícitamente como chequeo exploratorio. Versionar las evaluaciones y sus fuentes.

## Cálculo del IPA local

| Criterio | Puntos |
| --- | --- |
| Aplicación y autorización | 5 por registro completo de identificación y 10 por autorización declarada en todos los entornos. |
| Documentación | 5 por al menos un archivo cargado, 10 por texto procesado, 5 por requisitos con criterios explícitos verificables y 10 por revisión de una versión procesada. |
| Accesos y permisos | 15 por modos y matrices declarados, 5 por referencias de cuentas de prueba. Peso 0 si todos los entornos son públicos. |
| Datos de prueba | 10 por datos sintéticos o semillas y 10 por estrategia de limpieza en todos los entornos. |
| Alcance | 15 si todas las URL base están dentro del alcance permitido y fuera de las exclusiones. |

El cálculo divide los puntos entre los pesos aplicables, multiplica por 100 y redondea al entero más cercano. La autorización ausente, el alcance incompleto o un proyecto archivado dejan el resultado en **Bloqueado** aunque tenga puntos disponibles. Las referencias de acceso, la autorización y el alcance se evalúan como declaraciones registradas. Los recuentos de cargados, procesados y validados son acumulativos para las versiones vigentes. El estado declarado identifica un registro sin archivo cargado.

**Verificable** indica que el análisis encontró un requisito explícito con un criterio asociado que no quedó pendiente. Una revisión manual valida el documento y su versión. Los hallazgos inferidos, ambiguos o contradictorios conservan su estado pendiente. Cada análisis conserva una evaluación con sus señales y fuentes. La consulta muestra el IPA actualizado con las revisiones y los datos guardados del proyecto.

