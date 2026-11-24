"use client";
// Auth gate for the manager area. The drawn pattern is verified SERVER-SIDE
// (/api/auth/pattern) against PATTERN_UNLOCK_PASSWORD. A 503 means the server
// has no secret configured: the gate fails closed instead of checking a copy.
import { useEffect, useState, useCallback } from "react";
import { Box, Alert, CircularProgress } from "@mui/material";
import PatternLock from "@/components/lockers/PatternLock";
import { patternVerdict } from "@/lib/patternPolicy";
import { clearLegacyPatternStorage } from "@/lib/legacyPatternCleanup";

async function checkSession() {
  try {
    const r = await fetch("/api/auth/pattern", { cache: "no-store" });
    if (!r.ok) return false;
    const d = await r.json();
    return Boolean(d?.authenticated);
  } catch {
    return false;
  }
}

async function verifyPattern(pattern) {
  try {
    const r = await fetch("/api/auth/pattern", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern }),
    });
    return patternVerdict(r.status, r.ok);
  } catch {
    return false;
  }
}

export default function ManagerAuthGate({ children }) {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    clearLegacyPatternStorage();
    let mounted = true;
    checkSession().then((v) => { if (mounted) { setAuthed(v); setChecking(false); } });
    return () => { mounted = false; };
  }, []);

  const onSuccess = useCallback(() => { setError(null); setAuthed(true); }, []);

  if (checking) {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", backgroundColor: "var(--background-primary, #ffffff)" }}>
        <CircularProgress sx={{ color: "var(--text-primary, #000000)" }} />
      </Box>
    );
  }

  if (!authed) {
    // The lock owns the full viewport and centres itself; wrapping it in a
    // second 100vh flex box + gap used to push it off-centre.
    return (
      <>
        {error && (
          <Alert
            severity="error"
            onClose={() => setError(null)}
            sx={{
              position: "fixed",
              top: 16,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 13000,
              width: "min(90vw, 420px)",
            }}
          >
            {error}
          </Alert>
        )}
        <PatternLock verify={verifyPattern} onSuccess={onSuccess} />
      </>
    );
  }

  return <>{children}</>;
}
