import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
export enum RefundOperationStatus {
  REQUESTING = "REQUESTING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  REQUIRES_REVIEW = "REQUIRES_REVIEW",
}
@Entity({ name: "refund_operations" })
@Check('"amount_in_cents" > 0')
export class RefundOperation {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index() @Column({ name: "payment_id", type: "uuid" }) paymentId!: string;
  @Index() @Column({ name: "order_id", type: "uuid" }) orderId!: string;
  @Column({ name: "admin_user_id", type: "uuid" }) adminUserId!: string;
  @Column({ name: "idempotency_key", unique: true }) idempotencyKey!: string;
  @Column({ name: "amount_in_cents", type: "integer" }) amountInCents!: number;
  @Column({ type: "text" }) reason!: string;
  @Index()
  @Column({ type: "enum", enum: RefundOperationStatus })
  status!: RefundOperationStatus;
  @Column({ name: "provider_refund_id", type: "varchar", nullable: true })
  providerRefundId!: string | null;
  @Column({ name: "last_error", type: "text", nullable: true }) lastError!:
    | string
    | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt!: Date | null;
}
