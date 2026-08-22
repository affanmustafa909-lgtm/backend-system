import { BadRequestException, Injectable } from "@nestjs/common";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MenuUploadedFile } from "./menu-upload.types";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

@Injectable()
export class MenuUploadService {
  private readonly rootDir = join(process.cwd(), "data", "uploads", "menu");

  async saveMenuImage(organizationId: string, file: MenuUploadedFile): Promise<string> {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Image file is required");
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException("Only JPEG, PNG, WebP, and GIF images are allowed");
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException("Image must be 5 MB or smaller");
    }

    const ext = EXT_BY_MIME[file.mimetype] ?? ".jpg";
    const dir = join(this.rootDir, organizationId);
    await mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}${ext}`;
    await writeFile(join(dir, filename), file.buffer);

    return `/uploads/menu/${organizationId}/${filename}`;
  }
}
