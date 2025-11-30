import { ParsedEmailRaw } from '../types';
import { logger } from './loggerService';

/**
 * Basic EML parser.
 * Note: A full MIME parser is complex. This is a robust "best-effort" parser
 * designed to extract the Date header and the likely body content
 * to send to the AI for proper cleaning.
 */
export const parseEmlFile = async (file: File): Promise<ParsedEmailRaw> => {
  try {
    logger.info('Parser', `Iniciando parseo de ${file.name}`, { fileName: file.name, fileSize: file.size });
    const text = await file.text();
    logger.debug('Parser', `Archivo leído`, { length: text.length });
    
    // Extract Date
    const dateMatch = text.match(/^Date: (.+)$/m);
    const rawDate = dateMatch ? dateMatch[1].trim() : 'Unknown Date';
    logger.debug('Parser', `Fecha extraída`, { date: rawDate });

    // Extract Subject
    const subjectMatch = text.match(/^Subject: (.+)$/m);
    const rawSubject = subjectMatch ? subjectMatch[1].trim() : 'No Subject';
    logger.debug('Parser', `Asunto extraído`, { subject: rawSubject.substring(0, 50) });

  // Extract Body Strategy
  let bodyText = '';
  const headerBodySplit = text.indexOf('\r\n\r\n');

  if (headerBodySplit !== -1) {
    bodyText = text.substring(headerBodySplit + 4);
  } else {
    // Fallback for simple unix newlines
    const headerBodySplitUnix = text.indexOf('\n\n');
    if (headerBodySplitUnix !== -1) {
      bodyText = text.substring(headerBodySplitUnix + 2);
    } else {
      bodyText = text; // Fallback: send everything
    }
  }

  // Improved Multipart Extraction Strategy
  // If we see what looks like a multipart boundary followed by text/plain headers
  // This prevents sending raw MIME boundaries to the AI
  if (bodyText.includes('Content-Type: text/plain')) {
    // Attempt to find the content after the headers
    // Regex explanation:
    // Content-Type: text\/plain  -> Find this header
    // [\s\S]*?                   -> Match any chars (non-greedy) until...
    // \r?\n\r?\n                 -> Double newline (header end)
    // ([\s\S]*?)                 -> CAPTURE the content
    // (?=\r?\n--)                -> Lookahead for the next boundary (starts with -- on new line)
    // OR just take everything if no next boundary found immediately (fallback)
    const textPartMatch = bodyText.match(/Content-Type: text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/i);
    if (textPartMatch && textPartMatch[1]) {
        bodyText = textPartMatch[1].trim();
    }
  }

  // Decode quoted-printable encoding (common in emails)
  // Handles patterns like =C3=B6 (which is "ö" in UTF-8)
  bodyText = bodyText.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return match;
    }
  });
  
  // Decode common HTML entities
  bodyText = bodyText
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // Basic cleanup to reduce token usage before sending to Gemini
  // Remove massive base64 blocks (attachments) if possible
  // This Regex looks for long alphanumeric strings often found in base64 dumps
  bodyText = bodyText.replace(/[a-zA-Z0-9+/=]{100,}/g, '[...Attachment data removed...]');
  
  // Limit body size to avoid context window issues
  // Increased to 60000 to allow for longer description extraction
  if (bodyText.length > 60000) {
    logger.warn('Parser', `Cuerpo truncado`, { originalLength: bodyText.length, truncatedTo: 60000 });
    bodyText = bodyText.substring(0, 60000) + '... [Truncated]';
  }

  logger.info('Parser', `Parseo completado exitosamente`, { fileName: file.name, bodyLength: bodyText.length });

  return {
    fileName: file.name,
    rawDate,
    rawSubject,
    bodyText
  };
  } catch (error: any) {
    logger.error('Parser', `ERROR parseando archivo`, {
      fileName: file.name,
      fileSize: file.size,
      error: error.message,
      stack: error.stack,
      errorName: error.name
    });
    throw new Error(`Error parseando archivo ${file.name}: ${error.message || 'Error desconocido'}`);
  }
};