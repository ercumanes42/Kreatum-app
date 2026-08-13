import { randomUUID } from 'node:crypto';

type DownloadFile = {
  getSignedUrl(options: {
    version: 'v4';
    action: 'read';
    expires: number;
    responseDisposition: string;
  }): Promise<[string]>;
  setMetadata(metadata: {
    metadata: { firebaseStorageDownloadTokens: string };
  }): Promise<unknown>;
};

type DownloadUrlInput = {
  file: DownloadFile;
  bucketName: string;
  storagePath: string;
  expiresAt: number;
  filename: string;
};

export const createShortLivedReportUrl = async ({
  file,
  bucketName,
  storagePath,
  expiresAt,
  filename,
}: DownloadUrlInput) => {
  const emulatorHost = process.env.STORAGE_EMULATOR_HOST?.trim();
  if (process.env.FUNCTIONS_EMULATOR === 'true' && emulatorHost) {
    const token = randomUUID();
    await file.setMetadata({
      metadata: { firebaseStorageDownloadTokens: token },
    });
    const origin = /^https?:\/\//.test(emulatorHost)
      ? emulatorHost
      : `http://${emulatorHost}`;
    return `${origin}/v0/b/${encodeURIComponent(bucketName)}`
      + `/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(token)}`;
  }

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: expiresAt,
    responseDisposition: `attachment; filename="${filename}"`,
  });
  return url;
};
