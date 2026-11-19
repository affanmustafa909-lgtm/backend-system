import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  StreamableFile,
} from "@nestjs/common";
import {
  organizations,
  platformMediaAssets,
  users,
  type PlatformPgDb,
} from "@platform/database-pg";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import sharp from "sharp";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { isSuperAdmin, type AccessJwtPayload } from "../auth/jwt.types";
import type { PlatformMediaUploadedFile } from "./platform-media.types";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 1280;
const JPEG_QUALITY = 72;

@Injectable()
export class PlatformMediaService {
  private readonly uploadsRoot = join(process.cwd(), "data", "uploads");
  private readonly mediaRoot = join(this.uploadsRoot, "platform-media");
  private readonly menuRoot = join(this.uploadsRoot, "menu");

  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  assertSuperAdmin(user: AccessJwtPayload): void {
    if (!isSuperAdmin(user)) {
      throw new ForbiddenException("Access denied. Super Admin role required.");
    }
  }

  private publicUrl(storagePath: string): string {
    return `/uploads/${storagePath.replace(/\\/g, "/")}`;
  }

  private absolutePath(storagePath: string): string {
    return join(this.uploadsRoot, storagePath);
  }

  private detectKind(mime: string): "image" | "video" | "other" {
    if (IMAGE_MIME.has(mime)) return "image";
    if (VIDEO_MIME.has(mime)) return "video";
    return "other";
  }

  async summarize() {
    const rows = await this.db
      .select({
        organizationId: platformMediaAssets.organizationId,
        organizationName: organizations.name,
        uploadedByUserId: platformMediaAssets.uploadedByUserId,
        userEmail: users.email,
        userName: users.name,
        imageCount: sql<number>`coalesce(sum(case when ${platformMediaAssets.kind} = 'image' then 1 else 0 end), 0)::int`,
        videoCount: sql<number>`coalesce(sum(case when ${platformMediaAssets.kind} = 'video' then 1 else 0 end), 0)::int`,
        otherCount: sql<number>`coalesce(sum(case when ${platformMediaAssets.kind} = 'other' then 1 else 0 end), 0)::int`,
        totalBytes: sql<number>`coalesce(sum(${platformMediaAssets.byteSize}), 0)::bigint`,
        flaggedCount: sql<number>`coalesce(sum(case when ${platformMediaAssets.flagStatus} = 'flagged' then 1 else 0 end), 0)::int`,
        assetCount: sql<number>`count(*)::int`,
      })
      .from(platformMediaAssets)
      .leftJoin(organizations, eq(organizations.id, platformMediaAssets.organizationId))
      .leftJoin(users, eq(users.id, platformMediaAssets.uploadedByUserId))
      .where(isNull(platformMediaAssets.deletedAt))
      .groupBy(
        platformMediaAssets.organizationId,
        organizations.name,
        platformMediaAssets.uploadedByUserId,
        users.email,
        users.name,
      )
      .orderBy(sql`coalesce(sum(${platformMediaAssets.byteSize}), 0) desc`);

    const totals = rows.reduce(
      (acc, r) => {
        acc.usersWithMedia += 1;
        acc.totalBytes += Number(r.totalBytes ?? 0);
        acc.flaggedCount += Number(r.flaggedCount ?? 0);
        acc.assetCount += Number(r.assetCount ?? 0);
        return acc;
      },
      { usersWithMedia: 0, totalBytes: 0, flaggedCount: 0, assetCount: 0 },
    );

    return {
      totals,
      byUser: rows.map((r) => ({
        organizationId: r.organizationId,
        organizationName: r.organizationName ?? "Unknown",
        uploadedByUserId: r.uploadedByUserId,
        userEmail: r.userEmail ?? "unknown",
        userName: r.userName ?? null,
        imageCount: Number(r.imageCount ?? 0),
        videoCount: Number(r.videoCount ?? 0),
        otherCount: Number(r.otherCount ?? 0),
        totalBytes: Number(r.totalBytes ?? 0),
        flaggedCount: Number(r.flaggedCount ?? 0),
        assetCount: Number(r.assetCount ?? 0),
      })),
    };
  }

