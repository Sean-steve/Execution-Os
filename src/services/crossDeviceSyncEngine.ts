/**
 * Cross-Device Execution Continuity & Sync Engine (EOS-003, EOS-004, EOS-014)
 * Manages user-scoped state synchronization across multiple devices with
 * optimistic UI, durable offline queuing, and deterministic conflict resolution.
 */

import {
  AppState,
  SyncStatus,
  DeviceProfile,
  ConflictResolutionRecord,
  ConflictType,
  SyncQueueItem,
  SyncMetadata,
  TomorrowPlan,
  RoutineTask
} from '../types';
import { ExecutionApiClient, defaultApiClient } from './apiClient';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { defaultIdempotencyStore } from '../server/idempotency';

const SYNC_QUEUE_STORAGE_KEY = 'execution_os_sync_queue_v1';
const CURRENT_DEVICE_STORAGE_KEY = 'execution_os_current_device_v1';
const CONFLICT_LOG_STORAGE_KEY = 'execution_os_conflict_log_v1';

export type SyncEventListener = (status: SyncStatus, metadata: SyncMetadata, state?: AppState) => void;

export class CrossDeviceSyncEngine {
  private apiClient: ExecutionApiClient;
  private currentDevice: DeviceProfile;
  private syncQueue: SyncQueueItem[] = [];
  private conflictLog: ConflictResolutionRecord[] = [];
  private syncStatus: SyncStatus = 'SYNCHRONIZED';
  private lastSyncedVersion: number = 1;
  private isOnline: boolean = true;
  private listeners: Set<SyncEventListener> = new Set();
  private autoSyncInterval: any = null;

  constructor(apiClient: ExecutionApiClient = defaultApiClient, initialDevice?: Partial<DeviceProfile>) {
    this.apiClient = apiClient;
    this.currentDevice = this.loadCurrentDevice(initialDevice);
    this.syncQueue = this.loadQueue();
    this.conflictLog = this.loadConflictLog();

    if (typeof window !== 'undefined') {
      this.isOnline = navigator.onLine !== false;
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
    }
  }

  // =========================================================================
  // DEVICE PROFILE & IDENTITY
  // =========================================================================

