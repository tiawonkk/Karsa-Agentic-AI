import React, { useState } from "react";
import { Monitor, Loader2, Check } from "lucide-react";

interface ScreenAssistBtnProps {
  onCaptureSuccess: (contextData: any) => void;
}

export const ScreenAssistBtn: React.FC<ScreenAssistBtnProps> = ({ onCaptureSuccess }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleCapture = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/v1/screen/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_consented: true }),
      });
      const data = await res.json();
      if (data.status === "success") {
        setIsSuccess(true);
        setTimeout(() => setIsSuccess(false), 2000);
        onCaptureSuccess(data.context);
      }
    } catch (err) {
      console.error("ScreenAssist error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleCapture}
      disabled={isLoading}
      className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-xl bg-[#1A1917] hover:bg-[#242220] border border-white/8 text-neutral-300 hover:text-[#FAF9F6] transition shadow-tactile-rest font-sans"
      title="ScreenAssist: Baca jendela aktif untuk konsultasi materi kuliah atau debug kode"
    >
      {isLoading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D95D39]" />
      ) : isSuccess ? (
        <Check className="w-3.5 h-3.5 text-[#3B7A57]" />
      ) : (
        <Monitor className="w-3.5 h-3.5 text-[#D95D39]" />
      )}
      <span className="font-medium text-[11px]">Baca Layar</span>
    </button>
  );
};
