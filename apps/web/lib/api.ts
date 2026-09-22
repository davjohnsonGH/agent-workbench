/** POST JSON to an API route; throws with the server's error message on failure. */
export async function postJson<T = unknown>(
  url: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (data as { error?: string } | null)?.error ??
        `Request failed (${response.status})`,
    );
  }
  return data as T;
}
