import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  onDismiss: () => void;
}

export function HeroSplash({ onDismiss }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Show the "click to continue" prompt after 2 seconds
    const timer = setTimeout(() => setShowPrompt(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    if (isExiting) return;
    setIsExiting(true);
    // Small delay for exit animation
    setTimeout(() => onDismiss(), 600);
  };

  return (
    <AnimatePresence>
      {!isExiting ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          onClick={handleDismiss}
          className="fixed inset-0 z-[200] cursor-pointer"
          style={{ backgroundColor: '#000' }}
        >
          {/* Full-screen video */}
          <video
            ref={videoRef}
            src="/assets/hero-video.mp4"
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Subtle gradient overlay at bottom for text readability */}
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />

          {/* "Click to continue" prompt */}
          <AnimatePresence>
            {showPrompt && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="absolute bottom-12 inset-x-0 flex flex-col items-center gap-4 pointer-events-none"
              >
                <p className="text-white/60 text-sm font-mono uppercase tracking-[0.4em]">
                  Toca para comenzar
                </p>
                <motion.div
                  animate={{ y: [0, 8, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="w-6 h-10 rounded-full border-2 border-white/30 flex items-start justify-center p-1.5"
                >
                  <motion.div className="w-1.5 h-1.5 rounded-full bg-white/60" />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="fixed inset-0 z-[200] bg-black pointer-events-none"
        />
      )}
    </AnimatePresence>
  );
}
