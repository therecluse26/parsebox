import { useEffect, useRef, useState } from "react";
import type { ConversionRequest, ConversionResult } from "@/lib/convert/types";
import { LIMITS } from "@/config/limits";

export interface ConversionInput {
  text: string;
  inputFormat: string;
  outputFormat: string;
  outputFormatLocked: boolean;
  redactSecrets: boolean;
}

interface Job {
  size: number;
  sentAt: number;
}

// A job that is this old when a newer request is ready is cheaper to kill than to wait for
const STALE_JOB_MS = 250;

const createWorker = () =>
  new Worker(new URL("../workers/convert.worker.ts", import.meta.url), { type: "module" });

/**
 * Converts in a Web Worker. Small input converts at once; larger input waits
 * LIMITS.debounceMs after the last change. A newer request replaces an older one:
 * results with an older id are dropped, and a worker still busy with a large or
 * slow stale job is terminated and replaced.
 */
export function useConversion({ text, inputFormat, outputFormat, outputFormatLocked, redactSecrets }: ConversionInput) {
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const lastId = useRef(0);
  const shownId = useRef(0);
  // Jobs posted to the current worker and not answered yet, by id
  const jobs = useRef(new Map<number, Job>());

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      jobs.current.clear();
    },
    []
  );

  useEffect(() => {
    const request: ConversionRequest = {
      id: 0,
      text,
      inputFormat,
      outputFormat,
      outputFormatLocked,
      options: { redactSecrets },
    };

    const getWorker = () => {
      if (workerRef.current) return workerRef.current;
      const worker = createWorker();
      worker.onmessage = (event: MessageEvent<ConversionResult>) => {
        const received = event.data;
        jobs.current.delete(received.id);
        if (received.id > shownId.current) {
          shownId.current = received.id;
          setResult(received);
        }
        if (received.id === lastId.current) setBusy(false);
      };
      worker.onerror = (event) => {
        // The worker crashed or failed to load: report it and start a fresh one on the next request
        event.preventDefault();
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        jobs.current.clear();
        setBusy(false);
        setResult((previous) =>
          previous && { ...previous, output: "", outputError: `Conversion failed: ${event.message}` }
        );
      };
      workerRef.current = worker;
      return worker;
    };

    const send = () => {
      const now = performance.now();
      const stale = [...jobs.current.values()].some(
        (job) => job.size >= LIMITS.instantMaxChars || now - job.sentAt > STALE_JOB_MS
      );
      if (stale && workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
        jobs.current.clear();
      }
      const id = ++lastId.current;
      jobs.current.set(id, { size: text.length, sentAt: now });
      setBusy(true);
      getWorker().postMessage({ ...request, id });
    };

    if (text.length < LIMITS.instantMaxChars) {
      send();
      return;
    }
    const timer = setTimeout(send, LIMITS.debounceMs);
    return () => clearTimeout(timer);
  }, [text, inputFormat, outputFormat, outputFormatLocked, redactSecrets]);

  return { result, busy };
}

/** True once `flag` has stayed true for `delayMs`, so short work shows no indicator. */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [flag, delayMs]);
  return flag && shown;
}
