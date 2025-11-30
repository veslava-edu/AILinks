import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Función para extraer URLs de un archivo .eml
function extractUrlsFromEml(emlContent) {
  const urls = new Set();
  
  // Decodificar quoted-printable
  let decoded = emlContent.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return match;
    }
  });
  
  // Buscar URLs en el contenido
  // Patrón para URLs http/https
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const matches = decoded.match(urlPattern);
  
  if (matches) {
    matches.forEach(url => {
      // Limpiar URLs de caracteres finales no válidos
      let cleanUrl = url.trim();
      // Remover paréntesis, comas, puntos finales comunes
      cleanUrl = cleanUrl.replace(/[.,;:!?)\]]+$/, '');
      if (cleanUrl.length > 0) {
        urls.add(cleanUrl);
      }
    });
  }
  
  return Array.from(urls);
}

// Función para leer y procesar todos los archivos .eml
function processEmlFiles(emlDir) {
  const files = fs.readdirSync(emlDir).filter(f => f.endsWith('.eml'));
  const emails = [];
  
  for (const file of files) {
    const filePath = path.join(emlDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const urls = extractUrlsFromEml(content);
    
    emails.push({
      fileName: file,
      urls: urls
    });
  }
  
  return emails;
}

// Función para consultar la base de datos
function queryDatabase(dbPath) {
  const db = new Database(dbPath);
  
  const rows = db.prepare('SELECT fileName, urls FROM emails').all();
  
  const dbData = {
    fileNames: new Set(),
    urls: new Set()
  };
  
  rows.forEach(row => {
    if (row.fileName) {
      dbData.fileNames.add(row.fileName);
    }
    
    if (row.urls) {
      try {
        const urls = JSON.parse(row.urls);
        if (Array.isArray(urls)) {
          urls.forEach(url => dbData.urls.add(url));
        }
      } catch (e) {
        // Ignorar errores de parseo
      }
    }
  });
  
  db.close();
  return dbData;
}

// Función principal
function main() {
  const emlDir = path.join(__dirname, 'eml');
  const dbPath = path.join(__dirname, 'bd', 'email_intelligence_2025-11-30 (1).sqlite');
  
  console.log('📧 Analizando emails en:', emlDir);
  console.log('💾 Consultando base de datos:', dbPath);
  console.log('');
  
  // Procesar archivos .eml
  const emlFiles = processEmlFiles(emlDir);
  console.log(`✅ Encontrados ${emlFiles.length} archivos .eml\n`);
  
  // Consultar base de datos
  const dbData = queryDatabase(dbPath);
  console.log(`✅ Base de datos contiene:`);
  console.log(`   - ${dbData.fileNames.size} nombres de archivo únicos`);
  console.log(`   - ${dbData.urls.size} URLs únicas\n`);
  
  // Comparar
  const results = {
    nuevos: [],
    duplicadosPorNombre: [],
    duplicadosPorUrl: [],
    sinDuplicados: []
  };
  
  emlFiles.forEach(email => {
    const isDuplicateByName = dbData.fileNames.has(email.fileName);
    const matchingUrls = email.urls.filter(url => dbData.urls.has(url));
    const isDuplicateByUrl = matchingUrls.length > 0;
    
    if (isDuplicateByName) {
      results.duplicadosPorNombre.push({
        fileName: email.fileName,
        motivo: 'fileName ya existe en BD'
      });
    } else if (isDuplicateByUrl) {
      results.duplicadosPorUrl.push({
        fileName: email.fileName,
        urlsCoincidentes: matchingUrls,
        motivo: `URLs ya existen en BD: ${matchingUrls.join(', ')}`
      });
    } else {
      results.nuevos.push({
        fileName: email.fileName,
        urls: email.urls,
        motivo: 'No encontrado en BD (ni por nombre ni por URLs)'
      });
    }
  });
  
  // Mostrar resultados
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 RESULTADOS DEL ANÁLISIS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log(`🟢 NUEVOS (no están en BD): ${results.nuevos.length}`);
  if (results.nuevos.length > 0) {
    results.nuevos.forEach(email => {
      console.log(`   ✓ ${email.fileName}`);
      if (email.urls.length > 0) {
        console.log(`     URLs: ${email.urls.slice(0, 3).join(', ')}${email.urls.length > 3 ? '...' : ''}`);
      }
    });
  }
  console.log('');
  
  console.log(`🟡 DUPLICADOS POR NOMBRE DE ARCHIVO: ${results.duplicadosPorNombre.length}`);
  if (results.duplicadosPorNombre.length > 0) {
    results.duplicadosPorNombre.forEach(email => {
      console.log(`   ⚠ ${email.fileName}`);
      console.log(`     Motivo: ${email.motivo}`);
    });
  }
  console.log('');
  
  console.log(`🟠 DUPLICADOS POR URL: ${results.duplicadosPorUrl.length}`);
  if (results.duplicadosPorUrl.length > 0) {
    results.duplicadosPorUrl.forEach(email => {
      console.log(`   ⚠ ${email.fileName}`);
      console.log(`     URLs coincidentes: ${email.urlsCoincidentes.join(', ')}`);
    });
  }
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📈 RESUMEN:`);
  console.log(`   Total archivos .eml: ${emlFiles.length}`);
  console.log(`   Nuevos: ${results.nuevos.length}`);
  console.log(`   Duplicados por nombre: ${results.duplicadosPorNombre.length}`);
  console.log(`   Duplicados por URL: ${results.duplicadosPorUrl.length}`);
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Guardar resultados en JSON
  const reportPath = path.join(__dirname, 'duplicate-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`💾 Reporte guardado en: ${reportPath}`);
}

main();

