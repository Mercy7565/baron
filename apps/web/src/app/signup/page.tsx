import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Sign-up and sign-in are the same two fields and the same demo rules, so they
 * are one screen. This exists because /signup is the address people try.
 */
export default function SignupPage(): never {
  redirect("/login?mode=signup");
}
