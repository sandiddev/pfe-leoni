-- Runs once, on first container start, before the app ever connects.
-- Integration tests need their own database so they can truncate freely
-- without destroying the seeded demo data used for the defence.
CREATE DATABASE leoni_replenishment_test OWNER leoni;
