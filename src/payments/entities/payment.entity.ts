import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
export enum PaymentProcessingStatus {
  RECEIVED = "RECEIVED",
  RECORDED = "RECORDED",
  APPLIED = "APPLIED",
  REQUIRES_REVIEW = "REQUIRES_REVIEW",
}
@Entity({ name: "payments" })
@Index(["provider", "providerPaymentId"], { unique: true })
export class Payment {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index() @Column({ name: "order_id", type: "uuid" }) orderId!: string;
  @Column({ type: "varchar", default: "mercado_pago" }) provider!: string;
  @Column({ name: "provider_payment_id", type: "varchar" })
  providerPaymentId!: string;
  @Column({ name: "provider_status", type: "varchar" }) providerStatus!: string;
  @Column({ name: "provider_status_detail", type: "varchar", nullable: true })
  providerStatusDetail!: string | null;
  @Column({
    name: "processing_status",
    type: "enum",
    enum: PaymentProcessingStatus,
  })
  processingStatus!: PaymentProcessingStatus;
  @Column({ name: "transaction_amount_in_cents", type: "integer" })
  transactionAmountInCents!: number;
  @Column({ name: "currency_id", type: "varchar" }) currencyId!: string;
  @Column({ name: "external_reference", type: "varchar", nullable: true })
  externalReference!: string | null;
  @Column({ name: "payment_method_id", type: "varchar", nullable: true })
  paymentMethodId!: string | null;
  @Column({ name: "payment_type_id", type: "varchar", nullable: true })
  paymentTypeId!: string | null;
  @Column({ name: "date_created", type: "timestamptz", nullable: true })
  dateCreated!: Date | null;
  @Column({ name: "date_approved", type: "timestamptz", nullable: true })
  dateApproved!: Date | null;
  @Column({ name: "date_last_updated", type: "timestamptz", nullable: true })
  dateLastUpdated!: Date | null;
  @Column({ name: 'review_reason', type: 'varchar', nullable: true }) reviewReason!: string | null;
  @Column({ name: 'review_resolved_at', type: 'timestamptz', nullable: true }) reviewResolvedAt!: Date | null;
  @Column({ name: 'review_resolved_by_admin_id', type: 'uuid', nullable: true }) reviewResolvedByAdminId!: string | null;
  @Column({ name: 'review_resolution', type: 'varchar', nullable: true }) reviewResolution!: string | null;
  @Column({ name: 'review_note', type: 'varchar', nullable: true }) reviewNote!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
