import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { DataSource, IsNull } from "typeorm";
import { AppModule } from "../src/app.module";
import { AdminRole, AdminUser } from "../src/admin/entities/admin-user.entity";
import { ProductMedia } from "../src/products/entities/product-media.entity";
import { Product } from "../src/products/entities/product.entity";
import { ProductVariant } from "../src/products/entities/product-variant.entity";

describe("admin variant media (PostgreSQL)", () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;

  const headers = () => ({ Authorization: `Bearer ${token}` });
  const mediaUrl = (name: string) => `https://example.test/${name}.jpg`;

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
      "TRUNCATE admin_audit_logs, admin_sessions, admin_users, refund_operations, inventory_movements, payments, payment_preferences, order_items, orders, inventory, product_media, product_variants, products RESTART IDENTITY CASCADE",
    );
    const admin = await ds.getRepository(AdminUser).save({
      email: "variant-media@example.test",
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

  async function product(name = "Media product") {
    return ds.getRepository(Product).save({
      name,
      slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${crypto.randomUUID()}`,
      active: true,
      sortOrder: 0,
    });
  }

  async function variant(productId: string, name: string) {
    return ds.getRepository(ProductVariant).save({
      productId,
      sku: `${name.toUpperCase()}-${crypto.randomUUID()}`,
      name,
      color: null,
      size: null,
      priceInCents: 100,
      active: true,
      sortOrder: 0,
      lowStockThreshold: null,
    });
  }

  function createMedia(
    productId: string,
    name: string,
    extra: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/admin/products/${productId}/media`)
      .set(headers())
      .send({ url: mediaUrl(name), alt: name, ...extra });
  }

  async function mediaById(id: string) {
    return ds.getRepository(ProductMedia).findOneByOrFail({ id });
  }

  it("creates general media when variantId is omitted or explicitly null", async () => {
    const p = await product();
    const omitted = await createMedia(p.id, "general-omitted").expect(201);
    const explicit = await createMedia(p.id, "general-null", {
      variantId: null,
    }).expect(201);

    expect(omitted.body).toMatchObject({ productId: p.id, variantId: null });
    expect(explicit.body).toMatchObject({ productId: p.id, variantId: null });
    expect(await mediaById(omitted.body.id)).toMatchObject({ variantId: null });
    expect(await mediaById(explicit.body.id)).toMatchObject({
      variantId: null,
    });
  });

  it("creates media for an owned variant and rejects an invalid variant UUID", async () => {
    const p = await product();
    const lila = await variant(p.id, "Lila");
    const created = await createMedia(p.id, "lila", {
      variantId: lila.id,
    }).expect(201);
    expect(created.body).toMatchObject({ productId: p.id, variantId: lila.id });

    await createMedia(p.id, "invalid", { variantId: "not-a-uuid" }).expect(400);
  });

  it("rejects a foreign variant without persisting media", async () => {
    const productA = await product("Product A");
    const productB = await product("Product B");
    const foreign = await variant(productB.id, "Foreign");

    const response = await createMedia(productA.id, "foreign", {
      variantId: foreign.id,
    }).expect(409);
    expect(response.body).toMatchObject({
      code: "VARIANT_NOT_BELONG_TO_PRODUCT",
    });
    expect(
      await ds.getRepository(ProductMedia).countBy({ productId: productA.id }),
    ).toBe(0);
  });

  it("moves media general to variant, variant to general, and between owned variants", async () => {
    const p = await product();
    const lila = await variant(p.id, "Lila");
    const negra = await variant(p.id, "Negra");
    const created = await createMedia(p.id, "movable").expect(201);

    const toLila = await request(app.getHttpServer())
      .patch(`/api/v1/admin/product-media/${created.body.id}`)
      .set(headers())
      .send({ variantId: lila.id })
      .expect(200);
    expect(toLila.body.variantId).toBe(lila.id);

    const toGeneral = await request(app.getHttpServer())
      .patch(`/api/v1/admin/product-media/${created.body.id}`)
      .set(headers())
      .send({ variantId: null })
      .expect(200);
    expect(toGeneral.body.variantId).toBeNull();

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/product-media/${created.body.id}`)
      .set(headers())
      .send({ variantId: lila.id })
      .expect(200);
    const toNegra = await request(app.getHttpServer())
      .patch(`/api/v1/admin/product-media/${created.body.id}`)
      .set(headers())
      .send({ variantId: negra.id })
      .expect(200);
    expect(toNegra.body.variantId).toBe(negra.id);
  });

  it("rejects moving media to a foreign variant and leaves the original scope intact", async () => {
    const productA = await product("Product A");
    const productB = await product("Product B");
    const lila = await variant(productA.id, "Lila");
    const foreign = await variant(productB.id, "Foreign");
    const created = await createMedia(productA.id, "owned", {
      variantId: lila.id,
    }).expect(201);

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/admin/product-media/${created.body.id}`)
      .set(headers())
      .send({ variantId: foreign.id })
      .expect(409);
    expect(response.body).toMatchObject({
      code: "VARIANT_NOT_BELONG_TO_PRODUCT",
    });
    expect((await mediaById(created.body.id)).variantId).toBe(lila.id);
  });

  it("keeps exactly one general cover in the general scope", async () => {
    const p = await product();
    const first = await createMedia(p.id, "general-a", {
      isCover: true,
    }).expect(201);
    const second = await createMedia(p.id, "general-b", {
      isCover: true,
    }).expect(201);
    const general = await ds
      .getRepository(ProductMedia)
      .findBy({ productId: p.id, variantId: IsNull() });

    expect(
      general.filter((media) => media.isCover).map((media) => media.id),
    ).toEqual([second.body.id]);
    expect((await mediaById(first.body.id)).isCover).toBe(false);
  });

  it("isolates covers per variant and from the general scope", async () => {
    const p = await product();
    const lila = await variant(p.id, "Lila");
    const negra = await variant(p.id, "Negra");
    const general = await createMedia(p.id, "general", {
      isCover: true,
    }).expect(201);
    const lilaA = await createMedia(p.id, "lila-a", {
      variantId: lila.id,
      isCover: true,
    }).expect(201);
    const lilaB = await createMedia(p.id, "lila-b", {
      variantId: lila.id,
      isCover: true,
    }).expect(201);
    const negraCover = await createMedia(p.id, "negra", {
      variantId: negra.id,
      isCover: true,
    }).expect(201);

    expect((await mediaById(general.body.id)).isCover).toBe(true);
    expect((await mediaById(lilaA.body.id)).isCover).toBe(false);
    expect((await mediaById(lilaB.body.id)).isCover).toBe(true);
    expect((await mediaById(negraCover.body.id)).isCover).toBe(true);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/product-media/${lilaA.body.id}`)
      .set(headers())
      .send({ isCover: true })
      .expect(200);
    expect((await mediaById(general.body.id)).isCover).toBe(true);
    expect((await mediaById(lilaA.body.id)).isCover).toBe(true);
    expect((await mediaById(lilaB.body.id)).isCover).toBe(false);
    expect((await mediaById(negraCover.body.id)).isCover).toBe(true);

    const newGeneral = await createMedia(p.id, "general-new", {
      isCover: true,
    }).expect(201);
    expect((await mediaById(general.body.id)).isCover).toBe(false);
    expect((await mediaById(newGeneral.body.id)).isCover).toBe(true);
    expect((await mediaById(lilaA.body.id)).isCover).toBe(true);
    expect((await mediaById(negraCover.body.id)).isCover).toBe(true);
  });

  it("exposes only scoped media in the public catalog and orders each scope by sortOrder", async () => {
    const p = await product("Scoped product");
    const lila = await variant(p.id, "Lila");
    const negra = await variant(p.id, "Negra");
    const generalLate = await createMedia(p.id, "general-late", {
      sortOrder: 20,
    }).expect(201);
    const generalEarly = await createMedia(p.id, "general-early", {
      sortOrder: 10,
    }).expect(201);
    const lilaLate = await createMedia(p.id, "lila-late", {
      variantId: lila.id,
      sortOrder: 8,
    }).expect(201);
    const lilaEarly = await createMedia(p.id, "lila-early", {
      variantId: lila.id,
      sortOrder: 2,
    }).expect(201);
    const negraMedia = await createMedia(p.id, "negra", {
      variantId: negra.id,
      sortOrder: 1,
    }).expect(201);

    const response = await request(app.getHttpServer())
      .get("/api/v1/products")
      .expect(200);
    const catalogProduct = response.body.find(
      (item: { id: string }) => item.id === p.id,
    );
    expect(
      catalogProduct.media.map((media: { id: string }) => media.id),
    ).toEqual([generalEarly.body.id, generalLate.body.id]);
    const catalogLila = catalogProduct.variants.find(
      (item: { id: string }) => item.id === lila.id,
    );
    const catalogNegra = catalogProduct.variants.find(
      (item: { id: string }) => item.id === negra.id,
    );
    expect(catalogLila.media.map((media: { id: string }) => media.id)).toEqual([
      lilaEarly.body.id,
      lilaLate.body.id,
    ]);
    expect(catalogNegra.media.map((media: { id: string }) => media.id)).toEqual(
      [negraMedia.body.id],
    );
    expect(catalogLila.media).not.toEqual(
      expect.arrayContaining(catalogProduct.media),
    );
  });

  it("treats historical media without a variantId as general media", async () => {
    const p = await product("Historical product");
    const historical = await ds.getRepository(ProductMedia).save({
      productId: p.id,
      variantId: null,
      url: mediaUrl("historical"),
      alt: "historical",
      sortOrder: 0,
      isCover: true,
    });

    const response = await request(app.getHttpServer())
      .get("/api/v1/products")
      .expect(200);
    const catalogProduct = response.body.find(
      (item: { id: string }) => item.id === p.id,
    );
    expect(catalogProduct.media).toEqual([
      expect.objectContaining({ id: historical.id, isCover: true }),
    ]);
  });
});
