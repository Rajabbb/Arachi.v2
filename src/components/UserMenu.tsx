import type { Quota } from "../../shared/protocol";
import { arachiSiteUrl, logout, type User } from "../lib/auth";

/** What is left of the plan's AI requests, as a short line. */
function quotaText(q: Quota): { text: string; warn: boolean } {
  if (q.expired) return { text: "Demo bitib", warn: true };
  if (q.limit === null) return { text: q.label, warn: false };
  const left = q.remaining ?? 0;
  const unit = q.period === "month" ? " / ay" : "";
  return { text: `${q.label}: ${left} / ${q.limit} sorğu qalıb${unit}`, warn: left === 0 || left <= Math.ceil(q.limit * 0.1) };
}

/** The signed-in user's name, plan allowance and a logout button, at the end of the header. */
export default function UserMenu({ user, quota }: { user: User; quota?: Quota }) {
  const q = quota ? quotaText(quota) : null;
  return (
    <div className="user-menu">
      {q && (
        <span className={`quota-chip${q.warn ? " warn" : ""}`} title="Planınızdakı Aİ sorğu limiti">
          {q.text}
          {q.warn && (
            <>
              {" · "}
              <a href={`${arachiSiteUrl}/customer`} target="_top">Plan seç</a>
            </>
          )}
        </span>
      )}
      <span className="user-name" title={user.name}>{user.name || "Müştəri"}</span>
      <button type="button" onClick={() => void logout()}>Çıxış</button>
    </div>
  );
}