  private loadCurrentDevice(initial?: Partial<DeviceProfile>): DeviceProfile {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(CURRENT_DEVICE_STORAGE_KEY);
        if (stored) {
          return JSON.parse(stored);
        }
      }
    } catch (e) {
      console.warn('Failed to load stored device profile:', e);
    }

    const defaultDev: DeviceProfile = {
      id: initial?.id || 'device-desktop-a',
      name: initial?.name || 'Primary Workstation (Desktop A)',
      type: initial?.type || 'DESKTOP',
      lastSeenAt: new Date().toISOString(),
      isCurrentDevice: true,
      appVersion: '1.8.0',
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'Desktop',
    };

    this.saveCurrentDevice(defaultDev);
    return defaultDev;
  }

  private saveCurrentDevice(device: DeviceProfile): void {
    this.currentDevice = device;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(CURRENT_DEVICE_STORAGE_KEY, JSON.stringify(device));
      }
    } catch (e) {
      console.warn('Failed to persist device profile:', e);
    }
  }

  public getCurrentDevice(): DeviceProfile {
    return { ...this.currentDevice };
  }

  public switchSimulatedDevice(
    deviceId: string,
    deviceName: string,
    deviceType: 'DESKTOP' | 'MOBILE' | 'TABLET' = 'DESKTOP'
  ): DeviceProfile {
    const updated: DeviceProfile = {
      id: deviceId,
      name: deviceName,
      type: deviceType,
      lastSeenAt: new Date().toISOString(),
      isCurrentDevice: true,
      appVersion: '1.8.0',
      platform: deviceType === 'MOBILE' ? 'iOS / Mobile' : 'Desktop / Web',
    };
    this.saveCurrentDevice(updated);
    this.notifyListeners();
    return updated;
  }

  // =========================================================================
  // OFFLINE QUEUE MANAGEMENT
  // =========================================================================

  private loadQueue(): SyncQueueItem[] {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Failed to load sync queue:', e);
    }
    return [];
  }

  private saveQueue(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(SYNC_QUEUE_STORAGE_KEY, JSON.stringify(this.syncQueue));
      }
    } catch (e) {
      console.warn('Failed to save sync queue:', e);
    }
  }

  private loadConflictLog(): ConflictResolutionRecord[] {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(CONFLICT_LOG_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Failed to load conflict log:', e);
    }
    return [];
  }

  private saveConflictLog(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(CONFLICT_LOG_STORAGE_KEY, JSON.stringify(this.conflictLog.slice(-50)));
      }
    } catch (e) {
      console.warn('Failed to save conflict log:', e);
    }
  }

  public getPendingQueue(): SyncQueueItem[] {
    return [...this.syncQueue];
  }

  public getConflictLog(): ConflictResolutionRecord[] {
    return [...this.conflictLog];
  }

  public clearConflictLog(): void {
    this.conflictLog = [];
    this.saveConflictLog();
    this.notifyListeners();
  }

  public enqueueCommand(
    commandType: string,
    payload: any,
    baseVersion: number = this.lastSyncedVersion
  ): SyncQueueItem {
    const item: SyncQueueItem = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      idempotencyKey: `idemp_${this.currentDevice.id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      commandType,
      payload,
      createdAt: new Date().toISOString(),
      baseVersion,
      retryCount: 0,
      deviceId: this.currentDevice.id,
    };

    this.syncQueue.push(item);
    this.saveQueue();

    if (!this.isOnline) {
      this.syncStatus = 'OFFLINE';
    } else {
      this.syncStatus = 'SYNCING';
    }

    this.notifyListeners();
    return item;
  }

  // =========================================================================
  // NETWORK & SYNC STATUS
  // =========================================================================

  public isNetworkOnline(): boolean {
    return this.isOnline;
  }

  public setNetworkOnline(online: boolean): void {
    this.handleNetworkChange(online);
  }

  private handleNetworkChange(online: boolean): void {
    this.isOnline = online;
    if (!online) {
      this.syncStatus = 'OFFLINE';
    } else {
      this.syncStatus = this.syncQueue.length > 0 ? 'SYNCING' : 'SYNCHRONIZED';
      // Auto flush queue on reconnect
      this.pushPendingQueue().catch(err => console.warn('Auto flush on reconnect failed:', err));
    }
    this.notifyListeners();
  }

  public getSyncStatus(): SyncStatus {
    return this.syncStatus;
  }

  public getSyncMetadata(): SyncMetadata {
    return {
      version: this.lastSyncedVersion,
      lastSyncedAt: this.currentDevice.lastSeenAt,
      clientDeviceId: this.currentDevice.id,
      serverTimestamp: new Date().toISOString(),
      syncStatus: this.syncStatus,
      pendingQueueCount: this.syncQueue.length,
      conflictCount: this.conflictLog.length,
    };
  }

  // =========================================================================
  // CORE BIDIRECTIONAL SYNC ACTIONS
  // =========================================================================

  /**
   * Pulls authoritative state from server and updates local tracking
   */
  public async pullLatestState(
    localState?: AppState
  ): Promise<{ state: AppState; version: number; hasUpdates: boolean; conflictsResolved: ConflictResolutionRecord[] }> {
    if (!this.isOnline) {
      return {
        state: localState || DEFAULT_APP_STATE,
        version: this.lastSyncedVersion,
        hasUpdates: false,
        conflictsResolved: [],
      };
    }

    try {
      const response = await this.apiClient.syncPull(this.lastSyncedVersion, this.currentDevice.id);
      if (response && response.success && response.state) {
        const serverVersion = response.version || response.state.version || 1;
        const hasUpdates = serverVersion > this.lastSyncedVersion;
        this.lastSyncedVersion = serverVersion;

        this.currentDevice.lastSeenAt = new Date().toISOString();
        this.saveCurrentDevice(this.currentDevice);

        const conflictsResolved: ConflictResolutionRecord[] = (response as any)?.conflictsResolved || [];
        if (conflictsResolved.length > 0) {
          this.conflictLog.unshift(...conflictsResolved);
          this.saveConflictLog();
          this.syncStatus = 'CONFLICT_RESOLVED';
        } else if (this.syncQueue.length === 0) {
          this.syncStatus = 'SYNCHRONIZED';
        }

        const mergedState: AppState = {
          ...response.state,
          version: serverVersion,
          syncMetadata: this.getSyncMetadata(),
          registeredDevices: (response.state as any)?.registeredDevices || [this.currentDevice],
          conflictLog: this.conflictLog,
        };

        this.notifyListeners(mergedState);
        return { state: mergedState, version: serverVersion, hasUpdates, conflictsResolved };
      }
    } catch (err: any) {
      console.warn('Sync pull failed:', err?.message);
      if (!this.isOnline) {
        this.syncStatus = 'OFFLINE';
      }
    }

    return {
      state: localState || DEFAULT_APP_STATE,
      version: this.lastSyncedVersion,
      hasUpdates: false,
      conflictsResolved: [],
    };
  }

  /**
   * Pushes all pending queue items to the server
   */
  public async pushPendingQueue(
    currentState?: AppState
  ): Promise<{ success: boolean; state?: AppState; resolvedCount: number; conflicts: ConflictResolutionRecord[] }> {
    if (!this.isOnline || this.syncQueue.length === 0) {
      return { success: true, state: currentState, resolvedCount: 0, conflicts: [] };
    }

    this.syncStatus = 'SYNCING';
    this.notifyListeners();

    try {
      const itemsToPush = [...this.syncQueue];
      const res = await this.apiClient.syncPush(itemsToPush, this.lastSyncedVersion, this.currentDevice.id);

      if (res && res.success && res.state) {
        // Clear flushed items from queue
        this.syncQueue = [];
        this.saveQueue();

        const serverVersion = res.version || res.state.version || (this.lastSyncedVersion + 1);
        this.lastSyncedVersion = serverVersion;

        const resolvedConflicts: ConflictResolutionRecord[] = (res as any)?.resolvedConflicts || [];
        if (resolvedConflicts.length > 0) {
          this.conflictLog.unshift(...resolvedConflicts);
          this.saveConflictLog();
          this.syncStatus = 'CONFLICT_RESOLVED';
        } else {
          this.syncStatus = 'SYNCHRONIZED';
        }

        const nextState: AppState = {
          ...res.state,
          version: serverVersion,
          syncMetadata: this.getSyncMetadata(),
          registeredDevices: res.state.registeredDevices || [this.currentDevice],
          conflictLog: this.conflictLog,
        };

        this.notifyListeners(nextState);
        return {
          success: true,
          state: nextState,
          resolvedCount: itemsToPush.length,
          conflicts: resolvedConflicts,
        };
      }
    } catch (err: any) {
      console.error('Failed to push sync queue:', err);
      // Increment retry count
      this.syncQueue.forEach(item => {
        item.retryCount += 1;
        item.error = err?.message || 'Sync push failed';
      });
      this.saveQueue();
      this.syncStatus = this.isOnline ? 'CONFLICT' : 'OFFLINE';
      this.notifyListeners();
    }

    return { success: false, state: currentState, resolvedCount: 0, conflicts: [] };
  }

  /**
   * Deterministic client-side 3-way reconciliation helper
   */
  public resolveConflictLocally(
    conflictType: ConflictType,
    entityId: string,
    entityName: string,
    deviceA: string,
    deviceB: string,
    strategy: ConflictResolutionRecord['strategy'],
    summary: string,
    resolvedVersion: number
  ): ConflictResolutionRecord {
    const record: ConflictResolutionRecord = {
      id: `conflict_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      conflictType,
      entityId,
      entityName,
      deviceA,
      deviceB,
      strategy,
      resolutionSummary: summary,
      resolvedStateVersion: resolvedVersion,
    };

    this.conflictLog.unshift(record);
    this.saveConflictLog();
    this.syncStatus = 'CONFLICT_RESOLVED';
    this.notifyListeners();
    return record;
  }

  // =========================================================================
  // EVENT SUBSCRIPTIONS & BACKGROUND WORKER
  // =========================================================================

  public subscribe(listener: SyncEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(state?: AppState): void {
    const metadata = this.getSyncMetadata();
    this.listeners.forEach(fn => fn(this.syncStatus, metadata, state));
  }

  public startPeriodicSync(intervalMs: number = 4000, onStateReceived?: (state: AppState) => void): void {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
    }
    this.autoSyncInterval = setInterval(async () => {
      if (this.isOnline) {
        if (this.syncQueue.length > 0) {
          const pushRes = await this.pushPendingQueue();
          if (pushRes.success && pushRes.state && onStateReceived) {
            onStateReceived(pushRes.state);
          }
        } else {
          const pullRes = await this.pullLatestState();
          if (pullRes.hasUpdates && pullRes.state && onStateReceived) {
            onStateReceived(pullRes.state);
          }
        }
      }
    }, intervalMs);
  }

  public stopPeriodicSync(): void {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
    }
  }
}

export const defaultCrossDeviceSyncEngine = new CrossDeviceSyncEngine();
