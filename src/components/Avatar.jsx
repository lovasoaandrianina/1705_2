export default function Avatar({ user, big }) {
  const cls = `avatar ${big ? "big" : ""}`;
  return user.avatar
    ? <img className={cls} src={user.avatar} alt="" />
    : <div className={cls}>{(user.pseudo || "?")[0].toUpperCase()}</div>;
}
