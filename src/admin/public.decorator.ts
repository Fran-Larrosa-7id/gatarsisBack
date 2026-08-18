import { SetMetadata } from "@nestjs/common";

export const IS_ADMIN_AUTH_PUBLIC = "isAdminAuthPublic";
export const AdminAuthPublic = () => SetMetadata(IS_ADMIN_AUTH_PUBLIC, true);
