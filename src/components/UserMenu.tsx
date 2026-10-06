import { logout, type User } from "../lib/auth";

/** The signed-in user's name and a logout button, at the end of the header. */
export default function UserMenu({ user }: { user: User }) {
  return (
    <div className="user-menu">
      <span className="user-name" title={user.email}>{user.name || user.email}</span>
      <button type="button" onClick={() => void logout()}>Çıxış</button>
    </div>
  );
}
