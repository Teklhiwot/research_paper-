/**
 * useOfflineQueue.js
 *
 * Offline-resilient report submission hook.
 *
 * Flush triggers:
 *  1. Network recovery  – via @react-native-community/netinfo addEventListener
 *  2. App foreground    – via React Native AppState 'change' → 'active'
 *  3. Inline on submit  – if the device is already online at submission time
 *
 * A ref-based mutex (isFlushing) prevents concurrent flush operations.
 *
 * Usage:
 *   const { submitReport, isFlushing } = useOfflineQueue();
 *   // In your submit handler:
 *   const status = await submitReport(payload); // 'sent' | 'queued'
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { enqueueReport, flushPendingReports } from '../services/reportService';

export function useOfflineQueue() {
  const flushingRef = useRef(false);
  const [isFlushing, setIsFlushing] = useState(false);

  /**
   * Mutex-guarded flush.
   * Returns the number of reports that failed (0 = all sent, null = skipped due to concurrent flush).
   */
  const safeFlush = useCallback(async () => {
    if (flushingRef.current) return null;

    flushingRef.current = true;
    setIsFlushing(true);

    try {
      return await flushPendingReports();
    } catch (err) {
      console.warn('[useOfflineQueue] Unexpected flush error:', err.message);
      return null;
    } finally {
      flushingRef.current = false;
      setIsFlushing(false);
    }
  }, []);

  useEffect(() => {
    // ── 1. Flush on network recovery ──────────────────────────────────────────
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        safeFlush();
      }
    });

    // ── 2. Flush when app returns to foreground ────────────────────────────────
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        safeFlush();
      }
    });

    return () => {
      unsubscribeNetInfo();
      appStateSub.remove();
    };
  }, [safeFlush]);

  /**
   * Submit a report with offline resilience:
   *  1. Persist to AsyncStorage first (crash-safe).
   *  2. Check current network state.
   *  3. If online, flush the queue immediately; return 'sent' when fully drained.
   *  4. If offline (or flush partially failed), return 'queued'.
   *
   * @param {object} report - Canonical report payload.
   * @returns {Promise<'sent'|'queued'>}
   */
  const submitReport = useCallback(
    async (report) => {
      // Always persist first — if the app crashes before the POST we don't lose data
      await enqueueReport(report);

      const netState = await NetInfo.fetch();

      if (netState.isConnected && netState.isInternetReachable) {
        const remaining = await safeFlush();
        // remaining === 0  → every queued report (including ours) was sent
        // remaining > 0    → some failed; retry on next flush trigger
        // remaining null   → a flush was already in progress; will pick it up
        return remaining === 0 ? 'sent' : 'queued';
      }

      return 'queued';
    },
    [safeFlush],
  );

  return { submitReport, isFlushing };
}
