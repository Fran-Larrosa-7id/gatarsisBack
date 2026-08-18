import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Inventory } from '../src/inventory/entities/inventory.entity';
import { ProductVariant } from '../src/products/entities/product-variant.entity';
import { Product } from '../src/products/entities/product.entity';

describe('checkout reservations (PostgreSQL)', () => {
  let app: INestApplication; let dataSource: DataSource;
  beforeAll(async () => {
    process.env.DATABASE_NAME ??= 'gatarsis_test';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); dataSource = app.get(DataSource); await dataSource.runMigrations();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await dataSource.query('TRUNCATE inventory_movements, order_items, orders, inventory, product_variants, products RESTART IDENTITY CASCADE'); });
  async function variant(stock: number, suffix = 'A') {
    const product = await dataSource.getRepository(Product).save({ slug: `test-${suffix}-${crypto.randomUUID()}`, name: 'Test product', active: true });
    const value = await dataSource.getRepository(ProductVariant).save({ productId: product.id, sku: `SKU-${suffix}-${crypto.randomUUID()}`, name: 'Test variant', priceInCents: 1000, active: true, color: null, size: null });
    await dataSource.getRepository(Inventory).save({ variantId: value.id, stockOnHand: stock, reservedStock: 0 }); return value;
  }
  it('reserves at most one unit with 20 concurrent requests', async () => {
    const v = await variant(1); const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => request(app.getHttpServer()).post('/api/v1/checkout/reserve').set('Idempotency-Key', `concurrent-${index}`).send({ items: [{ variantId: v.id, quantity: 1 }] })));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1); expect(responses.filter((response) => response.status === 409 && response.body.code === 'OUT_OF_STOCK')).toHaveLength(19);
    expect(await dataSource.getRepository(Inventory).findOneByOrFail({ variantId: v.id })).toMatchObject({ stockOnHand: 1, reservedStock: 1 });
  });
  it('is all-or-nothing for a multi-item cart', async () => {
    const available = await variant(1, 'available'); const out = await variant(0, 'out');
    await request(app.getHttpServer()).post('/api/v1/checkout/reserve').set('Idempotency-Key', 'multi-item').send({ items: [{ variantId: available.id, quantity: 1 }, { variantId: out.id, quantity: 1 }] }).expect(409);
    expect((await dataSource.getRepository(Inventory).findOneByOrFail({ variantId: available.id })).reservedStock).toBe(0);
  });
  it('does not reserve stock twice for concurrent equal idempotency keys', async () => {
    const v = await variant(2); const responses = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post('/api/v1/checkout/reserve').set('Idempotency-Key', 'same-key').send({ items: [{ variantId: v.id, quantity: 1 }] })));
    expect(responses.map((response) => response.status)).toEqual([201, 201]); expect((await dataSource.getRepository(Inventory).findOneByOrFail({ variantId: v.id })).reservedStock).toBe(1);
  });
});
