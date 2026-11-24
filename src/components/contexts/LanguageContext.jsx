"use client";

import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useRouter, usePathname } from "next/navigation";

/**
 * Language Context
 * Provides language toggle and listener notification system
 */
export const LanguageContext = createContext({
  isCn: false,
  isLoading: true,
  toggleLanguage: () => {},
  onLanguageChange: () => {},
});

export const LanguageProvider = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();

  // =================== Local state =================== //
  const [isCn, setIsCn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

 // store listeners in a ref — avoids re-renders and infinite loops
  const listenersRef = useRef(new Set());

  // =================== Initialize from localStorage =================== //
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Restore the last choice; default EN when nothing is stored.
    const stored = localStorage.getItem("isCn");
    setIsCn(stored === "true");

    setIsLoading(false);
  }, []);

  // =================== Toggle Language =================== //
  const toggleLanguage = useCallback(() => {
    const newIsCn = !isCn;
    setIsCn(newIsCn);

    if (typeof window !== "undefined") {
      localStorage.setItem("isCn", newIsCn.toString());
    }

 // Notify all subscribed listeners (no state updates here)
    listenersRef.current.forEach((listener) => {
      try {
        listener(newIsCn);
      } catch (err) {
        console.log("Error notifying language listener:", err);
      }
    });

    // No navigation here: pushing the same URL remounts the provider and
    // resets state, which made the switch look dead.
    if (router) router.refresh();
  }, [isCn, router, pathname]);

  // =================== Add / Remove Listeners =================== //
  const onLanguageChange = useCallback((callback) => {
    if (typeof callback !== "function") return () => {};

    listenersRef.current.add(callback);

 // cleanup removes listener safely without re-render
    return () => {
      listenersRef.current.delete(callback);
    };
  }, []);

  // =================== Provider =================== //
  return (
    <LanguageContext.Provider
      value={{
        isCn,
        isLoading,
        toggleLanguage,
        onLanguageChange,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};