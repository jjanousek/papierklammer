import type { RequestHandler } from "express";
import multer from "multer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../attachment-types.js";
import { errorHandler } from "../middleware/index.js";
import { assetRoutes } from "../routes/assets.js";
import type { StorageService } from "../storage/types.js";

const { createAssetMock, getAssetByIdMock, logActivityMock } = vi.hoisted(() => ({
  createAssetMock: vi.fn(),
  getAssetByIdMock: vi.fn(),
  logActivityMock: vi.fn(),
}));

function createAsset() {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "asset-1",
    companyId: "company-1",
    provider: "local",
    objectKey: "assets/abc",
    contentType: "image/png",
    byteSize: 40,
    sha256: "sha256-sample",
    originalFilename: "logo.png",
    createdByAgentId: null,
    createdByUserId: "user-1",
    createdAt: now,
    updatedAt: now,
  };
}

function createStorageService(contentType = "image/png"): StorageService {
  const putFile: StorageService["putFile"] = vi.fn(async (input: {
    companyId: string;
    namespace: string;
    originalFilename: string | null;
    contentType: string;
    body: Buffer;
  }) => {
    return {
      provider: "local_disk" as const,
      objectKey: `${input.namespace}/${input.originalFilename ?? "upload"}`,
      contentType: contentType || input.contentType,
      byteSize: input.body.length,
      sha256: "sha256-sample",
      originalFilename: input.originalFilename,
    };
  });

  return {
    provider: "local_disk" as const,
    putFile,
    getObject: vi.fn(),
    headObject: vi.fn(),
    deleteObject: vi.fn(),
  };
}

type UploadedFile = {
  mimetype: string;
  buffer: Buffer;
  originalname: string;
};

type UploadRunner = (req: any, res: any) => Promise<void>;

function createUploadRunner(options: {
  body?: Record<string, unknown>;
  file?: UploadedFile;
  error?: unknown;
}): UploadRunner {
  return async (req) => {
    if (options.error) {
      throw options.error;
    }
    req.body = options.body ?? {};
    req.file = options.file;
  };
}

function getRouteHandlers(options: {
  path: "/companies/:companyId/assets/images" | "/companies/:companyId/logo";
  storage: ReturnType<typeof createStorageService>;
  runAssetUpload?: UploadRunner;
  runCompanyLogoUpload?: UploadRunner;
}) {
  const router = assetRoutes({} as any, options.storage, {
    assetService: {
      create: createAssetMock,
      getById: getAssetByIdMock,
    },
    logActivity: logActivityMock,
    runAssetUpload: options.runAssetUpload as any,
    runCompanyLogoUpload: options.runCompanyLogoUpload as any,
  });
  const layer = (router as any).stack.find(
    (entry: any) => entry.route?.path === options.path && entry.route.methods?.post,
  );
  if (!layer) {
    throw new Error(`Route POST ${options.path} not found`);
  }
  return layer.route.stack.map((entry: any) => entry.handle as RequestHandler);
}

async function runHandlers(
  handlers: RequestHandler[],
  req: any,
  res: any,
  index = 0,
): Promise<void> {
  const handler = handlers[index];
  if (!handler) return;

  await new Promise<void>((resolve, reject) => {
    let nextCalled = false;
    const next = (err?: unknown) => {
      nextCalled = true;
      if (err) {
        reject(err);
        return;
      }
      runHandlers(handlers, req, res, index + 1).then(resolve).catch(reject);
    };

    try {
      const result = handler(req, res, next as any);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).then(
          () => {
            if (!nextCalled) resolve();
          },
          reject,
        );
        return;
      }
      if (!nextCalled) resolve();
    } catch (error) {
      reject(error);
    }
  });
}

async function callRoute(options: {
  path: "/companies/:companyId/assets/images" | "/companies/:companyId/logo";
  storage: ReturnType<typeof createStorageService>;
  runAssetUpload?: UploadRunner;
  runCompanyLogoUpload?: UploadRunner;
}) {
  const req = {
    actor: {
      type: "board",
      source: "local_implicit",
      userId: "user-1",
    },
    body: {},
    params: { companyId: "company-1" },
    query: {},
    method: "POST",
    originalUrl: `/api${options.path.replace(":companyId", "company-1")}`,
  } as any;
  let statusCode = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as any;

  try {
    await runHandlers(getRouteHandlers(options), req, res);
  } catch (error) {
    errorHandler(error, req, res, (() => undefined) as any);
  }

  return { status: statusCode, body };
}

describe("POST /api/companies/:companyId/assets/images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    createAssetMock.mockReset();
    getAssetByIdMock.mockReset();
    logActivityMock.mockReset();
  });

  it("accepts PNG image uploads and returns an asset path", async () => {
    const png = createStorageService("image/png");
    createAssetMock.mockResolvedValue(createAsset());

    const res = await callRoute({
      path: "/companies/:companyId/assets/images",
      storage: png,
      runAssetUpload: createUploadRunner({
        body: { namespace: "goals" },
        file: {
          mimetype: "image/png",
          buffer: Buffer.from("png"),
          originalname: "logo.png",
        },
      }),
    });

    expect(res.status).toBe(201);
    expect((res.body as any).contentPath).toBe("/api/assets/asset-1/content");
    expect(createAssetMock).toHaveBeenCalledTimes(1);
    expect(png.putFile).toHaveBeenCalledWith({
      companyId: "company-1",
      namespace: "assets/goals",
      originalFilename: "logo.png",
      contentType: "image/png",
      body: expect.any(Buffer),
    });
  });

  it("allows supported non-image attachments outside the company logo flow", async () => {
    const text = createStorageService("text/plain");
    createAssetMock.mockResolvedValue({
      ...createAsset(),
      contentType: "text/plain",
      originalFilename: "note.txt",
    });

    const res = await callRoute({
      path: "/companies/:companyId/assets/images",
      storage: text,
      runAssetUpload: createUploadRunner({
        body: { namespace: "issues/drafts" },
        file: {
          mimetype: "text/plain",
          buffer: Buffer.from("hello"),
          originalname: "note.txt",
        },
      }),
    });

    expect(res.status).toBe(201);
    expect(text.putFile).toHaveBeenCalledWith({
      companyId: "company-1",
      namespace: "assets/issues/drafts",
      originalFilename: "note.txt",
      contentType: "text/plain",
      body: expect.any(Buffer),
    });
  });
});

