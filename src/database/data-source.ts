import "reflect-metadata";
import "dotenv/config";
import { DataSource } from "typeorm";
import { dataSourceConfig } from "../config/database.config";

export const AppDataSource = new DataSource(dataSourceConfig());
