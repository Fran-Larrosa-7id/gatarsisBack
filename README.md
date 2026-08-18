# Gatarsis Commerce Backend

NestJS + PostgreSQL + TypeORM para catálogo, stock, reservas temporales y órdenes. El backend es la fuente de verdad: una variante nunca puede reservarse o venderse por encima de su stock.

## Desarrollo local

1. Copiá `.env.example` a `.env` y definí credenciales locales.
2. Iniciá PostgreSQL: `docker compose up -d`.
3. Instalá dependencias: `npm install`.
4. Aplicá el schema: `npm run db:migration:run`.
5. Opcionalmente insertá sólo datos de prueba: `npm run db:seed`.
6. Ejecutá: `npm run start:dev`.

La API queda bajo `/api/v1`. Endpoints públicos: `GET /health`, `GET /products`, `GET /products/:slug` y `POST /checkout/reserve`.

## Reserva

`POST /api/v1/checkout/reserve` exige el header `Idempotency-Key` y un body `{ "items": [{ "variantId": "uuid", "quantity": 1 }] }`. Precios y snapshots se resuelven desde PostgreSQL. La misma clave con el mismo carrito devuelve la orden original; con otro carrito da `409 IDEMPOTENCY_CONFLICT`.

El inventario conserva `stockOnHand` y `reservedStock`; `availableStock = stockOnHand - reservedStock` se deriva y nunca se persiste. La reserva ejecuta un `UPDATE ... WHERE stock_on_hand - reserved_stock >= quantity` dentro de una transacción, por lo que 20 compradores simultáneos por la última unidad producen exactamente un ganador.

Las órdenes `AWAITING_PAYMENT` expiran según `STOCK_RESERVATION_MINUTES` (15 por defecto). El scheduler libera reservas de forma transaccional e idempotente. `InventoryMovement` registra RESERVE, RELEASE, RESTOCK y ADJUSTMENT.

## Tests

Los e2e usan PostgreSQL real y requieren una base aislada `gatarsis_test` accesible mediante las mismas variables de entorno, cambiando `DATABASE_NAME`. Ejecutá las migraciones contra esa DB y luego `npm run test:e2e`. Cubren concurrencia 20×, rollback multi-item e idempotencia concurrente. Docker Desktop debe estar iniciado.

## Fuera de esta fase

Mercado Pago, pagos, panel/admin y auth, cuentas de comprador, carrito persistido, envío, descuentos, Redis, WebSockets y colas.
