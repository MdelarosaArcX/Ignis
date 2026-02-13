import React from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, children }) => {
  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-[90%] max-w-[100%] max-h-[80vh] animate-fadeIn flex flex-col"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-red-500 transition"
        >
          ✖
        </button>

        {/* Scrollable content wrapper */}
        <div className="p-6 overflow-y-auto flex-1 rounded-b-2xl">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;
