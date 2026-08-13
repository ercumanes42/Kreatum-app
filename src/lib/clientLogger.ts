interface ErrorLike {
  code?: unknown;
  name?: unknown;
}

export const reportClientError = (label: string, error: unknown) => {
  const errorLike = error && typeof error === 'object' ? error as ErrorLike : null;
  console.error(label, {
    name: typeof errorLike?.name === 'string' ? errorLike.name : 'UnknownError',
    code: typeof errorLike?.code === 'string' ? errorLike.code : undefined,
  });
};