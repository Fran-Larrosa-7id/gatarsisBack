import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { Order } from "../orders/entities/order.entity";
import { OrderItem } from "../orders/entities/order-item.entity";
import {
  Payment,
  PaymentProcessingStatus,
} from "../payments/entities/payment.entity";
import { PaymentPreference } from "../payments/entities/payment-preference.entity";
import { InventoryMovement } from "../inventory/entities/inventory-movement.entity";
import { AdminAuditLog } from "./entities/admin-audit-log.entity";
import { AdminRequest } from "./admin-auth.guard";
import { DomainError } from '../common/domain-error';
import { AdminOrderListQueryDto, AdminPaymentListQueryDto, AdminPaymentReviewListQueryDto, ResolveReviewDto } from './admin-orders-payments.dto';
import { toAdminMovement, toAdminOrderItem, toAdminOrderListItem, toAdminPaymentDetail, toAdminPaymentListItem, toAdminPreference } from './admin-orders-payments.responses';
import { RefundOperation } from '../payments/entities/refund-operation.entity';
@Controller("admin")
export class AdminOrdersPaymentsController {
  constructor(private ds: DataSource) {}
  private page(q: any) {
    const p = Math.max(1, +q.page || 1),
      s = Math.min(100, Math.max(1, +q.pageSize || 20));
    return {
      p,
      s,
      pagination: (total: number) => ({
        page: p,
        pageSize: s,
        totalItems: total,
        totalPages: Math.ceil(total / s),
      }),
    };
  }
  private validateDateRange(q: { dateFrom?: string; dateTo?: string }) {
    if (q.dateFrom && q.dateTo && new Date(q.dateFrom) > new Date(q.dateTo)) throw new DomainError('INVALID_DATE_RANGE', 'dateFrom no puede ser posterior a dateTo.', undefined, 400);
  }
  @Get("orders") async orders(@Query() q: AdminOrderListQueryDto) {
    this.validateDateRange(q);
    const { p, s, pagination } = this.page(q);
    const qb = this.ds.getRepository(Order).createQueryBuilder("o");
    if (q.status) qb.andWhere("o.status=:status", { status: q.status });
    if (q.orderId) qb.andWhere("o.id=:id", { id: q.orderId });
    if (q.dateFrom) qb.andWhere("o.created_at >= :from", { from: q.dateFrom });
    if (q.dateTo) qb.andWhere("o.created_at <= :to", { to: q.dateTo });
    if (q.providerPaymentId)
      qb.innerJoin(Payment, "filter_payment", "filter_payment.order_id = o.id AND filter_payment.provider_payment_id = :providerPaymentId", { providerPaymentId: q.providerPaymentId });
    const [items, total] = await qb
      .orderBy("o.created_at", "DESC")
      .skip((p - 1) * s)
      .take(s)
      .getManyAndCount();
    return {
      items: await Promise.all(items.map(async (o) => toAdminOrderListItem(o, Number((await this.ds.getRepository(OrderItem).createQueryBuilder("item").select("COALESCE(SUM(item.quantity), 0)", "total").where("item.order_id = :orderId", { orderId: o.id }).getRawOne<{ total: string }>())!.total)))),
      pagination: pagination(total),
    };
  }
  @Get("orders/:id") async order(@Param("id", new ParseUUIDPipe()) id: string) {
    const o = await this.ds
      .getRepository(Order)
      .findOne({ where: { id }, relations: { items: true } });
    if (!o) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    const preference = await this.ds
        .getRepository(PaymentPreference)
        .findOneBy({ orderId: id });
    const payments = await this.ds.getRepository(Payment).findBy({ orderId: id });
    const movements = await this.ds
        .getRepository(InventoryMovement)
        .createQueryBuilder("m")
        .where("m.order_id=:id", { id })
        .getMany();
    return { order: { id: o.id, status: o.status, totalInCents: o.totalInCents, createdAt: o.createdAt, reservationExpiresAt: o.reservationExpiresAt, paidAt: o.paidAt ?? null }, items: o.items.map(toAdminOrderItem), paymentPreference: toAdminPreference(preference), payments: payments.map(toAdminPaymentDetail), inventoryMovements: movements.map(toAdminMovement) };
  }
  @Get("payments") async payments(@Query() q: AdminPaymentListQueryDto & { onlyUnresolvedReviews?: boolean }) {
    this.validateDateRange(q);
    const { p, s, pagination } = this.page(q);
    const qb = this.ds.getRepository(Payment).createQueryBuilder("p");
    if (q.processingStatus)
      qb.andWhere("p.processing_status=:x", { x: q.processingStatus });
    if (q.providerStatus)
      qb.andWhere("p.provider_status=:x", { x: q.providerStatus });
    if (q.orderId) qb.andWhere("p.order_id=:x", { x: q.orderId });
    if (q.providerPaymentId)
      qb.andWhere("p.provider_payment_id=:x", { x: q.providerPaymentId });
    if (q.dateFrom) qb.andWhere("p.created_at >= :from", { from: q.dateFrom });
    if (q.dateTo) qb.andWhere("p.created_at <= :to", { to: q.dateTo });
    if ((q as AdminPaymentListQueryDto & { onlyUnresolvedReviews?: boolean }).onlyUnresolvedReviews)
      qb.andWhere("p.review_resolved_at IS NULL");
    const [items, total] = await qb
      .orderBy("p.created_at", "DESC")
      .skip((p - 1) * s)
      .take(s)
      .getManyAndCount();
    return { items: items.map(toAdminPaymentListItem), pagination: pagination(total) };
  }
  @Get("payments/review") review(@Query() q: AdminPaymentReviewListQueryDto) {
    return this.payments({
      ...q,
      processingStatus: PaymentProcessingStatus.REQUIRES_REVIEW,
      onlyUnresolvedReviews: true,
    });
  }
  @Get("payments/:id") async payment(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const p = await this.ds.getRepository(Payment).findOneBy({ id });
    if (!p) throw new NotFoundException({ code: "PAYMENT_NOT_FOUND" });
    const order = await this.ds.getRepository(Order).findOneBy({ id: p.orderId });
    const refund = await this.ds.getRepository(RefundOperation).findOne({ where: { paymentId: p.id }, order: { createdAt: 'DESC' } });
    return { payment: toAdminPaymentDetail(p), order: order ? { id: order.id, status: order.status, totalInCents: order.totalInCents, createdAt: order.createdAt, paidAt: order.paidAt ?? null } : null, refund: refund ? { id: refund.id, paymentId: refund.paymentId, orderId: refund.orderId, amountInCents: refund.amountInCents, status: refund.status, providerRefundId: refund.providerRefundId ?? null, createdAt: refund.createdAt, completedAt: refund.completedAt ?? null } : null };
  }
  @Post("payments/:id/review/resolve") async resolve(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() b: ResolveReviewDto,
    @Req() r: AdminRequest,
  ) {
    if (
      !b.note?.trim() ||
      !["ACKNOWLEDGED_NO_ACTION", "MANUAL_INVESTIGATION_COMPLETE"].includes(
        b.resolution,
      )
    )
      throw new DomainError("PAYMENT_REVIEW_NOT_ALLOWED", "La resolución de review no está permitida.", undefined, 409);
    return this.ds.transaction(async (m) => {
      const p = await m.findOneBy(Payment, { id });
      if (!p) throw new NotFoundException({ code: "PAYMENT_NOT_FOUND" });
      if (
        p.processingStatus !== PaymentProcessingStatus.REQUIRES_REVIEW ||
        p.reviewResolvedAt
      )
        throw new DomainError("PAYMENT_REVIEW_NOT_ALLOWED", "El pago no admite resolución de review.", undefined, 409);
      Object.assign(p, {
        reviewResolvedAt: new Date(),
        reviewResolvedByAdminId: r.admin!.id,
        reviewResolution: b.resolution,
        reviewNote: b.note.trim(),
      });
      await m.save(p);
      await m.save(AdminAuditLog, {
        adminUserId: r.admin!.id,
        action: "PAYMENT_REVIEW_RESOLVED",
        entityType: "PAYMENT",
        entityId: p.id,
        metadata: {
          paymentId: p.id,
          providerPaymentId: p.providerPaymentId,
          orderId: p.orderId,
          resolution: b.resolution,
        },
      });
      return toAdminPaymentDetail(p);
    });
  }
}
