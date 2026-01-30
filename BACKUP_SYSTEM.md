# Gym Tracker - Backup System Documentation

## Overview

The gym tracker app now includes an **offline-first, automatic cloud backup system** that ensures your data is safely backed up to the cloud whenever you make changes, without interfering with the app's offline functionality.

## Key Features

✅ **Automatic backups** - Data is automatically backed up after any meaningful change  
✅ **Offline-first** - App works 100% offline, backups only happen when online  
✅ **Silent operation** - No popups, no blocking, no error messages  
✅ **Full snapshots** - Each backup contains all your data (routines, workouts, weight entries)  
✅ **Device persistence** - Each device has a unique ID that persists across sessions  
✅ **Visual feedback** - Subtle "last backup" indicator in Settings  

## Architecture

### Backend
- **Production URL**: `https://gym-tracker-backup-api.onrender.com`
- **Endpoint**: `POST /backup`
- **Purpose**: Receive and store backup snapshots (NOT for sync or auth)

### Device Identification
- Each device generates a unique `deviceId` (UUID) on first use
- Stored in `localStorage` under key `gym-tracker-device-id`
- Never regenerated, never deleted automatically

### Backup Triggers

Backups are automatically triggered after these operations:

| Operation | Trigger Location |
|-----------|-----------------|
| Workout saved | `WorkoutHistoryRepository.add()` |
| Workout edited | `WorkoutHistoryRepository.add()` |
| Workout deleted | `WorkoutHistoryRepository.delete()` |
| Routine created | `RoutinesRepository.add()` |
| Routine edited | `RoutinesRepository.update()` |
| Routine deleted | `RoutinesRepository.delete()` |
| Weight entry saved | `BodyWeightRepository.upsert()` |
| Weight entry deleted | `BodyWeightRepository.delete()` |

### Data Flow

```
1. User performs action (e.g., saves workout)
   ↓
2. Repository persists to IndexedDB
   ↓
3. Repository calls triggerBackupAsync()
   ↓
4. BackupService checks:
   - Is online? (navigator.onLine)
   - Already sending? (isSendingBackup flag)
   ↓
5. If checks pass:
   - Create full snapshot from IndexedDB
   - Send to backend via POST /backup
   - Update lastBackupTime signal
   ↓
6. User continues using app (no blocking)
```

### Snapshot Format

Each backup sent to the backend contains:

```json
{
  "deviceId": "uuid-v4-string",
  "timestamp": "2026-01-30T12:34:56.789Z",
  "data": {
    "routines": [...],
    "workoutHistory": [...],
    "bodyWeight": [...]
  }
}
```

## Implementation Details

### BackupService

Location: `src/app/services/backup.service.ts`

**Key Methods:**
- `triggerBackup()` - Main entry point, called by repositories
- `createSnapshot()` - Reads all data from IndexedDB
- `sendBackupToServer()` - Sends snapshot to production backend
- `exportData()` - Manual export to JSON file
- `importData()` - Manual import from JSON file

**Public Signals:**
- `lastBackupTime` - Signal<Date | null> for UI display

### Repository Integration

**Pattern used in all repositories:**

```typescript
let backupServiceInstance: any = null;
function getBackupService() {
  if (!backupServiceInstance) {
    import('../services/backup.service').then(m => {
      backupServiceInstance = new m.BackupService();
    });
  }
  return backupServiceInstance;
}

function triggerBackupAsync() {
  setTimeout(() => {
    const service = getBackupService();
    if (service) {
      service.triggerBackup().catch(() => {/* silent */});
    }
  }, 0);
}
```

This pattern:
- Avoids circular dependencies (lazy import)
- Non-blocking (setTimeout)
- Silent failures (catch with no action)

### UI Integration

Location: `src/app/pages/settings/settings.component.html`

A subtle indicator shows when the last cloud backup occurred:

```html
<div *ngIf="lastBackupTime()" class="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
  <div class="flex items-center gap-2 text-xs text-green-800">
    <svg class="w-4 h-4 flex-shrink-0">...</svg>
    <span>Last cloud backup: 5 min ago</span>
  </div>
</div>
```

Time formatting:
- "Just now" (< 1 minute)
- "5 min ago" (< 1 hour)
- "2h ago" (< 24 hours)
- "3d ago" (>= 24 hours)

## Offline Behavior

### When Offline
- Backups are **silently skipped**
- No errors shown to user
- App continues working normally
- Data safely stored in IndexedDB

