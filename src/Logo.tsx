import { useState } from "react";
import type { TeamBrief } from "../shared/types";

export function Logo({ team, size = 40 }: { team: TeamBrief; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!team.logoUrl || failed) {
    return (
      <span className="badge" style={style} title={team.name}>
        {team.abbrev.slice(0, 3)}
      </span>
    );
  }
  return (
    <img
      className="logo"
      src={team.logoUrl}
      alt=""
      width={size}
      height={size}
      style={style}
      referrerPolicy="no-referrer"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
