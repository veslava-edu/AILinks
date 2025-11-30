import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Función para extraer contenido del email (texto principal)
function extractEmailContent(emlContent) {
  // Decodificar quoted-printable
  let decoded = emlContent.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return match;
    }
  });
  
  // Extraer el cuerpo del texto plano
  const textPartMatch = decoded.match(/Content-Type: text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/i);
  if (textPartMatch && textPartMatch[1]) {
    let bodyText = textPartMatch[1].trim();
    // Limpiar más
    bodyText = bodyText.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return match;
      }
    });
    return bodyText.substring(0, 200); // Primeros 200 caracteres
  }
  return '';
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
  const dbPath = path.join(__dirname, 'bd', 'email_intelligence_2025-11-30 (1).sqlite');
  
  // Consultar base de datos
  const db = new Database(dbPath);
  const dbRows = db.prepare('SELECT fileName, urls, contenido FROM emails').all();
  
  const dbData = new Map();
  dbRows.forEach(row => {
    let urls = [];
    try {
      urls = JSON.parse(row.urls || '[]');
    } catch (e) {}
    dbData.set(row.fileName, {
      urls: urls,
      contenido: row.contenido ? row.contenido.substring(0, 200) : ''
    });
  });
  db.close();
  
  // Procesar archivos .eml
  const files = fs.readdirSync(emlDir).filter(f => f.endsWith('.eml'));
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📋 ANÁLISIS DETALLADO: Emails con mismo remitente');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Agrupar por remitente (extraído del nombre del archivo)
  const bySender = new Map();
  
  files.forEach(file => {
    const filePath = path.join(emlDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const urls = extractUrlsFromEml(content);
    const emailContent = extractEmailContent(content);
    
    // Extraer remitente del nombre del archivo (antes del @)
    const senderMatch = file.match(/Post de (.+?) \(@/);
    const sender = senderMatch ? senderMatch[1] : 'Desconocido';
    
    if (!bySender.has(sender)) {
      bySender.set(sender, []);
    }
    
    const dbEntry = dbData.get(file);
    
    bySender.get(sender).push({
      fileName: file,
      urls: urls,
      content: emailContent,
      inDb: !!dbEntry,
      dbUrls: dbEntry ? dbEntry.urls : [],
      dbContent: dbEntry ? dbEntry.contenido : ''
    });
  });
  
  // Analizar cada remitente
  bySender.forEach((emails, sender) => {
    if (emails.length > 1) {
      console.log(`\n👤 Remitente: ${sender} (${emails.length} emails)`);
      console.log('─'.repeat(60));
      
      emails.forEach((email, idx) => {
        console.log(`\n${idx + 1}. ${email.fileName}`);
        console.log(`   Estado: ${email.inDb ? '✅ En BD' : '❌ No en BD'}`);
        console.log(`   URLs en archivo (${email.urls.length}):`);
        email.urls.forEach(url => {
          const isInDb = email.dbUrls.includes(url);
          console.log(`     ${isInDb ? '✓' : '✗'} ${url}`);
        });
        
        if (email.urls.length === 0) {
          console.log(`     (sin URLs encontradas)`);
        }
        
        // Comparar contenido
        if (email.content && email.dbContent) {
          const contentSimilar = email.content.substring(0, 50) === email.dbContent.substring(0, 50);
          console.log(`   Contenido: ${contentSimilar ? 'Similar' : 'Diferente'}`);
          console.log(`     Archivo: "${email.content.substring(0, 80)}..."`);
          if (email.dbContent) {
            console.log(`     BD:      "${email.dbContent.substring(0, 80)}..."`);
          }
        }
      });
    }
  });
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 RESUMEN POR REMITENTE');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  bySender.forEach((emails, sender) => {
    const inDb = emails.filter(e => e.inDb).length;
    const notInDb = emails.filter(e => !e.inDb).length;
    const uniqueUrls = new Set();
    emails.forEach(e => e.urls.forEach(u => uniqueUrls.add(u)));
    
    console.log(`${sender}:`);
    console.log(`  Total emails: ${emails.length}`);
    console.log(`  En BD: ${inDb}, No en BD: ${notInDb}`);
    console.log(`  URLs únicas: ${uniqueUrls.size}`);
    console.log('');
  });
}

main();

