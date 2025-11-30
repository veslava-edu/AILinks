import { AnalyzedEmail } from "../types";

let dbInstance: any = null;
const DB_NAME = "EmailIntelligenceDB";
const STORE_NAME = "sqlite_store";
const DB_KEY = "main_db";

/**
 * Normaliza URLs para comparación de duplicados.
 * Especialmente importante para URLs de Twitter/X que tienen parámetros de tracking.
 * 
 * Ejemplos:
 * - https://x.com/tom_doerr/status/1994122993606205769?t=aZeb0OUI61NZnm-8NI-HKg&s=03
 *   -> https://x.com/tom_doerr/status/1994122993606205769
 * - https://twitter.com/user/status/123456 -> https://x.com/user/status/123456
 * - Otras URLs se mantienen igual
 */
function normalizeUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  
  try {
    // Normalizar URLs de Twitter/X
    // Patrón: https://x.com/USER/status/STATUS_ID o https://twitter.com/USER/status/STATUS_ID
    const twitterPattern = /^https?:\/\/(x\.com|twitter\.com)\/([^\/]+)\/status\/(\d+)/i;
    const twitterMatch = url.match(twitterPattern);
    
    if (twitterMatch) {
      // Normalizar a x.com y eliminar parámetros de query
      const username = twitterMatch[2];
      const statusId = twitterMatch[3];
      return `https://x.com/${username}/status/${statusId}`;
    }
    
    // Para otras URLs, eliminar parámetros de query comunes de tracking
    // pero mantener la URL base
    try {
      const urlObj = new URL(url);
      // Eliminar parámetros de tracking comunes
      const trackingParams = ['t', 's', 'utm_source', 'utm_medium', 'utm_campaign', 'ref'];
      trackingParams.forEach(param => urlObj.searchParams.delete(param));
      
      // Si después de eliminar parámetros de tracking no quedan parámetros, devolver sin query
      if (urlObj.searchParams.toString() === '') {
        return urlObj.origin + urlObj.pathname;
      }
      
      return urlObj.toString();
    } catch {
      // Si no se puede parsear como URL, devolver tal cual
      return url;
    }
  } catch {
    return url;
  }
}

/**
 * Normaliza un array de URLs
 */
function normalizeUrls(urls: string[]): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map(normalizeUrl).filter(url => url && url.length > 0);
}

// --- IndexedDB Persistence Helpers ---
const getIDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (event: any) => resolve(event.target.result);
    request.onerror = (event: any) => reject(event.target.error);
  });
};

