import React from "react";
import { motion } from "framer-motion";

const LoadingScreen: React.FC = () => {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-gray-900 opacity-50 text-white z-50">
      {/* Animated Logo or Spinner */}
      <motion.div
        className="w-16 h-16 border-4 border-t-transparent border-blue-500 rounded-full"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
      />

      {/* Loading Text */}
      <motion.p
        className="mt-6 text-lg font-medium tracking-wide"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0] }}
        transition={{ repeat: Infinity, duration: 2 }}
      >
        Loading...
      </motion.p>
    </div>
  );
};

export default LoadingScreen;
