import { redirect } from "next/navigation";
import { login } from "@/app/actions";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FiLogIn } from "react-icons/fi";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentSession();
  if (session) redirect("/");
  const store = await prisma.store.findFirst({ select: { name: true } });
  if (!store) redirect("/setup");
  const { error } = await searchParams;
  return <main className="auth-shell"><section className="auth-card login-card">
    <div className="auth-eyebrow">WELCOME BACK</div>
    <h1>Good to see you.</h1>
    <p className="auth-copy">Sign in to <strong>{store.name}</strong> and pick up where you left off.</p>
    {error && <p className="form-error">That email and password combination didn&apos;t work.</p>}
    <form action={login} className="form-stack">
      <label>Email<input name="email" type="email" required autoComplete="email" /></label>
      <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
      <button className="button button-primary button-wide">Sign in <FiLogIn aria-hidden="true" /></button>
    </form>
    <p className="auth-footnote">Access is limited to your store team.</p>
  </section></main>;
}
