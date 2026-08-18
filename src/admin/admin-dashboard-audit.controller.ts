import { Controller, Get, Query } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { DomainError } from '../common/domain-error';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { Payment, PaymentProcessingStatus } from '../payments/entities/payment.entity';
import { Product } from '../products/entities/product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { AdminUser } from './entities/admin-user.entity';
import { AuditQueryDto } from './admin-dashboard-audit.dto';
@Controller('admin') export class AdminDashboardAuditController {
  constructor(private readonly ds: DataSource) {}
  @Get('dashboard') async dashboard() {
    const now=new Date(), start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
    const [products,inv,orders,reviews]=await Promise.all([
      this.ds.getRepository(Product).createQueryBuilder('p').select('COUNT(*) FILTER (WHERE p.active)','a').addSelect('COUNT(*) FILTER (WHERE NOT p.active)','i').getRawOne(),
      this.ds.getRepository(Inventory).createQueryBuilder('i').innerJoin(ProductVariant,'v','v.id=i.variant_id').select('COUNT(*) FILTER (WHERE i.stock_on_hand-i.reserved_stock <= v.low_stock_threshold AND i.stock_on_hand-i.reserved_stock > 0)','l').addSelect('COUNT(*) FILTER (WHERE i.stock_on_hand-i.reserved_stock<=0)','o').addSelect('COALESCE(SUM(i.reserved_stock),0)','r').getRawOne(),
      this.ds.getRepository(Order).createQueryBuilder('o').select('COUNT(*) FILTER (WHERE o.status=:a)','a').addSelect('COUNT(*) FILTER (WHERE o.status=:p)','p').addSelect('COUNT(*) FILTER (WHERE o.status=:paid AND o.paid_at>=:start)','pd').addSelect('COUNT(*) FILTER (WHERE o.status=:expired AND o.updated_at>=:start)','e').setParameters({a:OrderStatus.AWAITING_PAYMENT,p:OrderStatus.PAYMENT_PENDING,paid:OrderStatus.PAID,expired:OrderStatus.EXPIRED,start}).getRawOne(),
      this.ds.getRepository(Payment).countBy({processingStatus:PaymentProcessingStatus.REQUIRES_REVIEW,reviewResolvedAt:IsNull()}),
    ]); return {products:{active:Number(products.a),inactive:Number(products.i)},inventory:{lowStockVariants:Number(inv.l),outOfStockVariants:Number(inv.o),reservedUnits:Number(inv.r)},orders:{awaitingPayment:Number(orders.a),paymentPending:Number(orders.p),paidToday:Number(orders.pd),expiredToday:Number(orders.e)},payments:{openReviews:reviews}};
  }
  @Get('audit') async audit(@Query() q:AuditQueryDto) { if(q.dateFrom&&q.dateTo&&new Date(q.dateFrom)>new Date(q.dateTo))throw new DomainError('INVALID_DATE_RANGE','dateFrom no puede ser posterior a dateTo.',undefined,400);const page=q.page??1,size=q.pageSize??20,qb=this.ds.getRepository(AdminAuditLog).createQueryBuilder('a').leftJoin(AdminUser,'u','u.id=a.admin_user_id').select(['a.id AS id','a.created_at AS "createdAt"','a.action AS action','a.entity_type AS "entityType"','a.entity_id AS "entityId"','a.metadata AS metadata','u.id AS "adminUserId"','u.email AS "adminUserEmail"']);if(q.action)qb.andWhere('a.action=:action',{action:q.action});if(q.adminUserId)qb.andWhere('a.admin_user_id=:adminUserId',{adminUserId:q.adminUserId});if(q.entityType)qb.andWhere('a.entity_type=:entityType',{entityType:q.entityType});if(q.entityId)qb.andWhere('a.entity_id=:entityId',{entityId:q.entityId});if(q.dateFrom)qb.andWhere('a.created_at>=:dateFrom',{dateFrom:q.dateFrom});if(q.dateTo)qb.andWhere('a.created_at<=:dateTo',{dateTo:q.dateTo});const total=await qb.clone().getCount();const rows=await qb.orderBy('a.created_at',q.sort==='createdAt:asc'?'ASC':'DESC').skip((page-1)*size).take(size).getRawMany<{id:string;createdAt:Date;action:string;adminUserId:string|null;adminUserEmail:string|null;entityType:string|null;entityId:string|null;metadata:Record<string,unknown>|null}>();return {items:rows.map(a=>({id:a.id,createdAt:a.createdAt,action:a.action,adminUser:a.adminUserId?{id:a.adminUserId,email:a.adminUserEmail}:null,entityType:a.entityType,entityId:a.entityId,metadata:a.metadata})),pagination:{page,pageSize:size,totalItems:total,totalPages:Math.ceil(total/size)}}; }
}
