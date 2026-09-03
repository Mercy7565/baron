"use client";

/** Always visible, on both surfaces. Signing out returns to the dark stage. */
export function LogoutButton() {
  async function out(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <button className="nl-logout" onClick={() => void out()}>
      Log out
    </button>
  );
}
