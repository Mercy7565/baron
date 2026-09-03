import { cookies } from "next/headers";

import { SESSION_COOKIE, decodeSession } from "@/server/session";

import { StageClient } from "./StageClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The front door, and only ever the front door.
 *
 * `/` renders the stage unconditionally — logo, one quote, two role cards —
 * whether or not a cookie is present. It used to switch to the customer home
 * once a session existed, which meant the first screen a returning visitor saw
 * depended on what was in their jar, and the site had no stable entrance to
 * point anyone at.
 *
 * A session is still read, but only to relabel the cards: someone already
 * signed in is offered "Continue as…" rather than being made to pick a role
 * they have already picked.
 */
export default async function StagePage() {
  const jar = await cookies();
  const session = await decodeSession(jar.get(SESSION_COOKIE)?.value);

  return <StageClient signedInAs={session?.role ?? null} />;
}
