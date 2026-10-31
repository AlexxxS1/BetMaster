import { useState } from "react";
import type { TeamBrief } from "../shared/types";

export function Logo({ team }: { team: TeamBrief }) {
  const [failed, setFailed] = useState(false);
  if (!team.logoUrl || failed) {
    return <span className="badge">{team.abbrev.slice(0, 3)}</span>;
  }
  return (
    <img
      className="logo"
      src={team.logoUrl}
      alt=""
      width={32}
      height={32}
      onError={() => setFailed(true)}
    />
  );
}
