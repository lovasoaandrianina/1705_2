// Domino blanc : a / b = les deux moitiés. dir « v » (vertical, en main) ou « h » (horizontal, sur la table). back = face cachée.
const PIPS = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
const Half = ({ n }) => (
  <div className="dm-half">{Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[n].includes(i) ? "on" : ""} />)}</div>
);
export default function Tile({ a, b, dir = "v", back, sel, className = "", ...rest }) {
  const cls = `dm-tile dm-${dir} ${back ? "dm-back" : ""} ${sel ? "sel" : ""} ${className}`;
  if (back) return <div className={cls} {...rest} />;
  return <div className={cls} {...rest}><Half n={a} /><span className="dm-bar" /><Half n={b} /></div>;
}