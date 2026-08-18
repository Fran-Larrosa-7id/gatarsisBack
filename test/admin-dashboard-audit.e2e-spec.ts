import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AdminRole, AdminUser } from '../src/admin/entities/admin-user.entity';
import { AdminAuditLog } from '../src/admin/entities/admin-audit-log.entity';
import { Inventory } from '../src/inventory/entities/inventory.entity';
import { Order, OrderStatus } from '../src/orders/entities/order.entity';
import { Payment, PaymentProcessingStatus } from '../src/payments/entities/payment.entity';
import { MERCADO_PAGO_GATEWAY } from '../src/payments/mercado-pago.gateway';
import { Product } from '../src/products/entities/product.entity';
import { ProductVariant } from '../src/products/entities/product-variant.entity';

class FakeGateway { async createPreference(){ return { id:'x', init_point:'x' }; } async searchPreferencesByExternalReference(){ return []; } async getPayment(){ throw new Error('unused'); } async searchPaymentsByExternalReference(){ return []; } async refundPayment(){ throw new Error('unused'); } async listRefunds(){ return []; } validateWebhookSignature(){} }

describe('admin dashboard and audit (PostgreSQL)', () => {
  let app: INestApplication, ds: DataSource, token: string, admin: AdminUser;
  const headers = () => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => { process.env.DATABASE_NAME ??= 'gatarsis_test'; const module = await Test.createTestingModule({ imports:[AppModule] }).overrideProvider(MERCADO_PAGO_GATEWAY).useValue(new FakeGateway()).compile(); app=module.createNestApplication(); app.getHttpAdapter().getInstance().set('trust proxy', 1); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true })); await app.init(); ds=app.get(DataSource); await ds.runMigrations(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await ds.query('TRUNCATE admin_audit_logs, admin_sessions, admin_users, refund_operations, inventory_movements, payments, payment_preferences, order_items, orders, inventory, product_variants, products RESTART IDENTITY CASCADE'); admin=await ds.getRepository(AdminUser).save({ email:'dashboard@example.test', passwordHash:await bcrypt.hash('CorrectHorseBatteryStaple!', 4), role:AdminRole.ADMIN, active:true, lastLoginAt:null }); token=(await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('X-Forwarded-For', crypto.randomUUID()).send({ email:admin.email, password:'CorrectHorseBatteryStaple!' })).body.accessToken; });
  async function order(status: OrderStatus, paidAt: Date | null = null) { return ds.getRepository(Order).save({ status, idempotencyKey:crypto.randomUUID(), requestFingerprint:null, subtotalInCents:100, totalInCents:100, reservationExpiresAt:new Date(), paidAt }); }
  async function payment(orderId: string, id: string, processingStatus: PaymentProcessingStatus, reviewResolvedAt: Date | null) { return ds.getRepository(Payment).save({ orderId, provider:'mercado_pago', providerPaymentId:id, providerStatus:'pending', providerStatusDetail:null, processingStatus, transactionAmountInCents:100, currencyId:'ARS', externalReference:null, paymentMethodId:null, paymentTypeId:null, dateCreated:null, dateApproved:null, dateLastUpdated:null, reviewReason:null, reviewResolvedAt, reviewResolvedByAdminId:null, reviewResolution:null, reviewNote:null }); }
  async function inventory(stockOnHand: number, reservedStock: number, threshold: number | null) { const p=await ds.getRepository(Product).save({ slug:crypto.randomUUID(), name:'P', active:true }); const v=await ds.getRepository(ProductVariant).save({ productId:p.id, sku:crypto.randomUUID(), name:'V', color:null, size:null, priceInCents:100, active:true, lowStockThreshold:threshold }); return ds.getRepository(Inventory).save({ variantId:v.id, stockOnHand, reservedStock }); }

  it('returns UTC dashboard aggregates without loading entity collections', async () => {
    await ds.getRepository(Product).save({ slug:'inactive-'+crypto.randomUUID(), name:'Inactive', active:false });
    await inventory(5, 3, 2); await inventory(4, 4, 1); await inventory(10, 0, 2);
    await order(OrderStatus.AWAITING_PAYMENT); await order(OrderStatus.PAYMENT_PENDING); const paid=await order(OrderStatus.PAID, new Date()); await order(OrderStatus.EXPIRED);
    await payment(paid.id, 'dashboard-review-open', PaymentProcessingStatus.REQUIRES_REVIEW, null); await payment(paid.id, 'dashboard-review-closed', PaymentProcessingStatus.REQUIRES_REVIEW, new Date());
    const response=await request(app.getHttpServer()).get('/api/v1/admin/dashboard').set(headers()).expect(200);
    expect(response.body).toEqual({ products:{active:3,inactive:1}, inventory:{lowStockVariants:1,outOfStockVariants:1,reservedUnits:7}, orders:{awaitingPayment:1,paymentPending:1,paidToday:1,expiredToday:1}, payments:{openReviews:1} });
  });

  it('requires an authenticated admin for read endpoints', async () => { await request(app.getHttpServer()).get('/api/v1/admin/dashboard').expect(401); await request(app.getHttpServer()).get('/api/v1/admin/audit').expect(401); });

  it('filters, paginates and exposes only the audit read model', async () => {
    const other=await ds.getRepository(AdminUser).save({ email:'other@example.test', passwordHash:'not-exposed', role:AdminRole.ADMIN, active:true, lastLoginAt:null });
    await ds.getRepository(AdminAuditLog).save([{ adminUserId:admin.id, action:'PRODUCT_UPDATED', entityType:'product', entityId:'one', metadata:{safe:true} }, { adminUserId:other.id, action:'PRODUCT_UPDATED', entityType:'product', entityId:'two', metadata:{safe:false} }, { adminUserId:null, action:'INVENTORY_ADJUSTED', entityType:'inventory', entityId:'three', metadata:null }]);
    const filtered=await request(app.getHttpServer()).get(`/api/v1/admin/audit?action=PRODUCT_UPDATED&adminUserId=${admin.id}&entityType=product&entityId=one&page=1&pageSize=1&sort=createdAt:asc`).set(headers()).expect(200);
    expect(filtered.body.pagination).toEqual({page:1,pageSize:1,totalItems:1,totalPages:1}); expect(filtered.body.items[0]).toEqual(expect.objectContaining({ action:'PRODUCT_UPDATED', entityType:'product', entityId:'one', metadata:{safe:true}, adminUser:{id:admin.id,email:admin.email} })); expect(filtered.body.items[0]).not.toHaveProperty('passwordHash');
    const nullAdmin=await request(app.getHttpServer()).get('/api/v1/admin/audit?action=INVENTORY_ADJUSTED').set(headers()).expect(200); expect(nullAdmin.body.items[0].adminUser).toBeNull();
    await request(app.getHttpServer()).get('/api/v1/admin/audit?dateFrom=2027-01-02T00:00:00.000Z&dateTo=2027-01-01T00:00:00.000Z').set(headers()).expect(400).expect(({body})=>expect(body.code).toBe('INVALID_DATE_RANGE'));
    await request(app.getHttpServer()).get('/api/v1/admin/audit?pageSize=101').set(headers()).expect(400);
    await request(app.getHttpServer()).get('/api/v1/admin/audit?sort=entityId:asc').set(headers()).expect(400);
  });
});
