import Link from "next/link";
import { createHash } from "node:crypto";
import { finishAccountSetup } from "@/app/actions";
import { prisma } from "@/lib/prisma";
import { FiCheckCircle, FiKey } from "react-icons/fi";

export const dynamic = "force-dynamic";

export default async function AccountSetup({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const safeToken = token && /^[A-Za-z0-9_-]{40,50}$/.test(token) ? token : "";
  const tokenHash = safeToken ? createHash("sha256").update(safeToken).digest("hex") : "";
  const accountToken = tokenHash ? await prisma.accountToken.findUnique({ where: { tokenHash }, include: { store: { select: { name: true } }, user: { select: { name: true } } } }) : null;
  const valid = !!accountToken && !accountToken.usedAt && accountToken.expiresAt > new Date() && (accountToken.type === "INVITE" ? !!accountToken.inviteName : !!accountToken.userId);
  const invite = accountToken?.type === "INVITE";
  const name = invite ? accountToken?.inviteName : accountToken?.user?.name;
  const title = invite ? "Set up your account" : "Choose a new password";
  const errorMessage = error === "password" ? "Choose a password with at least 12 characters." : error === "match" ? "Those passwords do not match. Try again." : error ? "This link has expired or has already been used. Ask your store owner for a new one." : "";

  return <main className="auth-shell"><section className="auth-card account-setup-card">
    <div className="account-setup-mark"><FiKey aria-hidden="true" /></div>
    <div className="auth-eyebrow">{valid ? (invite ? "TEAM INVITATION" : "ACCOUNT SECURITY") : "LINK UNAVAILABLE"}</div>
    <h1>{valid ? title : "This link can’t be used."}</h1>
    {valid ? <>
      <p className="auth-copy">{invite ? <>You’re joining <strong>{accountToken.store.name}</strong> as a team member.</> : <>Update the password for your account at <strong>{accountToken.store.name}</strong>.</>}</p>
      <p className="account-setup-recipient"><FiCheckCircle aria-hidden="true" /> {name} · {accountToken.email}</p>
      {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
      <form action={finishAccountSetup} className="form-stack">
        <input type="hidden" name="token" value={safeToken} />
        <label>New password<input name="password" type="password" required minLength={12} autoComplete="new-password" placeholder="At least 12 characters" /></label>
        <label>Confirm password<input name="confirmPassword" type="password" required minLength={12} autoComplete="new-password" placeholder="Enter it again" /></label>
        <button className="button button-primary button-wide">{invite ? "Create account" : "Save new password"}</button>
      </form>
      <p className="auth-footnote">This secure link expires {invite ? "in 72 hours" : "in 1 hour"} and can only be used once.</p>
    </> : <>
      <p className="auth-copy">{errorMessage || "The invitation or password reset link is invalid, expired, or already complete."}</p>
      <p className="auth-footnote">Ask the store owner to send a fresh link.</p>
      <Link className="button button-outline button-wide account-login-link" href="/login">Return to sign in</Link>
    </>}
  </section></main>;
}
