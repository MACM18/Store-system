"use client";

import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/actions";
import { FiLogOut, FiMoreHorizontal, FiShield, FiUsers } from "react-icons/fi";

type ProfileMenuProps = {
  user: { name: string; email: string; role: "OWNER" | "MANAGER" | "CASHIER" };
  placement: "topbar" | "sidebar";
  onTeamClick?: () => void;
};

const roleNames = { OWNER: "Owner", MANAGER: "Manager", CASHIER: "Cashier" };

export function ProfileMenu({ user, placement, onTeamClick }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part.slice(0, 1)).join("").toLocaleUpperCase();

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return <div className={`profile-menu profile-menu-${placement}`} ref={rootRef}>
    <button type="button" className="profile-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="profile-menu-avatar">{initials}</span>
      {placement === "topbar" && <span className="profile-menu-trigger-copy"><strong>{user.name}</strong><small>{roleNames[user.role]}</small></span>}
      {placement === "sidebar" && <span className="profile-menu-trigger-copy"><strong>{user.name}</strong><small>{roleNames[user.role]} · Account</small></span>}
      <FiMoreHorizontal className="profile-menu-trigger-dots" aria-hidden="true" />
    </button>
    {open && <section className="profile-menu-popover" role="menu" aria-label="Account menu">
      <div className="profile-popover-heading"><span className="profile-menu-avatar profile-popover-avatar">{initials}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div>
      <div className="profile-access-card"><span className="profile-access-icon"><FiShield aria-hidden="true" /></span><div><small>YOUR ACCESS</small><strong>{roleNames[user.role]}</strong></div><span className="profile-online-dot" /></div>
      {user.role === "OWNER" && <button type="button" role="menuitem" className="profile-menu-item" onClick={() => { setOpen(false); onTeamClick?.(); }}><FiUsers aria-hidden="true" /><span><strong>Team & devices</strong><small>People and signed-in devices</small></span></button>}
      <form action={logout}><button type="submit" role="menuitem" className="profile-menu-signout"><FiLogOut aria-hidden="true" /><span>Sign out</span></button></form>
    </section>}
  </div>;
}
