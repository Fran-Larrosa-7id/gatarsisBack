import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { Raffle } from "./raffle.entity";
import { RafflePurchase } from "./raffle-purchase.entity";

export enum RaffleNumberStatus {
  AVAILABLE = "AVAILABLE",
  RESERVED = "RESERVED",
  SOLD = "SOLD",
}

@Entity({ name: "raffle_numbers" })
@Unique("UQ_raffle_numbers_raffle_number", ["raffleId", "number"])
@Index("IDX_raffle_numbers_raffle_status_number", [
  "raffleId",
  "status",
  "number",
])
@Index("IDX_raffle_numbers_purchase_id", ["rafflePurchaseId"])
@Check("CHK_raffle_numbers_number_range", '"number" BETWEEN 0 AND 99')
export class RaffleNumber {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "raffle_id", type: "uuid" }) raffleId!: string;
  @ManyToOne(() => Raffle, (raffle) => raffle.numbers, {
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "raffle_id" })
  raffle!: Raffle;
  @Column({ type: "smallint" }) number!: number;
  @Column({
    type: "enum",
    enum: RaffleNumberStatus,
    default: RaffleNumberStatus.AVAILABLE,
  })
  status!: RaffleNumberStatus;
  @Column({ name: "raffle_purchase_id", type: "uuid", nullable: true })
  rafflePurchaseId!: string | null;
  @ManyToOne(() => RafflePurchase, (purchase) => purchase.numbers, {
    nullable: true,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "raffle_purchase_id" })
  rafflePurchase!: RafflePurchase | null;
  @Column({ name: "reserved_until", type: "timestamptz", nullable: true })
  reservedUntil!: Date | null;
  @Column({ name: "reserved_at", type: "timestamptz", nullable: true })
  reservedAt!: Date | null;
  @Column({ name: "sold_at", type: "timestamptz", nullable: true })
  soldAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