  async list(filters: {
    organizationId?: string;
    userId?: string;
    flagStatus?: string;
    kind?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(Math.max(filters.limit ?? 60, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const clauses = [isNull(platformMediaAssets.deletedAt)];
    if (filters.organizationId) {
      clauses.push(eq(platformMediaAssets.organizationId, filters.organizationId));
    }
    if (filters.userId) {
      clauses.push(eq(platformMediaAssets.uploadedByUserId, filters.userId));
    }
    if (filters.flagStatus) {
      clauses.push(eq(platformMediaAssets.flagStatus, filters.flagStatus));
    }
    if (filters.kind) {
      clauses.push(eq(platformMediaAssets.kind, filters.kind));
    }

    const rows = await this.db
      .select({
        id: platformMediaAssets.id,
        organizationId: platformMediaAssets.organizationId,
        organizationName: organizations.name,
        uploadedByUserId: platformMediaAssets.uploadedByUserId,
        userEmail: users.email,
        kind: platformMediaAssets.kind,
        mimeType: platformMediaAssets.mimeType,
        originalName: platformMediaAssets.originalName,
        byteSize: platformMediaAssets.byteSize,
        width: platformMediaAssets.width,
        height: platformMediaAssets.height,
        storagePath: platformMediaAssets.storagePath,
        source: platformMediaAssets.source,
        flagStatus: platformMediaAssets.flagStatus,
        flagNote: platformMediaAssets.flagNote,
        createdAt: platformMediaAssets.createdAt,
      })
      .from(platformMediaAssets)
      .leftJoin(organizations, eq(organizations.id, platformMediaAssets.organizationId))
      .leftJoin(users, eq(users.id, platformMediaAssets.uploadedByUserId))
      .where(and(...clauses))
      .orderBy(desc(platformMediaAssets.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        ...r,
        url: this.publicUrl(r.storagePath),
      })),
      limit,
      offset,
    };
  }

  async flag(
    id: string,
    input: { status: "none" | "flagged" | "approved" | "rejected"; note?: string },
    actor: AccessJwtPayload,
  ) {
    const [row] = await this.db
      .select()
      .from(platformMediaAssets)
      .where(and(eq(platformMediaAssets.id, id), isNull(platformMediaAssets.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException("Media asset not found");

    const [updated] = await this.db
      .update(platformMediaAssets)
      .set({
        flagStatus: input.status,
        flagNote: input.note?.trim() || null,
        flaggedByUserId: actor.sub,
        flaggedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(platformMediaAssets.id, id))
      .returning();
    return updated;
  }

  async softDelete(id: string) {
    const [row] = await this.db
      .select()
      .from(platformMediaAssets)
      .where(and(eq(platformMediaAssets.id, id), isNull(platformMediaAssets.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException("Media asset not found");

    await this.db
      .update(platformMediaAssets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(platformMediaAssets.id, id));

    // Only unlink registry-owned files; leave menu uploads on disk for the menu module.
    if (row.storagePath.replace(/\\/g, "/").startsWith("platform-media/")) {
      const abs = this.absolutePath(row.storagePath);
      if (existsSync(abs)) {
        await unlink(abs).catch(() => undefined);
      }
    }
    return { ok: true };
  }

  async download(id: string): Promise<StreamableFile> {
    const [row] = await this.db
      .select()
      .from(platformMediaAssets)
      .where(and(eq(platformMediaAssets.id, id), isNull(platformMediaAssets.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException("Media asset not found");
    const abs = this.absolutePath(row.storagePath);
    if (!existsSync(abs)) throw new NotFoundException("File missing on disk");
    const stream = createReadStream(abs);
    return new StreamableFile(stream, {
      type: row.mimeType,
      disposition: `attachment; filename="${(row.originalName || basename(abs)).replace(/"/g, "")}"`,
    });
  }

  private async compressImage(buffer: Buffer): Promise<{
    buffer: Buffer;
    mimeType: string;
    ext: string;
    width: number | null;
    height: number | null;
  }> {
    try {
      const pipeline = sharp(buffer).rotate().resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });
      const jpeg = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer({
        resolveWithObject: true,
      });
      return {
        buffer: jpeg.data,
        mimeType: "image/jpeg",
        ext: ".jpg",
        width: jpeg.info.width ?? null,
        height: jpeg.info.height ?? null,
      };
    } catch {
      return { buffer, mimeType: "image/jpeg", ext: ".jpg", width: null, height: null };
    }
  }

  async upload(
    user: AccessJwtPayload,
    file: PlatformMediaUploadedFile,
    opts?: { organizationId?: string; source?: string },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException("File is required");
    const mime = (file.mimetype || "application/octet-stream").toLowerCase();
    const kind = this.detectKind(mime);
    if (kind === "image" && file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException("Image must be 12 MB or smaller");
    }
    if (kind === "video" && file.size > MAX_VIDEO_BYTES) {
      throw new BadRequestException("Video must be 25 MB or smaller");
    }
    if (kind === "other") {
      throw new BadRequestException("Only images and videos are allowed");
    }

    const organizationId = (
      opts?.organizationId ||
      (!isSuperAdmin(user) ? user.organizationId : undefined) ||
      ""
    ).trim();
    if (!organizationId || organizationId.startsWith("00000000")) {
      throw new BadRequestException("organizationId is required");
    }

    let outBuffer = file.buffer;
    let outMime = mime;
    let ext = extname(file.originalname || "") || (kind === "video" ? ".mp4" : ".jpg");
    let width: number | null = null;
    let height: number | null = null;

    if (kind === "image") {
      const compressed = await this.compressImage(file.buffer);
      outBuffer = compressed.buffer;
      outMime = compressed.mimeType;
      ext = compressed.ext;
      width = compressed.width;
      height = compressed.height;
    }

    const id = randomUUID();
    const userFolder = user.sub || "unknown";
    const dir = join(this.mediaRoot, organizationId, userFolder);
    await mkdir(dir, { recursive: true });
    const filename = `${id}${ext}`;
    const abs = join(dir, filename);
    await writeFile(abs, outBuffer);
    const storagePath = relative(this.uploadsRoot, abs).replace(/\\/g, "/");

    const [row] = await this.db
      .insert(platformMediaAssets)
      .values({
        id,
        organizationId,
        uploadedByUserId: user.sub,
        kind,
        mimeType: outMime,
        originalName: file.originalname || filename,
        byteSize: outBuffer.length,
        width,
        height,
        storagePath,
        source: opts?.source ?? "upload",
        flagStatus: "none",
      })
      .returning();

    return {
      ...row,
      url: this.publicUrl(storagePath),
      compressed: kind === "image",
      originalBytes: file.size,
      storedBytes: outBuffer.length,
    };
  }

  async reindexMenu(): Promise<{ imported: number; skipped: number }> {
    if (!existsSync(this.menuRoot)) return { imported: 0, skipped: 0 };
    let imported = 0;
    let skipped = 0;
    const orgs = await readdir(this.menuRoot, { withFileTypes: true });
    for (const orgDir of orgs) {
      if (!orgDir.isDirectory()) continue;
      const organizationId = orgDir.name;
      const files = await readdir(join(this.menuRoot, organizationId));
      for (const name of files) {
        const abs = join(this.menuRoot, organizationId, name);
        const st = await stat(abs).catch(() => null);
        if (!st?.isFile()) continue;
        const storagePath = `menu/${organizationId}/${name}`;
        const existing = await this.db
          .select({ id: platformMediaAssets.id })
          .from(platformMediaAssets)
          .where(eq(platformMediaAssets.storagePath, storagePath))
          .limit(1);
        if (existing[0]) {
          skipped += 1;
          continue;
        }
        const ext = extname(name).toLowerCase();
        const mime =
          ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : ext === ".gif"
                ? "image/gif"
                : "image/jpeg";
        await this.db.insert(platformMediaAssets).values({
          organizationId,
          uploadedByUserId: null,
          kind: "image",
          mimeType: mime,
          originalName: name,
          byteSize: st.size,
          storagePath,
          source: "menu_import",
          flagStatus: "none",
        });
        imported += 1;
      }
    }
    return { imported, skipped };
  }
}
