import { ExternalLink } from "lucide-react";
import { session } from "../../Session.ts";
import useController from "../../lib/useController.ts";
import Logo from "../../components/Logo/Logo.tsx";
import TmdbCredit from "../../components/TmdbCredit/TmdbCredit.tsx";

/**
 * Which Cinemion this is, its license, and credits for the services it uses.
 */
export default function AboutSettings() {
  useController(session);
  const server = session.server;
  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>About</h1>
          <p>Which Cinemion this is, and who helps it know what's in your libraries.</p>
        </div>
      </header>

      <section className="cn-settings__card cn-about">
        <Logo size={2.5} />
        <div className="cn-about__text">
          <strong>Cinemion {server?.version}{server?.name && server.name !== "Cinemion" ? ` on ${server.name}` : ""}</strong>
          <span>A self-hosted home for your movies, shows, videos, music and books. Free software under the GNU General Public License, version 3 or later.</span>
        </div>
        <div className="cn-about__links">
          <a href="https://github.com/LucasionGS/cinemion" target="_blank" rel="noreferrer">Source code <ExternalLink aria-hidden="true" /></a>
          <a href="https://github.com/LucasionGS/cinemion/releases" target="_blank" rel="noreferrer">Releases <ExternalLink aria-hidden="true" /></a>
        </div>
      </section>

      <section className="cn-settings__card">
        <h2>Credits</h2>
        <TmdbCredit />
      </section>
    </>
  );
}
