export function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const paths: Record<string, React.ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    experiments: (
      <>
        <path d="M9 3h6m-5 0v6L4 19a1.4 1.4 0 001.2 2h13.6a1.4 1.4 0 001.2-2L14 9V3M7 15h10" />
      </>
    ),
    environments: (
      <>
        <path d="M12 3l9 5v8l-9 5-9-5V8l9-5zm0 10v8M3 8l9 5 9-5" />
      </>
    ),
    governance: (
      <>
        <path d="M12 3l8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3z" />
        <path d="M8 12l3 3 5-6" />
      </>
    ),
    artifacts: (
      <>
        <path d="M4 7V4h6l2 3h8v13H4V7z" />
        <path d="M4 10h16" />
      </>
    ),
    connections: (
      <>
        <path d="M8 8l8 8m-6-9l3-3a4 4 0 016 6l-3 3m-2 4l-3 3a4 4 0 01-6-6l3-3" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-5-5l5 5-5 5" />,
    chevron: <path d="M9 5l7 7-7 7" />,
    down: <path d="M6 9l6 6 6-6" />,
    check: <path d="M5 12l4 4L19 6" />,
    close: <path d="M6 6l12 12M6 18L18 6" />,
    download: (
      <>
        <path d="M12 3v12m-5-5l5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    play: <path d="M8 4l12 8-12 8V4z" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    chip: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4M18 9h4m-4 6h4" />
        <rect x="9" y="9" width="6" height="6" />
      </>
    ),
    results: (
      <>
        <path d="M3 21h18M6 17V9m6 8V3m6 14v-6" />
      </>
    ),
    chart: (
      <>
        <path d="M3 3v18h18M7 15l4-5 4 3 6-8" />
      </>
    ),
    message: (
      <>
        <path d="M4 4h16v13H9l-5 4V4zM8 8h8m-8 4h5" />
      </>
    ),
    code: (
      <>
        <path d="M8 6l-6 6 6 6m8-12l6 6-6 6m-3-15l-2 18" />
      </>
    ),
    moon: <path d="M20 14a8.5 8.5 0 01-10-10A8.5 8.5 0 1020 14z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12l2 2M4 20l2-2M18 6l2-2" />
      </>
    ),
    book: (
      <>
        <path d="M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2V4zm9 2v15" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="M15 15l6 6" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7m0-7L10 14M9 3H3v18h18v-6" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3L2 21h20L12 3zM12 9v5m0 3v1" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10v1" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 8a8 8 0 10.4 7M20 3v6h-6" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
    record: (
      <>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="M16 10l5-3v10l-5-3" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name] || paths.experiments}
    </svg>
  );
}
export function ForgeMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <path d="M4 5h28L22 15H4zm0 15h18L12 30H4z" fill="currentColor" />
    </svg>
  );
}
