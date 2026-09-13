import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AdminAuditLog } from "../admin/entities/admin-audit-log.entity";
import { DomainError } from "../common/domain-error";
import {
  RaffleNumber,
  RaffleNumberStatus,
} from "./entities/raffle-number.entity";
import { Raffle, RaffleStatus } from "./entities/raffle.entity";
import { CreateRaffleDto, RaffleListDto, UpdateRaffleDto } from "./raffles.dto";

type NumberSummaryRow = {
  total: string;
  available: string;
  reserved: string;
  sold: string;
};

@Injectable()
export class RafflesService {
  constructor(private readonly dataSource: DataSource) {}

  private imageUrl(value: string | null | undefined): string | null {
    if (value === undefined || value === null || value === "") return null;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" || !parsed.hostname)
        throw new Error("HTTPS_REQUIRED");
      return parsed.toString();
    } catch {
      throw new DomainError(
        "RAFFLE_INVALID_IMAGE_URL",
        "La imagen debe ser una URL HTTPS válida.",
        undefined,
        400,
      );
    }
  }

  private audit(
    manager: EntityManager,
    adminId: string,
    action: "RAFFLE_CREATED" | "RAFFLE_UPDATED",
    raffleId: string,
    metadata: Record<string, unknown>,
  ) {
    return manager.save(AdminAuditLog, {
      adminUserId: adminId,
      action,
      entityType: "RAFFLE",
      entityId: raffleId,
      metadata,
    });
  }

  async create(dto: CreateRaffleDto, adminId: string) {
    return this.dataSource.transaction(async (manager) => {
      const raffle = await manager.save(Raffle, {
        title: dto.title,
        prizeName: dto.prizeName,
        description: dto.description || null,
        imageUrl: this.imageUrl(dto.imageUrl),
        priceInCents: dto.priceInCents,
        status: RaffleStatus.DRAFT,
        drawAt: dto.drawAt ? new Date(dto.drawAt) : null,
        winningNumber: null,
        drawnAt: null,
        drawnByAdminId: null,
      });
      await manager.insert(
        RaffleNumber,
        Array.from({ length: 100 }, (_, number) => ({
          raffleId: raffle.id,
          number,
          status: RaffleNumberStatus.AVAILABLE,
          rafflePurchaseId: null,
          reservedUntil: null,
          reservedAt: null,
          soldAt: null,
        })),
      );
      await this.audit(manager, adminId, "RAFFLE_CREATED", raffle.id, {
        numberCount: 100,
      });
      return raffle;
    });
  }

  async list(query: RaffleListDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.dataSource
      .getRepository(Raffle)
      .findAndCount({
        select: {
          id: true,
          title: true,
          prizeName: true,
          imageUrl: true,
          priceInCents: true,
          status: true,
          drawAt: true,
          createdAt: true,
          updatedAt: true,
        },
        order: { createdAt: "DESC", id: "ASC" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
    return { items, page, pageSize, total };
  }

  async detail(id: string) {
    const raffle = await this.dataSource
      .getRepository(Raffle)
      .findOneBy({ id });
    if (!raffle)
      throw new NotFoundException({
        code: "RAFFLE_NOT_FOUND",
        message: "La rifa no existe.",
      });
    const summary = await this.dataSource
      .getRepository(RaffleNumber)
      .createQueryBuilder("number")
      .select("COUNT(*)", "total")
      .addSelect(
        `COUNT(*) FILTER (WHERE number.status = '${RaffleNumberStatus.AVAILABLE}')`,
        "available",
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE number.status = '${RaffleNumberStatus.RESERVED}')`,
        "reserved",
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE number.status = '${RaffleNumberStatus.SOLD}')`,
        "sold",
      )
      .where("number.raffleId = :id", { id })
      .getRawOne<NumberSummaryRow>();
    return {
      ...raffle,
      numberSummary: {
        total: Number(summary?.total ?? 0),
        available: Number(summary?.available ?? 0),
        reserved: Number(summary?.reserved ?? 0),
        sold: Number(summary?.sold ?? 0),
      },
    };
  }

  async update(id: string, dto: UpdateRaffleDto, adminId: string) {
    return this.dataSource.transaction(async (manager) => {
      const raffle = await manager
        .getRepository(Raffle)
        .createQueryBuilder("raffle")
        .setLock("pessimistic_write")
        .where("raffle.id = :id", { id })
        .getOne();
      if (!raffle)
        throw new NotFoundException({
          code: "RAFFLE_NOT_FOUND",
          message: "La rifa no existe.",
        });
      if (raffle.status !== RaffleStatus.DRAFT)
        throw new DomainError(
          "RAFFLE_EDIT_NOT_ALLOWED",
          "Sólo se puede editar una rifa en borrador.",
        );

      const changedFields = (
        [
          "title",
          "prizeName",
          "description",
          "imageUrl",
          "priceInCents",
          "drawAt",
        ] as const
      ).filter((field) => dto[field] !== undefined);
      if (dto.title !== undefined) raffle.title = dto.title;
      if (dto.prizeName !== undefined) raffle.prizeName = dto.prizeName;
      if (dto.description !== undefined)
        raffle.description = dto.description || null;
      if (dto.imageUrl !== undefined)
        raffle.imageUrl = this.imageUrl(dto.imageUrl);
      if (dto.priceInCents !== undefined)
        raffle.priceInCents = dto.priceInCents;
      if (dto.drawAt !== undefined)
        raffle.drawAt = dto.drawAt ? new Date(dto.drawAt) : null;

      if (changedFields.length) {
        await manager.save(raffle);
        await this.audit(manager, adminId, "RAFFLE_UPDATED", raffle.id, {
          changedFields,
        });
      }
      return raffle;
    });
  }
}
