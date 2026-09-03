/**
 * Next's boot hook. Importing the vault here is what makes the capture mode
 * announce itself exactly once per server process, rather than lazily on the
 * first request that happens to touch it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@countersign/vault");
  }
}