const saveDBToStorage = async (data: Uint8Array) => {
  const db = await getIDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(data, DB_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const loadDBFromStorage = async (): Promise<Uint8Array | null> => {
  const db = await getIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(DB_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

// --- BD Folder Helpers ---

/**
 * Busca y carga la base de datos SQLite más reciente de la carpeta bd
 * @returns Uint8Array con los datos de la BD o null si no se encuentra
 */
const loadDBFromBdFolder = async (): Promise<Uint8Array | null> => {
  try {
    // Generar lista de posibles archivos SQLite con fechas recientes (últimos 30 días)
    const possibleFiles: string[] = [];
    
    // Agregar archivos de los últimos 30 días (intentar con rutas relativas y absolutas)
    for (let i = 0; i < 30; i++) {
      const date = new Date(Date.now() - i * 86400000);
      const dateStr = date.toISOString().slice(0, 10);
      // Intentar con ruta relativa
      possibleFiles.push(`bd/email_intelligence_${dateStr}.sqlite`);
      // Intentar con ruta absoluta (para desarrollo con Vite)
      possibleFiles.push(`/bd/email_intelligence_${dateStr}.sqlite`);
    }
    
    // También intentar con el patrón que vimos en el proyecto
    possibleFiles.push('bd/email_intelligence_2025-11-30.sqlite');
    possibleFiles.push('/bd/email_intelligence_2025-11-30.sqlite');
    
    // Intentar cargar cada archivo hasta encontrar uno válido
    // Usamos Promise.allSettled para intentar cargar varios en paralelo
    const loadPromises = possibleFiles.map(async (filePath) => {
      try {
        const response = await fetch(filePath);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          
          // Validar que es un archivo SQLite válido (debe empezar con la cabecera SQLite)
          if (uint8Array.length > 0) {
            // Verificar cabecera SQLite: "SQLite format 3\000"
            const header = String.fromCharCode(...uint8Array.slice(0, 16));
            if (header.startsWith('SQLite format 3')) {
              return { filePath, data: uint8Array };
            }
          }
        }
      } catch (e) {
        // Continuar con el siguiente archivo
      }
      return null;
    });
    
    // Esperar a que se resuelvan todas las promesas
    const results = await Promise.allSettled(loadPromises);
    
    // Encontrar el primer resultado válido
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { filePath, data } = result.value;
        console.log(`[DB] Cargada BD desde carpeta bd: ${filePath}`);
        return data;
      }
    }
    
    console.log('[DB] No se encontró BD en carpeta bd');
    return null;
  } catch (error: any) {
    console.warn('[DB] Error intentando cargar desde carpeta bd:', error.message);
    return null;
  }
};

/**
 * Guarda una copia de la BD en la carpeta bd usando File System Access API
 * Si no está disponible, guarda en IndexedDB con un nombre específico
 * @param data Datos de la BD a guardar
 * @param fileName Nombre del archivo (opcional, se genera automáticamente si no se proporciona)
 */
const saveDBToBdFolder = async (data: Uint8Array, fileName?: string): Promise<void> => {
  try {
    // Generar nombre de archivo con fecha actual si no se proporciona
    if (!fileName) {
      const today = new Date().toISOString().slice(0, 10);
      fileName = `email_intelligence_${today}.sqlite`;
    }
    
    // Guardar siempre en IndexedDB como backup
    try {
      const db = await getIDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        // Guardar también con el nombre del archivo como clave adicional
        const request = store.put(data, `bd_backup_${fileName}`);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      console.log(`[DB] Backup guardado en IndexedDB: ${fileName}`);
    } catch (error: any) {
      console.warn(`[DB] Error guardando backup en IndexedDB:`, error.message);
    }
    
    // Intentar usar File System Access API (disponible en Chrome/Edge)
    // Nota: Esta API permite al usuario elegir dónde guardar, no podemos forzar una carpeta específica
    // pero podemos sugerir el nombre del archivo y el usuario puede navegar a la carpeta bd del proyecto
    if ('showSaveFilePicker' in window) {
      try {
        // @ts-ignore - File System Access API
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'SQLite Database',
            accept: { 'application/x-sqlite3': ['.sqlite'] }
          }],
          // Sugerir el nombre del archivo, el usuario puede navegar a la carpeta bd del proyecto
        });
        
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        
        console.log(`[DB] BD guardada en carpeta seleccionada por el usuario: ${fileName}`);
        // Nota: El archivo se guarda donde el usuario elija, idealmente en la carpeta bd del proyecto
        return;
      } catch (error: any) {
        // Si el usuario cancela, no es un error crítico
        if (error.name === 'AbortError') {
          console.log('[DB] Usuario canceló el guardado en carpeta (el backup en IndexedDB se mantiene)');
          return;
        }
        // Para otros errores, continuar (ya tenemos el backup en IndexedDB)
        console.warn('[DB] Error usando File System Access API:', error.message);
      }
    } else {
      // File System Access API no disponible (Firefox, Safari)
      console.log('[DB] File System Access API no disponible. El backup se guardó en IndexedDB.');
      console.log('[DB] Para guardar en carpeta bd, usa un navegador compatible (Chrome/Edge) o descarga manualmente.');
    }
  } catch (error: any) {
    console.warn(`[DB] Error guardando BD en carpeta bd:`, error.message);
    // No lanzar error, solo registrar advertencia (ya tenemos el backup en IndexedDB)
  }
};

// --- SQL.js Logic ---

