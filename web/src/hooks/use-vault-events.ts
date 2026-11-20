"use client";

import { useEffect, useRef } from "react";

export interface VaultEvent {
  type: string;
  path?: string;
}

type Listener = (e: VaultEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (socket || typeof window === "undefined") return;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
  socket = ws;
  ws.onmessage = (m) => {
    let e: VaultEvent;
    try {
      e = JSON.parse(m.data);
    } catch {
      return;
    }
    listeners.forEach((l) => l(e));
  };
  ws.onclose = () => {
    socket = null;
    if (listeners.size && !retry) {
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, 3000);
    }
  };
}

/** Subscribe to live vault change events (one shared WebSocket per tab). */
export function useVaultEvents(listener: Listener) {
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    connect();
    return () => {
      listeners.delete(l);
      if (!listeners.size) {
        socket?.close();
        socket = null;
      }
    };
  }, []);
}
