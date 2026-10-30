import { redirect } from "next/navigation";
import { setupStore } from "@/app/actions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Setup({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await prisma.store.findFirst({ select: { id: true } })) redirect("/login");
  const { error } = await searchParams;
  return <main className="auth-shell"><section className="auth-card">
    <div className="brand-lockup"><span className="brand-mark">d</span><span>daymark</span></div>
    <div className="auth-eyebrow">YOUR STORE, IN FOCUS</div>
    <h1>Start with the basics.</h1>
    <p className="auth-copy">Set up your store and owner account. This one-time page closes after the first owner is created.</p>
    {error && <p className="form-error">{error === "complete" ? "Setup has already been completed." : error === "timezone" ? "Choose a valid time zone." : "Check the details and password length, then try again."}</p>}
    <form action={setupStore} className="form-stack">
      <label>Store name<input name="storeName" required maxLength={100} placeholder="The Corner Shop" /></label>
      <div className="form-grid"><label>Currency<input name="currency" required maxLength={3} defaultValue="LKR" placeholder="LKR" /></label><label>Time zone<input name="timezone" required defaultValue="Asia/Colombo" placeholder="Asia/Colombo" /></label></div>
      <div className="form-divider">OWNER ACCOUNT</div>
      <label>Your name<input name="name" required maxLength={100} autoComplete="name" placeholder="Alex Morgan" /></label>
      <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="you@store.com" /></label>
      <label>Password<input name="password" type="password" required minLength={12} autoComplete="new-password" placeholder="At least 12 characters" /></label>
      <button className="button button-primary button-wide">Create my store <span aria-hidden="true">↗</span></button>
    </form>
    <p className="auth-footnote">Your data is kept in your PostgreSQL database.</p>
  </section></main>;
}
