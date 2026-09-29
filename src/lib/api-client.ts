/** Thin fetch wrapper: parses the {error, code} shape every route returns and throws a readable Error. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
      code = body.code;
    } catch {
      // response had no JSON body — keep the generic message
    }
    throw new ApiClientError(message, res.status, code);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
