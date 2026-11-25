-- Layout opcional de los módulos prioritarios como mapa visual en la
-- pestaña Datos. Forma esperada: { "<nombreDelModulo>": { "x": 0..1, "y": 0..1 } }.
-- Un módulo sin entrada se renderiza en grid por defecto; borrar una entrada
-- devuelve el módulo a esa grid. No participa en QA, es ayuda visual del QA.
ALTER TABLE "Project"
  ADD COLUMN "modulesLayout" JSONB;
