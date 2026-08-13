type ReportExtension = 'json' | 'pdf' | 'pptx';

const assertAuthorizedDownloadUrl = (value: string) => {
  const url = new URL(value);
  const productionUrl = url.protocol === 'https:'
    && url.hostname === 'storage.googleapis.com';
  const emulatorUrl = import.meta.env?.VITE_FIREBASE_USE_EMULATORS === 'true'
    && url.protocol === 'http:'
    && url.hostname === '127.0.0.1'
    && url.port === '9199';
  if (!productionUrl && !emulatorUrl) {
    throw new Error('Invalid authorized report URL.');
  }
  return url.toString();
};

export const prepareProtectedReportDownload = (
  authorizedUrl: string,
  filename: string,
  extension: ReportExtension,
) => {
  const safeFilename = filename.replace(/[^A-Za-z0-9._-]+/g, '_');
  const downloadName = safeFilename.toLowerCase().endsWith(`.${extension}`)
    ? safeFilename
    : `${safeFilename}.${extension}`;
  return {
    href: assertAuthorizedDownloadUrl(authorizedUrl),
    downloadName,
  };
};

export const downloadProtectedReport = (
  authorizedUrl: string,
  filename: string,
  extension: ReportExtension,
) => {
  const { href, downloadName } = prepareProtectedReportDownload(
    authorizedUrl,
    filename,
    extension,
  );
  const link = document.createElement('a');
  link.href = href;
  link.download = downloadName;
  link.rel = 'noopener noreferrer';
  link.referrerPolicy = 'no-referrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
};