### When Coming Back Online
- Next data change will trigger a backup
- Full snapshot sent (includes all data, not just changes)
- User doesn't need to do anything

## Error Handling

### Silent Failures
All backup errors are silently caught and logged to console:

```typescript
try {
  await this.sendBackupToServer();
} catch (error) {
  console.debug('Backup failed (silent):', error);
}
```

**No user-facing errors for:**
- Network timeouts
- Backend errors (4xx, 5xx)
- Offline status
- Concurrent backup attempts

### Why Silent?
- Backups should never interrupt the user's workflow
- Offline-first means the app must work without backups
- Backups are best-effort, not critical path

## Storage

### LocalStorage
- `gym-tracker-device-id` - Persistent device UUID
- `last-backup-time` - ISO timestamp of last successful backup

### IndexedDB (Dexie)
Database: `GymTrackerDB` (version 4)
- `routines` - Workout templates
- `workoutHistory` - Completed workouts
- `activeTraining` - Current session (NOT backed up)
- `selectedRoutine` - UI state (NOT backed up)

### IndexedDB (Native)
Database: `gym-tracker` (version 2)
- `bodyWeight` - Weight tracking entries

## Testing

### Verify Backup System

1. **Open DevTools Console**
2. **Check device ID:**
   ```javascript
   localStorage.getItem('gym-tracker-device-id')
   ```
3. **Perform a data change** (e.g., save a workout)
4. **Check network tab** for POST to `/backup`
5. **Check Settings page** for "Last cloud backup" indicator

### Test Offline Behavior

1. **Open DevTools** → Network tab → Set to "Offline"
2. **Perform data changes** (should work normally)
3. **Go back online**
4. **Perform another change** (should trigger backup)

### Test Manual Backup

1. **Go to Settings**
2. **Click "Export Backup"** (downloads JSON file)
3. **Verify JSON structure** contains routines, workoutHistory, bodyWeight

## Manual Backup/Restore

The app still supports manual backup/restore via JSON files:

### Export
1. Settings → Export Backup
2. Downloads `gym-tracker-backup.json`

### Import
1. Settings → Import Backup → Select file
2. Confirms replacement of all data
3. Reloads app after import

## Future Enhancements (NOT IMPLEMENTED)

These are intentionally NOT implemented to keep the system simple:

- ❌ Background sync workers
- ❌ Retry mechanisms
- ❌ Differential/incremental backups
- ❌ Authentication
- ❌ Multi-device sync
- ❌ Conflict resolution
- ❌ Backup scheduling
- ❌ Data compression

## Troubleshooting

### Backup not triggering
- Check `navigator.onLine` in console
- Verify backend URL is reachable
- Check for console errors (search "backup")

### Device ID changing
- Check if localStorage is being cleared
- Verify browser settings allow localStorage
- Check Private/Incognito mode (localStorage won't persist)

### "Last backup" not showing
- Make a data change to trigger first backup
- Check that you're online
- Verify backup request succeeded in Network tab

## Security & Privacy

- Device IDs are randomly generated UUIDs (not personally identifiable)
- No authentication required (single-user app)
- No user accounts or login
- Data sent over HTTPS to production backend
- Backend should implement rate limiting (not handled by frontend)

## Maintenance

### Adding New Data Types

If you add a new data type that should be backed up:

1. **Update `createSnapshot()` in BackupService:**
   ```typescript
   const [routines, workoutHistory, bodyWeight, newType] = await Promise.all([
     db.routines.toArray(),
     db.workoutHistory.toArray(),
     BodyWeightRepository.getAll(),
     NewTypeRepository.getAll(), // Add here
   ]);

   return {
     routines,
     workoutHistory,
     bodyWeight,
     newType, // Add here
   };
   ```

2. **Add backup trigger to repository:**
   ```typescript
   async add(item: NewType) {
     await db.newType.put(item);
     triggerBackupAsync(); // Add this
   }
   ```

3. **Update `importData()` if needed** for restore functionality

## Summary

The backup system is:
- ✅ Production-ready
- ✅ Fully automatic
- ✅ Offline-first
- ✅ Silent and non-blocking
- ✅ Integrated with all data mutations
- ✅ Persistent across sessions
- ✅ Simple and maintainable

Your data is now automatically backed up to the cloud whenever you make changes, without any impact on the app's offline capabilities or user experience.
