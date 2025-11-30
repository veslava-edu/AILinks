import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Normaliza URLs para comparación de duplicados (igual que en dbService.ts)
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return url;
  
  try {
    // Normalizar URLs de Twitter/X
    const twitterPattern = /^https?:\/\/(x\.com|twitter\.com)\/([^\/]+)\/status\/(\d+)/i;
    const twitterMatch = url.match(twitterPattern);
    
    if (twitterMatch) {
      const username = twitterMatch[2];
      const statusId = twitterMatch[3];
      return `https://x.com/${username}/status/${statusId}`;
    }
    
    // Para otras URLs, eliminar parámetros de tracking comunes
    try {
      const urlObj = new URL(url);
      const trackingParams = ['t', 's', 'utm_source', 'utm_medium', 'utm_campaign', 'ref'];
      trackingParams.forEach(param => urlObj.searchParams.delete(param));
      
      if (urlObj.searchParams.toString() === '') {
        return urlObj.origin + urlObj.pathname;
      }
      
      return urlObj.toString();
    } catch {
      return url;
    }
  } catch {
    return url;
  }
}

function normalizeUrls(urls) {
  if (!Array.isArray(urls)) return [];
  return urls.map(normalizeUrl).filter(url => url && url.length > 0);
}

// Función para extraer URLs de un archivo .eml
function extractUrlsFromEml(emlContent) {
  const urls = new Set();
  
  let decoded = emlContent.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return match;
    }
  });
  
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const matches = decoded.match(urlPattern);
  
  if (matches) {
    matches.forEach(url => {
      let cleanUrl = url.trim().replace(/[.,;:!?)\]]+$/, '');
      if (cleanUrl.length > 0) {
        urls.add(cleanUrl);
      }
    });
  }
  
  return Array.from(urls);
}

function main() {
  const emlDir = path.join(__dirname, 'eml');
  const files = fs.readdirSync(emlDir).filter(f => f.endsWith('.eml'));
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧪 PRUEBA DE DETECCIÓN DE DUPLICADOS MEJORADA');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Agrupar por remitente
  const bySender = new Map();
  
  files.forEach(file => {
    const filePath = path.join(emlDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const urls = extractUrlsFromEml(content);
    const normalizedUrls = normalizeUrls(urls);
    
    const senderMatch = file.match(/Post de (.+?) \(@/);
    const sender = senderMatch ? senderMatch[1] : 'Desconocido';
    
    if (!bySender.has(sender)) {
      bySender.set(sender, []);
    }
    
    bySender.get(sender).push({
      fileName: file,
      urls: urls,
      normalizedUrls: normalizedUrls
    });
  });
  
  // Analizar duplicados potenciales
  console.log('📊 ANÁLISIS DE DUPLICADOS POR URL NORMALIZADA:\n');
  
  const allNormalizedUrls = new Map(); // URL normalizada -> [archivos que la contienen]
  
  bySender.forEach((emails, sender) => {
    emails.forEach(email => {
      email.normalizedUrls.forEach(normalizedUrl => {
        if (!allNormalizedUrls.has(normalizedUrl)) {
          allNormalizedUrls.set(normalizedUrl, []);
        }
        allNormalizedUrls.get(normalizedUrl).push({
          sender: sender,
          fileName: email.fileName
        });
      });
    });
  });
  
  // Encontrar URLs duplicadas
  const duplicates = [];
  allNormalizedUrls.forEach((files, normalizedUrl) => {
    if (files.length > 1) {
      duplicates.push({
        normalizedUrl: normalizedUrl,
        files: files
      });
    }
  });
  
  if (duplicates.length > 0) {
    console.log(`⚠️  Encontradas ${duplicates.length} URLs normalizadas que aparecen en múltiples archivos:\n`);
    
    duplicates.forEach(dup => {
      console.log(`URL normalizada: ${dup.normalizedUrl}`);
      console.log(`  Aparece en ${dup.files.length} archivo(s):`);
      dup.files.forEach(file => {
        console.log(`    - ${file.fileName} (${file.sender})`);
      });
      console.log('');
    });
  } else {
    console.log('✅ No se encontraron URLs duplicadas (normalizadas) entre los archivos.\n');
  }
  
  // Mostrar ejemplos de normalización
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📝 EJEMPLOS DE NORMALIZACIÓN DE URLs:\n');
  
  const examples = [
    'https://x.com/tom_doerr/status/1994122993606205769?t=aZeb0OUI61NZnm-8NI-HKg&s=03',
    'https://twitter.com/user/status/123456?t=abc&s=123',
    'https://t.co/VgH46eGeO3',
    'https://github.com/user/repo?utm_source=email&utm_medium=link'
  ];
  
  examples.forEach(url => {
    console.log(`Original:  ${url}`);
    console.log(`Normalizada: ${normalizeUrl(url)}`);
    console.log('');
  });
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ La nueva lógica detectará duplicados basándose en URLs normalizadas');
  console.log('   incluso si el nombre del archivo es diferente.');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main();