describe("POST /api/companies/:companyId/logo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    createAssetMock.mockReset();
    getAssetByIdMock.mockReset();
    logActivityMock.mockReset();
  });

  it("accepts PNG logo uploads and returns an asset path", async () => {
    const png = createStorageService("image/png");
    createAssetMock.mockResolvedValue(createAsset());

    const res = await callRoute({
      path: "/companies/:companyId/logo",
      storage: png,
      runCompanyLogoUpload: createUploadRunner({
        file: {
          mimetype: "image/png",
          buffer: Buffer.from("png"),
          originalname: "logo.png",
        },
      }),
    });

    expect(res.status).toBe(201);
    expect((res.body as any).contentPath).toBe("/api/assets/asset-1/content");
    expect(createAssetMock).toHaveBeenCalledTimes(1);
    expect(png.putFile).toHaveBeenCalledWith({
      companyId: "company-1",
      namespace: "assets/companies",
      originalFilename: "logo.png",
      contentType: "image/png",
      body: expect.any(Buffer),
    });
  });

  it("sanitizes SVG logo uploads before storing them", async () => {
    const svg = createStorageService("image/svg+xml");
    createAssetMock.mockResolvedValue({
      ...createAsset(),
      contentType: "image/svg+xml",
      originalFilename: "logo.svg",
    });

    const res = await callRoute({
      path: "/companies/:companyId/logo",
      storage: svg,
      runCompanyLogoUpload: createUploadRunner({
        file: {
          mimetype: "image/svg+xml",
          buffer: Buffer.from(
            "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'><script>alert(1)</script><a href='https://evil.example/'><circle cx='12' cy='12' r='10'/></a></svg>",
          ),
          originalname: "logo.svg",
        },
      }),
    });

    expect(res.status).toBe(201);
    expect(svg.putFile).toHaveBeenCalledTimes(1);
    const stored = (svg.putFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(stored.contentType).toBe("image/svg+xml");
    expect(stored.originalFilename).toBe("logo.svg");
    const body = stored.body.toString("utf8");
    expect(body).toContain("<svg");
    expect(body).toContain("<circle");
    expect(body).not.toContain("<script");
    expect(body).not.toContain("onload=");
    expect(body).not.toContain("https://evil.example/");
  });

  it("allows logo uploads within the general attachment limit", async () => {
    const png = createStorageService("image/png");
    createAssetMock.mockResolvedValue(createAsset());

    const file = Buffer.alloc(150 * 1024, "a");
    const res = await callRoute({
      path: "/companies/:companyId/logo",
      storage: png,
      runCompanyLogoUpload: createUploadRunner({
        file: {
          mimetype: "image/png",
          buffer: file,
          originalname: "within-limit.png",
        },
      }),
    });

    expect(res.status).toBe(201);
  });

  it("rejects logo files larger than the general attachment limit", async () => {
    const storage = createStorageService();
    createAssetMock.mockResolvedValue(createAsset());

    const res = await callRoute({
      path: "/companies/:companyId/logo",
      storage,
      runCompanyLogoUpload: createUploadRunner({
        error: new multer.MulterError("LIMIT_FILE_SIZE"),
      }),
    });

    expect(res.status).toBe(422);
    expect((res.body as any).error).toBe(`Image exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
    expect(storage.putFile).not.toHaveBeenCalled();
    expect(createAssetMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported image types", async () => {
    const storage = createStorageService("text/plain");
    createAssetMock.mockResolvedValue(createAsset());

    const res = await callRoute({
      path: "/companies/:companyId/logo",
      storage,
      runCompanyLogoUpload: createUploadRunner({
        file: {
          mimetype: "text/plain",
          buffer: Buffer.from("not an image"),
          originalname: "note.txt",
        },
      }),
    });

    expect(res.status).toBe(422);
    expect((res.body as any).error).toBe("Unsupported image type: text/plain");
    expect(createAssetMock).not.toHaveBeenCalled();
    expect(storage.putFile).not.toHaveBeenCalled();
  });

  it("rejects SVG image uploads that cannot be sanitized", async () => {
    const storage = createStorageService("image/svg+xml");
    createAssetMock.mockResolvedValue(createAsset());

    const res = await callRoute({
      path: "/companies/:companyId/logo",
      storage,
      runCompanyLogoUpload: createUploadRunner({
        file: {
          mimetype: "image/svg+xml",
          buffer: Buffer.from("not actually svg"),
          originalname: "logo.svg",
        },
      }),
    });

    expect(res.status).toBe(422);
    expect((res.body as any).error).toBe("SVG could not be sanitized");
    expect(createAssetMock).not.toHaveBeenCalled();
    expect(storage.putFile).not.toHaveBeenCalled();
  });
});