const loadSqlJs = async () => {
  if (dbInstance) return dbInstance;

  if (!window.initSqlJs) {
    throw new Error("SQL.js not loaded properly in index.html");
  }

  const SQL = await window.initSqlJs({
    // Point to the wasm file hosted on CDN
    locateFile: (file: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
  });

  // Prioridad de carga:
  // 1. Primero intentar cargar desde carpeta bd (más reciente)
  // 2. Si no hay en bd, cargar desde IndexedDB
  // 3. Si no hay nada, crear nueva BD
  
  let savedData: Uint8Array | null = null;
  
  // Intentar cargar desde carpeta bd primero
  savedData = await loadDBFromBdFolder();
  
  // Si no se encontró en bd, intentar desde IndexedDB
  if (!savedData) {
    savedData = await loadDBFromStorage();
  }
  
  if (savedData) {
    dbInstance = new SQL.Database(savedData);
    // Si cargamos desde bd, también sincronizar con IndexedDB para persistencia
    if (savedData) {
      try {
        await saveDBToStorage(savedData);
        console.log('[DB] BD sincronizada con IndexedDB');
      } catch (e) {
        console.warn('[DB] Error sincronizando con IndexedDB:', e);
      }
    }
  } else {
    dbInstance = new SQL.Database();
    initTable(dbInstance);
  }
  
  return dbInstance;
};

const initTable = (db: any) => {
  const query = `
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fileName TEXT,
      fechaEnvio TEXT,
      tematica TEXT,
      etiquetas TEXT,
      contenido TEXT,
      urls TEXT
    );
  `;
  db.run(query);
};

export const getAllEmails = async (): Promise<AnalyzedEmail[]> => {
  const db = await loadSqlJs();
  const res = db.exec("SELECT * FROM emails ORDER BY id DESC");
  
  if (res.length === 0) return [];

  const columns = res[0].columns;
  const values = res[0].values;

  return values.map((row: any[]) => {
    const entry: any = {};
    columns.forEach((col: string, i: number) => {
      entry[col] = row[i];
    });
    
    // Parse JSON fields
    return {
      id: entry.id.toString(),
      fileName: entry.fileName,
      fechaEnvio: entry.fechaEnvio,
      tematica: entry.tematica,
      etiquetas: JSON.parse(entry.etiquetas || "[]"),
      contenido: entry.contenido,
      urls: JSON.parse(entry.urls || "[]"),
      status: 'completed'
    };
  });
};

export const saveToDb = async (emails: AnalyzedEmail[]) => {
  if (!emails || emails.length === 0) {
    console.warn('[DB] No hay emails para guardar');
    return;
  }

  const db = await loadSqlJs();
  
  // 1. Get existing file names and URLs to check for duplicates
  const existingFileNames = await getExistingFileNames();
  const existingRes = db.exec("SELECT urls FROM emails");
  const existingUrlSets: Set<string> = new Set();
  const existingNormalizedUrlSets: Set<string> = new Set();
  
  if (existingRes.length > 0) {
    existingRes[0].values.forEach((row: any[]) => {
      try {
        const urls = JSON.parse(row[0] || "[]");
        if (Array.isArray(urls)) {
            urls.forEach(u => {
              existingUrlSets.add(u);
              // También agregar versión normalizada para comparación
              const normalized = normalizeUrl(u);
              existingNormalizedUrlSets.add(normalized);
            });
        }
      } catch (e) { /* ignore parse errors */ }
    });
  }

  // Begin transaction
  db.run("BEGIN;");
  
  const stmt = db.prepare(`
    INSERT INTO emails (fileName, fechaEnvio, tematica, etiquetas, contenido, urls) 
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let addedCount = 0;
  const errors: string[] = [];

  emails.forEach((email, index) => {
    try {
      // Validate email data
      if (!email.fileName) {
        errors.push(`Email ${index + 1}: fileName faltante`);
        return;
      }

      // Enhanced Deduplication Logic:
      // PRIORIDAD: URLs del contenido (especialmente Twitter/X) > fileName
      // Esto permite detectar duplicados incluso si el nombre del archivo cambia
      let isDuplicate = false;
      let duplicateReason = '';
      
      // 1. Check by URLs first (prioridad sobre fileName)
      // Esto es crítico porque el mismo post puede llegar con diferentes nombres de archivo
      if (email.urls && email.urls.length > 0) {
        const normalizedUrls = normalizeUrls(email.urls);
        
        for (let i = 0; i < email.urls.length; i++) {
          const url = email.urls[i];
          const normalizedUrl = normalizedUrls[i];
          
          // Verificar URL original y normalizada
          if (existingUrlSets.has(url) || existingNormalizedUrlSets.has(normalizedUrl)) {
            isDuplicate = true;
            duplicateReason = `URL ya existe en BD: ${normalizedUrl}`;
            console.log(`[DB] Skipping duplicate email (found existing URL): ${normalizedUrl} (original: ${url})`);
            break;
          }
        }
      }
      
      // 2. Check by fileName (solo si no es duplicado por URL)
      if (!isDuplicate && email.fileName && existingFileNames.has(email.fileName)) {
        isDuplicate = true;
        duplicateReason = `fileName ya existe en BD: ${email.fileName}`;
        console.log(`[DB] Skipping duplicate email (found existing fileName): ${email.fileName}`);
      }

      if (!isDuplicate) {
          // Add to sets for next iteration within this batch
          if (email.fileName) existingFileNames.add(email.fileName);
          if (email.urls && Array.isArray(email.urls)) {
            email.urls.forEach(u => {
              existingUrlSets.add(u);
              // También agregar versión normalizada
              const normalized = normalizeUrl(u);
              existingNormalizedUrlSets.add(normalized);
            });
          }

          // Ensure arrays are valid
          const tagsStr = JSON.stringify(Array.isArray(email.etiquetas) ? email.etiquetas : []);
          const urlsStr = JSON.stringify(Array.isArray(email.urls) ? email.urls : []);
          
          // Ensure strings are not null/undefined
          const fileName = email.fileName || '';
          const fechaEnvio = email.fechaEnvio || '';
          const tematica = email.tematica || 'Sin clasificar';
          const contenido = email.contenido || '';
          
          stmt.run([
            fileName,
            fechaEnvio,
            tematica,
            tagsStr,
            contenido,
            urlsStr
          ]);
          addedCount++;
      }
    } catch (emailError: any) {
      const errorMsg = `Error procesando email ${index + 1} (${email.fileName || 'sin nombre'}): ${emailError.message}`;
      errors.push(errorMsg);
      console.error(`[DB] ${errorMsg}`, emailError);
    }
  });

  stmt.free();
  db.run("COMMIT;");

  // Log errors if any
  if (errors.length > 0) {
    console.warn(`[DB] Errores durante el guardado: ${errors.length}`, errors);
  }

  // Persist to IndexedDB if changes were made
  if (addedCount > 0) {
      try {
        const binaryArray = db.export();
        await saveDBToStorage(binaryArray);
        console.log(`[DB] Guardados ${addedCount} email(s) exitosamente`);
      } catch (storageError: any) {
        console.error(`[DB] Error guardando en IndexedDB:`, storageError);
        throw new Error(`Error guardando en almacenamiento: ${storageError.message}`);
      }
  } else {
    console.log(`[DB] No se agregaron nuevos emails (todos eran duplicados o hubo errores)`);
  }

  if (errors.length > 0) {
    throw new Error(`Errores guardando algunos emails: ${errors.join('; ')}`);
  }
};

export const exportDb = async (): Promise<Uint8Array> => {
  const db = await loadSqlJs();
  return db.export();
};

/**
 * Exporta la BD y guarda una copia automáticamente en la carpeta bd
 * @returns Uint8Array con los datos de la BD exportada
 */
export const exportDbAndSaveToBd = async (): Promise<Uint8Array> => {
  const db = await loadSqlJs();
  const exportedData = db.export();
  
  // Guardar copia en carpeta bd (en segundo plano, no bloquea)
  const today = new Date().toISOString().slice(0, 10);
  const fileName = `email_intelligence_${today}.sqlite`;
  saveDBToBdFolder(exportedData, fileName).catch(error => {
    console.warn('[DB] No se pudo guardar copia en carpeta bd:', error);
  });
  
  return exportedData;
};

export const resetDb = async () => {
    // CAUTION: This completely wipes the DB in memory and storage
    if(dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
    
    // Clear IndexedDB
    const db = await getIDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(DB_KEY);
    
    // Re-init
    await loadSqlJs();
};

// Get all existing file names for duplicate checking
export const getExistingFileNames = async (): Promise<Set<string>> => {
  const db = await loadSqlJs();
  const res = db.exec("SELECT fileName FROM emails");
  const fileNames = new Set<string>();
  
  if (res.length > 0) {
    res[0].values.forEach((row: any[]) => {
      if (row[0]) {
        fileNames.add(row[0]);
      }
    });
  }
  
  return fileNames;
};

// Check if an email exists by fileName
export const checkEmailExists = async (fileName: string): Promise<boolean> => {
  const existingNames = await getExistingFileNames();
  return existingNames.has(fileName);
};

// Delete records by IDs
export const deleteRecords = async (ids: string[]): Promise<void> => {
  if (!ids || ids.length === 0) {
    console.warn('[DB] No hay IDs para eliminar');
    return;
  }

  const db = await loadSqlJs();
  
  // Begin transaction
  db.run("BEGIN;");
  
  try {
    // Delete records by ID
    const placeholders = ids.map(() => '?').join(',');
    const query = `DELETE FROM emails WHERE id IN (${placeholders})`;
    
    const stmt = db.prepare(query);
    stmt.run(ids.map(id => parseInt(id, 10)));
    stmt.free();
    
    db.run("COMMIT;");
    
    // Persist changes to IndexedDB
    const binaryArray = db.export();
    await saveDBToStorage(binaryArray);
    
    console.log(`[DB] Eliminados ${ids.length} registro(s) exitosamente`);
  } catch (error: any) {
    db.run("ROLLBACK;");
    console.error(`[DB] Error eliminando registros:`, error);
    throw new Error(`Error eliminando registros: ${error.message}`);
  }
};

// Import SQLite database from file and merge with existing data
export const importDb = async (file: File): Promise<{ imported: number; skipped: number; errors?: string[] }> => {
  if (!window.initSqlJs) {
    throw new Error("SQL.js not loaded properly in index.html");
  }

  const SQL = await window.initSqlJs({
    locateFile: (file: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
  });

  // Read the uploaded file
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Load the imported database
  const importedDb = new SQL.Database(uint8Array);
  
  // Get current database
  const currentDb = await loadSqlJs();
  
  // Get existing file names and URLs from current DB
  const existingFileNames = await getExistingFileNames();
  const existingRes = currentDb.exec("SELECT urls FROM emails");
  const existingUrlSets: Set<string> = new Set();
  const existingNormalizedUrlSets: Set<string> = new Set();
  
  if (existingRes.length > 0) {
    existingRes[0].values.forEach((row: any[]) => {
      try {
        const urls = JSON.parse(row[0] || "[]");
        if (Array.isArray(urls)) {
          urls.forEach(u => {
            existingUrlSets.add(u);
            const normalized = normalizeUrl(u);
            existingNormalizedUrlSets.add(normalized);
          });
        }
      } catch (e) { /* ignore parse errors */ }
    });
  }
  
  // Get all emails from imported database
  let importedRes;
  try {
    importedRes = importedDb.exec("SELECT * FROM emails");
  } catch (error: any) {
    importedDb.close();
    throw new Error(`Error al leer la base de datos importada: ${error.message || 'Estructura de tabla no válida'}`);
  }
  
  if (!importedRes || importedRes.length === 0) {
    importedDb.close();
    return { imported: 0, skipped: 0 };
  }
  
  const columns = importedRes[0].columns;
  const values = importedRes[0].values;
  
  // Validate that required columns exist
  const requiredColumns = ['fileName'];
  const missingColumns = requiredColumns.filter(col => !columns.includes(col));
  if (missingColumns.length > 0) {
    importedDb.close();
    throw new Error(`La base de datos importada no tiene las columnas requeridas: ${missingColumns.join(', ')}`);
  }
  
  // Begin transaction
  currentDb.run("BEGIN;");
  
  const stmt = currentDb.prepare(`
    INSERT INTO emails (fileName, fechaEnvio, tematica, etiquetas, contenido, urls) 
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  let importedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];
  
  values.forEach((row: any[], index: number) => {
    try {
      const entry: any = {};
      columns.forEach((col: string, i: number) => {
        entry[col] = row[i];
      });
      
      const fileName = entry.fileName || null;
      
      // Validate required fields
      if (!fileName) {
        errors.push(`Fila ${index + 1}: fileName faltante, omitida`);
        skippedCount++;
        return;
      }
      
      // Check for duplicates: PRIORIDAD URLs > fileName
      let isDuplicate = false;
      
      // 1. Check by URLs first (prioridad sobre fileName)
      if (entry.urls) {
        try {
          const urls = typeof entry.urls === 'string' ? JSON.parse(entry.urls || "[]") : entry.urls;
          if (Array.isArray(urls) && urls.length > 0) {
            const normalizedUrls = normalizeUrls(urls);
            for (let i = 0; i < urls.length; i++) {
              const url = urls[i];
              const normalizedUrl = normalizedUrls[i];
              
              if (existingUrlSets.has(url) || existingNormalizedUrlSets.has(normalizedUrl)) {
                isDuplicate = true;
                skippedCount++;
                console.log(`Skipping duplicate email (found existing URL): ${normalizedUrl} (original: ${url})`);
                break;
              }
            }
          }
        } catch (e) {
          console.warn(`Error parsing URLs for ${fileName}:`, e);
          // Continue, don't skip because of URL parse error
        }
      }
      
      // 2. Check by fileName (solo si no es duplicado por URL)
      if (!isDuplicate && existingFileNames.has(fileName)) {
        isDuplicate = true;
        skippedCount++;
        console.log(`Skipping duplicate email (found existing fileName): ${fileName}`);
      }
      
      if (!isDuplicate) {
        // Validate and normalize JSON fields
        let etiquetasStr = "[]";
        try {
          if (entry.etiquetas) {
            if (typeof entry.etiquetas === 'string') {
              // Try to parse as JSON
              const parsed = JSON.parse(entry.etiquetas);
              etiquetasStr = JSON.stringify(Array.isArray(parsed) ? parsed : []);
            } else if (Array.isArray(entry.etiquetas)) {
              etiquetasStr = JSON.stringify(entry.etiquetas);
            }
          }
        } catch (e) {
          console.warn(`Error parsing etiquetas for ${fileName}, using empty array:`, e);
          etiquetasStr = "[]";
        }
        
        let urlsStr = "[]";
        try {
          if (entry.urls) {
            if (typeof entry.urls === 'string') {
              const parsed = JSON.parse(entry.urls);
              urlsStr = JSON.stringify(Array.isArray(parsed) ? parsed : []);
            } else if (Array.isArray(entry.urls)) {
              urlsStr = JSON.stringify(entry.urls);
            }
          }
        } catch (e) {
          console.warn(`Error parsing urls for ${fileName}, using empty array:`, e);
          urlsStr = "[]";
        }
        
        // Add to sets for next iteration
        if (fileName) existingFileNames.add(fileName);
        try {
          const urls = JSON.parse(urlsStr);
          if (Array.isArray(urls)) {
            urls.forEach(u => {
              existingUrlSets.add(u);
              const normalized = normalizeUrl(u);
              existingNormalizedUrlSets.add(normalized);
            });
          }
        } catch (e) { /* ignore */ }
        
        // Insert with validated data
        stmt.run([
          fileName,
          entry.fechaEnvio || null,
          entry.tematica || null,
          etiquetasStr,
          entry.contenido || null,
          urlsStr
        ]);
        importedCount++;
      }
    } catch (error: any) {
      const errorMsg = `Fila ${index + 1}: ${error.message || 'Error desconocido'}`;
      errors.push(errorMsg);
      console.error(`Error importing row ${index + 1}:`, error);
      skippedCount++;
    }
  });
  
  stmt.free();
  currentDb.run("COMMIT;");
  
  // Persist merged database
  if (importedCount > 0) {
    const binaryArray = currentDb.export();
    await saveDBToStorage(binaryArray);
  }
  
  importedDb.close();
  
  // Log errors if any
  if (errors.length > 0) {
    console.warn(`Errores durante la importación (${errors.length}):`, errors);
  }
  
  return { 
    imported: importedCount, 
    skipped: skippedCount,
    errors: errors.length > 0 ? errors : undefined
  };
};