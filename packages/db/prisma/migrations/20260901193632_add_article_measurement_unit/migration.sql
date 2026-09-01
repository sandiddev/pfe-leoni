-- CreateEnum
CREATE TYPE "MeasurementUnit" AS ENUM ('PIECE', 'METRE', 'KILOGRAM', 'LITRE');

-- AlterTable
ALTER TABLE "article" ADD COLUMN     "unit" "MeasurementUnit" NOT NULL DEFAULT 'PIECE';

