"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function useVaultWS() {
  const router = useRouter();

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8080/ws");
    ws.onmessage = () => router.refresh();
    ws.onerror = () => {}; // silent if API offline
    return () => ws.close();
  }, [router]);
}
