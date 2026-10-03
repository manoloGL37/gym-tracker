(async () => {
  const name = 'GymTrackerDB';
  const required = ['workoutHistory', 'routines', 'migrationLedgers'];
  const optional = ['activeTraining', 'cloudActiveTraining',
    'selectedRoutine', 'accountWorkoutCache'];
  const known = await indexedDB.databases();
  if (!known.some(entry => entry.name === name)) throw new Error('Base ausente; exportación cancelada');
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      request.transaction.abort();
      reject(new Error('Apertura requería cambio de esquema; cancelada'));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    if (required.some(store => !database.objectStoreNames.contains(store)))
      throw new Error('Falta un store esencial; no se exportó una copia incompleta');
    const stores = [...required, ...optional.filter(store =>
      database.objectStoreNames.contains(store))];
    const rows = await new Promise((resolve, reject) => {
      const output = {};
      const transaction = database.transaction(stores, 'readonly');
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.oncomplete = () => resolve(output);
      for (const store of stores) {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => { output[store] = request.result; };
      }
    });
    const snapshot = { app: 'gym-tracker-forensic-readonly',
      exportedAt: new Date().toISOString(), origin: location.origin,
      indexedDbVersion: database.version,
      missingOptional: optional.filter(store => !stores.includes(store)), stores: rows };
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot)],
      { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `gym-tracker-forensic-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    console.log('Exportación solicitada; recuentos:',
      Object.fromEntries(stores.map(store => [store, rows[store].length])));
    return snapshot;
  } finally { database.close(); }
})().catch(error => console.error('Exportación cancelada:', error.message));
