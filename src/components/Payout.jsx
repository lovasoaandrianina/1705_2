import { fmt } from "../config";

// Détail transparent du règlement : pot, mise, gain net, commission, montant ajouté au solde
export default function Payout({ result: R, me, winnerName }) {
  const paid = R.paid[me], staked = R.staked[me], net = paid - staked, fee = R.fees?.[me] || 0;
  return (
    <>
      <p className="po-title">{net - fee > 0 ? `Tu gagnes ${fmt(net - fee)}` : net < 0 ? `Tu perds ${fmt(-net)}` : "Tu récupères ta mise"}</p>
      {paid > 0 && (
        <div className="recap">
          <div><span>Reçu du pot</span><span>{fmt(paid)}</span></div>
          <div><span>Ta mise</span><span>−{fmt(staked)}</span></div>
          <div><span>Gain net</span><span>{fmt(net)}</span></div>
          {fee > 0 && <div className="fee"><span>Commission</span><span>−{fmt(fee)}</span></div>}
          <div className="tot"><span>Ajouté à ton solde</span><span>{fmt(paid - fee)}</span></div>
        </div>
      )}
      <div className="po-note">
        Pot {fmt(R.pot)} · {winnerName} empoche {fmt(R.winnerAmount)}
      </div>
    </>
  );
}