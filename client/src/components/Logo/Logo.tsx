import "./Logo.scss";

export interface LogoProps {
  /**
   * Symbol height in rem. Default is 1.75.
   */
  size?: number;
  /**
   * Show the "cinemion" wordmark next to the symbol. Default is `true`.
   */
  wordmark?: boolean;
}

/**
 * The Aperture symbol: an open lens ring with the "ion" as a dot in the gap, in the accent colour.
 */
export function LogoSymbol(props: { size?: number }) {
  const { size = 1.75 } = props;
  return (
    <svg className="cn-logo__symbol" style={{ width: `${size}rem`, height: `${size}rem` }} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M48.85 17.86A22 22 0 1 0 48.85 46.14" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
      <circle cx="55" cy="32" r="5" fill="var(--cn-accent)" />
    </svg>
  );
}

export default function Logo(props: LogoProps) {
  const { size = 1.75, wordmark = true } = props;
  return (
    <span className="cn-logo" role="img" aria-label="Cinemion">
      <LogoSymbol size={size} />
      {wordmark && <span className="cn-logo__wordmark" style={{ fontSize: `${size * 0.76}rem` }}>cinemion</span>}
    </span>
  );
}
