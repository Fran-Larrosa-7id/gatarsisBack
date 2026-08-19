import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export enum PaymentPreferenceStatus {
  CREATING = "CREATING",
  READY = "READY",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED",
  REQUIRES_REVIEW = "REQUIRES_REVIEW",
}
@Entity({ name: "payment_preferences" })
export class PaymentPreference {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true })
  @Column({ name: "order_id", type: "uuid" })
  orderId!: string;
  @Column({ type: "varchar", default: "mercado_pago" }) provider!: string;
  @Index({ unique: true })
  @Column({ name: "provider_preference_id", type: "varchar", nullable: true })
  providerPreferenceId!: string | null;
  @Column({ type: "enum", enum: PaymentPreferenceStatus })
  status!: PaymentPreferenceStatus;
  @Column({ name: "init_point", type: "text", nullable: true }) initPoint!:
    | string
    | null;
  @Column({ name: "last_error_code", type: "varchar", nullable: true })
  lastErrorCode!: string | null;
  @Column({ name: "last_error_at", type: "timestamptz", nullable: true })
  lastErrorAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
  @Column({ name: "ready_at", type: "timestamptz", nullable: true })
  readyAt!: Date | null;
  @Column({ name: "last_reconciliation_at", type: "timestamptz", nullable: true })
  lastReconciliationAt!: Date | null;
}
