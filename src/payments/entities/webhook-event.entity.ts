import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
export enum WebhookEventStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  PROCESSED = "PROCESSED",
  RETRY = "RETRY",
  DEAD_LETTER = "DEAD_LETTER",
}
@Entity({ name: "webhook_events" })
@Index(["provider", "providerEventId"], {
  unique: true,
  where: "provider_event_id IS NOT NULL",
})
export class WebhookEvent {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "varchar", default: "mercado_pago" }) provider!: string;
  @Column({ name: "provider_event_id", type: "varchar", nullable: true })
  providerEventId!: string | null;
  @Index()
  @Column({ name: "provider_resource_id", type: "varchar" })
  providerResourceId!: string;
  @Column({ type: "varchar" }) type!: string;
  @Column({ type: "varchar", nullable: true }) action!: string | null;
  @Column({ name: "request_id", type: "varchar", nullable: true }) requestId!:
    | string
    | null;
  @Column({ type: "enum", enum: WebhookEventStatus })
  status!: WebhookEventStatus;
  @Column({ type: "integer", default: 0 }) attempts!: number;
  @Column({ name: "next_attempt_at", type: "timestamptz", nullable: true })
  nextAttemptAt!: Date | null;
  @Column({ name: "last_error", type: "varchar", nullable: true }) lastError!:
    | string
    | null;
  @Column({ type: "jsonb", nullable: true }) payload!: Record<
    string,
    unknown
  > | null;
  @Column({ name: "received_at", type: "timestamptz" }) receivedAt!: Date;
  @Column({ name: "processed_at", type: "timestamptz", nullable: true })
  processedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
