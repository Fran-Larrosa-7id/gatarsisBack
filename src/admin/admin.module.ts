import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminAuthService } from "./admin-auth.service";
import { AdminProductsController } from './admin-products.controller';
import { AdminProductsService } from './admin-products.service';
import { AdminInventoryController } from './admin-inventory.controller';
import { AdminInventoryService } from './admin-inventory.service';
import { AdminOrdersPaymentsController } from './admin-orders-payments.controller';
import { adminAuthConfig } from "../config/database.config";

const authConfig = adminAuthConfig();

@Module({
  imports: [
    JwtModule.register({
      secret: authConfig.accessSecret,
      signOptions: { expiresIn: authConfig.accessTokenMinutes * 60 },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  controllers: [AdminAuthController, AdminProductsController, AdminInventoryController, AdminOrdersPaymentsController],
  providers: [
    AdminAuthService,
    AdminProductsService,
    AdminInventoryService,
    { provide: APP_GUARD, useClass: AdminAuthGuard },
  ],
})
export class AdminModule {}
