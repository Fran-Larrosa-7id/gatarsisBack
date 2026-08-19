import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { AdminRole, AdminUser } from "../src/admin/entities/admin-user.entity";
import { Inventory } from "../src/inventory/entities/inventory.entity";
import {
  InventoryMovement,
  InventoryMovementType,
} from "../src/inventory/entities/inventory-movement.entity";
import { Product } from "../src/products/entities/product.entity";
import { ProductVariant } from "../src/products/entities/product-variant.entity";

describe("admin variant initial stock (PostgreSQL)", () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;

  const headers = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.DATABASE_NAME ??= "gatarsis_test";
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    ds = app.get(DataSource);
    await ds.runMigrations();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await ds.query(
      "TRUNCATE admin_audit_logs, admin_sessions, admin_users, refund_operations, inventory_movements, payments, payment_preferences, order_fulfillments, order_items, orders, inventory, product_media, product_variants, products RESTART IDENTITY CASCADE",
    );
    const admin = await ds.getRepository(AdminUser).save({
      email: "initial-stock@example.test",
      passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple!", 4),
      role: AdminRole.ADMIN,
      active: true,
      lastLoginAt: null,
    });
    token = (
      await request(app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .set("X-Forwarded-For", crypto.randomUUID())
        .send({ email: admin.email, password: "CorrectHorseBatteryStaple!" })
    ).body.accessToken;
  });

  async function product() {
    return ds.getRepository(Product).save({
      name: "Initial stock product",
      slug: `initial-stock-${crypto.randomUUID()}`,
      active: true,
      sortOrder: 0,
    });
  }

  function createVariant(productId: string, initialStock: number) {
    return request(app.getHttpServer())
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set(headers())
      .send({
        name: "Lila",
        sku: `LILA-${crypto.randomUUID()}`,
        priceInCents: 1500,
        color: "Lila",
        size: "M",
        sortOrder: 0,
        lowStockThreshold: 2,
        active: true,
        initialStock,
      });
  }

  it("creates inventory with initial stock and a RESTOCK ledger entry", async () => {
    const p = await product();
    const response = await createVariant(p.id, 10).expect(201);
    const variantId = response.body.id as string;
    const inventory = await ds
      .getRepository(Inventory)
      .findOneByOrFail({ variantId });

    expect(inventory).toMatchObject({ stockOnHand: 10, reservedStock: 0 });
    expect(inventory.stockOnHand - inventory.reservedStock).toBe(10);
    expect(
      await ds.getRepository(InventoryMovement).findOneByOrFail({
        variantId,
        type: InventoryMovementType.RESTOCK,
      }),
    ).toMatchObject({
      orderId: null,
      onHandDelta: 10,
      reservedDelta: 0,
      reason: "Initial stock",
    });
  });

  it("creates zero stock inventory without a RESTOCK movement", async () => {
    const p = await product();
    const response = await createVariant(p.id, 0).expect(201);
    const variantId = response.body.id as string;

    expect(
      await ds.getRepository(Inventory).findOneByOrFail({ variantId }),
    ).toMatchObject({
      stockOnHand: 0,
      reservedStock: 0,
    });
    expect(
      await ds.getRepository(InventoryMovement).countBy({ variantId }),
    ).toBe(0);
  });

  it("rejects negative initial stock before creating a variant", async () => {
    const p = await product();
    await createVariant(p.id, -1).expect(400);
    expect(
      await ds.getRepository(ProductVariant).countBy({ productId: p.id }),
    ).toBe(0);
    expect(await ds.getRepository(Inventory).count()).toBe(0);
  });

  it("rolls back variant creation when inventory persistence fails", async () => {
    const p = await product();
    await ds.query(
      "CREATE FUNCTION fail_initial_inventory_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test initial inventory failure'; END; $$",
    );
    await ds.query(
      "CREATE TRIGGER fail_initial_inventory_test BEFORE INSERT ON inventory FOR EACH ROW EXECUTE FUNCTION fail_initial_inventory_test()",
    );
    try {
      await createVariant(p.id, 10).expect(500);
      expect(
        await ds.getRepository(ProductVariant).countBy({ productId: p.id }),
      ).toBe(0);
      expect(await ds.getRepository(Inventory).count()).toBe(0);
      expect(await ds.getRepository(InventoryMovement).count()).toBe(0);
    } finally {
      await ds.query(
        "DROP TRIGGER IF EXISTS fail_initial_inventory_test ON inventory",
      );
      await ds.query("DROP FUNCTION IF EXISTS fail_initial_inventory_test()");
    }
  });
});
