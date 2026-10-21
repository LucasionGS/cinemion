import cx from "../../lib/cx.ts";
import "./TmdbCredit.scss";

export interface TmdbCreditProps {
  /**
   * Smaller, for inside a form. Default is `false`.
   */
  compact?: boolean;
}

/**
 * The attribution TMDB's API terms ask for: their logo (kept less prominent than Cinemion's own) and their notice,
 * word for word.
 */
export default function TmdbCredit(props: TmdbCreditProps) {
  const { compact = false } = props;
  return (
    <div className={cx("cn-tmdb-credit", compact && "cn-tmdb-credit--compact")}>
      <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="cn-tmdb-credit__logo">
        <img src="/credits/tmdb.svg" alt="TMDB" />
      </a>
      <p>This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.</p>
    </div>
  );
}
