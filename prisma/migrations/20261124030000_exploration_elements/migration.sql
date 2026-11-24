-- Inventario de elementos interactivos capturado por el crawler de
-- Exploración (botones, links, inputs) con su mejor selector disponible.
-- Nullable: filas existentes y exploraciones viejas quedan sin inventario,
-- se degradan con gracia en el consumidor (apps/api/src/automation/
-- element-inventory.ts).
ALTER TABLE "ExplorationPage"
  ADD COLUMN "elements" JSONB;
