import { signIn } from "@/lib/auth";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="grid-bg scanlines flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Branding */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div
            className="h-4 w-4 rounded-full bg-neo"
            style={{ boxShadow: "0 0 20px rgba(0, 240, 255, 0.8)" }}
          />
          <div className="text-center">
            <h1 className="glow-text-neo font-mono text-2xl font-bold tracking-[0.2em] text-neo">
              AXISLABS
            </h1>
            <p className="mt-1 font-mono text-[10px] tracking-[0.4em] text-white/30">
              MISSION CONTROL
            </p>
          </div>
        </div>

        {/* Login Card */}
        <div
          className="glass-card p-8"
          style={{ borderColor: "rgba(0, 240, 255, 0.1)" }}
        >
          <div className="mb-6 text-center">
            <h2 className="font-mono text-sm font-bold tracking-[0.15em] text-white/70">
              TACTICAL ACCESS
            </h2>
            <p className="mt-1.5 text-xs text-white/30">
              Authenticate to enter the command center
            </p>
          </div>

          {/* Divider */}
          <div className="mb-6 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

          {/* GitHub Sign-in Form */}
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/dashboard" });
            }}
          >
            <button
              type="submit"
              className="group flex w-full items-center justify-center gap-3 rounded-lg border border-white/[0.12] bg-white/[0.04] px-4 py-3 font-mono text-sm font-bold tracking-wider text-white/80 transition-all duration-200 hover:border-neo/40 hover:bg-neo/[0.08] hover:text-neo hover:shadow-[0_0_20px_rgba(0,240,255,0.1)]"
            >
              <svg
                className="h-5 w-5 transition-colors group-hover:text-neo"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"
                  clipRule="evenodd"
                />
              </svg>
              SIGN IN WITH GITHUB
            </button>
          </form>

          {/* Footer note */}
          <p className="mt-4 text-center font-mono text-[9px] tracking-wider text-white/20">
            ACCESS RESTRICTED TO AXISLABS PERSONNEL
          </p>
        </div>

        {/* Bottom branding */}
        <div className="mt-6 text-center">
          <span className="font-mono text-[9px] tracking-wider text-white/15">
            MISSION CONTROL v0.2.0 · AXISLABS.DEV
          </span>
        </div>
      </div>
    </div>
  );
}
