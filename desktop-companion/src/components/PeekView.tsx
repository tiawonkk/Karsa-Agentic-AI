import React from "react";
import { ColorEyes } from "./ColorEyes";

interface PeekViewProps {
  isDark: boolean;
  mascotColor: string;
  eyeColor: string;
  dailySafeSpendIdr: number | null;
}

const formatRupiah = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

/**
 * PeekView: the 220px x 40px hover state. A short mascot greeting plus today's real Daily Safe Spend
 * (from /api/v1/dashboard/summary). With no data (backend offline) it shows no number instead of a fake one.
 */
// isDark/mascotColor/eyeColor stay in the props so callers do not change
export const PeekView: React.FC<PeekViewProps> = ({ dailySafeSpendIdr }) => (
  <div className="w-full h-full flex items-center gap-2 cursor-pointer select-none">
    <div className="flex-shrink-0 w-[40px] flex items-center justify-center" aria-hidden="true">
      <ColorEyes scale={0.62} follow={false} />
    </div>
    <div className="min-w-0 leading-tight">
      <div className="text-[11px] font-semibold tracking-tight text-slate-900 dark:text-zinc-50 truncate">
        Hai, Karsa di sini!
      </div>
      <div className="text-[10px] font-mono font-medium text-slate-600 dark:text-slate-400 truncate">
        {dailySafeSpendIdr !== null ? `Safe spend ${formatRupiah(dailySafeSpendIdr)}/hari` : "Klik untuk membuka"}
      </div>
    </div>
  </div>
);

export default PeekView;
