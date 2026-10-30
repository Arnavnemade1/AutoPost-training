"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ForgeMark, Icon } from "@/components/icon";
import s from "./site.module.css";

export const PRODUCT_LINKS = [
  {
    href: "#production",
    icon: "production",
    title: "Finding mistakes",
    text: "Forge flags the answers your agent missed.",
  },
  {
    href: "#agents",
    icon: "chat",
    title: "Agents",
    text: "Five agents plan, train, test and review together.",
  },
  {
    href: "#durable",
    icon: "terse",
    title: "Memory",
    text: "A record every run can resume from.",
  },
  {
    href: "#training",
    icon: "chip",
    title: "Proof",
    text: "Scores on questions the model never trained on.",
  },
];

const NAV = [
  { href: "#platform", label: "How it works" },
  { href: "#results", label: "Results" },
  { href: "#record", label: "The record" },
  { href: "/", label: "Lab" },
];

function Wordmark() {
  return (
    <>
      <ForgeMark size={24} />
      <span>forge.</span>
    </>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [section, setSection] = useState<number | null>(null);
  const [dark, setDark] = useState(false);
  const [height, setHeight] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Header theme follows the band under its bottom edge (IO probe at the header line).
  useEffect(() => {
    const bands = Array.from(
      document.querySelectorAll<HTMLElement>("[data-header-theme='dark']"),
    );
    if (!bands.length) return;
    let io: IntersectionObserver | null = null;
    const connect = () => {
      io?.disconnect();
      const bottom = Math.max(window.innerHeight - 66, 0);
      io = new IntersectionObserver(
        (entries) => {
          const hit = entries.some((e) => e.isIntersecting);
          if (entries.length === bands.length || hit) setDark(hit);
          else
            setDark(
              bands.some((b) => {
                const r = b.getBoundingClientRect();
                return r.top <= 65 && r.bottom >= 65;
              }),
            );
        },
        { rootMargin: `-64px 0px -${bottom}px 0px` },
      );
      bands.forEach((b) => io!.observe(b));
    };
    connect();
    window.addEventListener("resize", connect);
    return () => {
      io?.disconnect();
      window.removeEventListener("resize", connect);
    };
  }, []);

  useEffect(() => {
    if (!open || !panel.current) return;
    setHeight(panel.current.scrollHeight);
  }, [open]);

  const show = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 80);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      if (menu) {
        setMenu(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menu]);

  const closeMenu = () => {
    setMenu(false);
    menuButton.current?.focus();
  };

  return (
    <>
      <div className={s.announce}>
        <span>The sealed test score went from 1 in 24 to 6 in 24.</span>
        <a href="#results">
          See the results <Icon name="arrow" size={14} />
        </a>
      </div>
      <header
        className={`${s.header} ${dark ? s.dark : ""}`}
        style={dark ? { background: "transparent" } : undefined}
        onMouseLeave={hide}
      >
        <div className={s.headerBar}>
          <div className={`${s.container} ${s.headerInner}`}>
            <a href="#top" className={s.logo} aria-label="Forge home">
              <Wordmark />
            </a>
            <nav className={s.navLinks} aria-label="Primary">
              <button
                type="button"
                className={s.navLink}
                aria-expanded={open}
                aria-controls="site-product-menu"
                onMouseEnter={show}
                onFocus={show}
                onClick={() => setOpen((v) => !v)}
              >
                Product
              </button>
              {NAV.map((n) => (
                <a
                  key={n.href}
                  href={n.href}
                  className={s.navLink}
                  onMouseEnter={hide}
                  onFocus={() => setOpen(false)}
                >
                  {n.label}
                </a>
              ))}
            </nav>
            <div className={s.headerRight}>
              <a href="#results" className={s.btnSmGhost}>
                See results
              </a>
              <Link href="/" className={s.btnSm}>
                Open the lab
              </Link>
            </div>
            <button
              ref={menuButton}
              type="button"
              className={s.menuButton}
              aria-label="Open menu"
              aria-expanded={menu}
              aria-controls="site-mobile-menu"
              onClick={() => setMenu(true)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  d="M3 7h14M3 13h14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
        <div
          id="site-product-menu"
          className={`${s.dropdown} ${open ? s.dropdownOpen : ""}`}
          style={{ height: open ? height : 0 }}
          onMouseEnter={show}
          aria-hidden={!open}
          inert={!open}
        >
          <div ref={panel} className={`${s.container} ${s.dropdownInner}`}>
            <div className={s.dropCol}>
              <span className={s.dropLabel}>Product</span>
              <ul className={s.dropList}>
                {PRODUCT_LINKS.map((p) => (
                  <li key={p.href}>
                    <a
                      href={p.href}
                      className={s.dropItem}
                      onClick={() => setOpen(false)}
                    >
                      <span className={s.dropItemTitle}>
                        <Icon name={p.icon} size={16} />
                        {p.title}
                      </span>
                      <span className={s.dropItemText}>{p.text}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div className={s.dropCol}>
              <span className={s.dropLabel}>Latest run</span>
              <a
                href="#results"
                className={s.dropFeature}
                onClick={() => setOpen(false)}
              >
                <span className={s.dropStat}>
                  9<span> of 33</span>
                </span>
                <span className={s.dropItemTitle}>
                  Saved-for-later failures, answered after training
                </span>
                <span className={s.dropItemText}>
                  Final test: 1 of 24 became 6 of 24.
                </span>
              </a>
            </div>
          </div>
        </div>
      </header>

      <div
        id="site-mobile-menu"
        className={`${s.mobileMenu} ${menu ? s.mobileMenuOpen : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!menu}
        inert={!menu}
      >
        <div className={`${s.container} ${s.mobileTop}`}>
          <a href="#top" className={s.logo} onClick={closeMenu}>
            <Wordmark />
          </a>
          <button
            ref={closeButton}
            type="button"
            className={s.menuButton}
            style={{ display: "grid" }}
            aria-label="Close menu"
            onClick={closeMenu}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className={`${s.container} ${s.mobileList}`}>
          <button
            type="button"
            className={s.mobileRow}
            aria-expanded={section === 0}
            onClick={() => setSection((v) => (v === 0 ? null : 0))}
          >
            Product
            <span
              className={`${s.chevron} ${section === 0 ? s.chevronOpen : ""}`}
            >
              <Icon name="chevron" size={18} />
            </span>
          </button>
          <div
            className={`${s.accordion} ${section === 0 ? s.accordionOpen : ""}`}
          >
            <div>
              {PRODUCT_LINKS.map((p) => (
                <a
                  key={p.href}
                  href={p.href}
                  className={s.mobileSub}
                  onClick={() => setMenu(false)}
                  tabIndex={section === 0 ? 0 : -1}
                >
                  {p.title}
                  <span>{p.text}</span>
                </a>
              ))}
            </div>
          </div>
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={s.mobileRow}
              onClick={() => setMenu(false)}
            >
              {n.label}
            </a>
          ))}
        </div>
        <div className={`${s.container} ${s.mobileActions}`}>
          <a
            href="#results"
            className={s.btnGhost}
            onClick={() => setMenu(false)}
          >
            See results
          </a>
          <Link href="/" className={s.btn}>
            Open the lab
          </Link>
        </div>
      </div>
    </>
  );
}
