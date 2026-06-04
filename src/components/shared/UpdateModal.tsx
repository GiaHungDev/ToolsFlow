"use client";

import React, { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

export function UpdateModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const handleUpdate = () => {
      setIsOpen(true);
    };

    window.addEventListener("update-downloaded", handleUpdate);
    return () => window.removeEventListener("update-downloaded", handleUpdate);
  }, []);

  const handleUpdateNow = async () => {
    setIsUpdating(true);
    try {
      await fetch("http://localhost:52424/api/app/update", {
        method: "POST",
      });
    } catch (e) {
      console.error("Lỗi cập nhật", e);
      setIsUpdating(false);
    }
  };

  const handleLater = () => {
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-stone-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="bg-emerald-500 p-6 flex flex-col items-center justify-center text-center relative">
          <button 
            onClick={handleLater}
            className="absolute top-4 right-4 text-emerald-100 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-4">
            <Download className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white">Cập nhật phần mềm</h2>
        </div>
        <div className="p-6">
          <p className="text-stone-600 text-center mb-8">
            Phiên bản mới của Harumi AI đã được tải xuống tự động. Bạn có muốn khởi động lại ứng dụng để áp dụng ngay không?
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleUpdateNow}
              disabled={isUpdating}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isUpdating ? "Đang khởi động lại..." : "Cập nhật ngay"}
            </button>
            <button
              onClick={handleLater}
              disabled={isUpdating}
              className="w-full py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold rounded-xl transition"
            >
              Để sau
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
