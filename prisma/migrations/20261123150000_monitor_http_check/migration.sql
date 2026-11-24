ALTER TABLE "Monitor"
  ADD COLUMN "method" TEXT NOT NULL DEFAULT 'GET',
  ADD COLUMN "minStatus" INTEGER NOT NULL DEFAULT 200,
  ADD COLUMN "maxStatus" INTEGER NOT NULL DEFAULT 399,
  ADD CONSTRAINT "Monitor_http_check"
    CHECK ("method" IN ('GET', 'HEAD') AND "minStatus" >= 200 AND "maxStatus" <= 599 AND "minStatus" <= "maxStatus");
