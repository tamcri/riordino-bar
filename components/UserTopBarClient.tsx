"use client";

import { useRouter } from "next/navigation";

export default function UserTopBarClient({ username }: { username: string }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden sm:block text-sm text-slate-200">
        <span className="text-slate-400">Utente:</span>{" "}
        <span className="font-semibold text-white">{username}</span>
      </div>

      <button
        onClick={logout}
        className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15 border border-white/15"
      >
        Logout
      </button>
    </div>
  );
}
