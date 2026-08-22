import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CatalogService } from "./catalog.service";

@Controller("v1/catalog")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("modules")
  @UseGuards(JwtAuthGuard)
  listModules() {
    return this.catalog.listModules();
  }
}
