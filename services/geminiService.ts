import { GoogleGenAI, Type } from "@google/genai";
import { ParsedEmailRaw } from "../types";
import { logger } from "./loggerService";

const initGemini = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Ensure process.env.API_KEY is defined in your environment.");
  }
  return new GoogleGenAI({ apiKey });
};

export const validateApiKeyConfiguration = (): boolean => {
  return !!process.env.API_KEY && process.env.API_KEY.trim().length > 0;
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Backend scraper URL (configurable via env)
const SCRAPER_API_URL = process.env.SCRAPER_API_URL || 'http://localhost:3001';

interface ScrapedContent {
  url: string;
  title?: string;
  content: string;
  author?: string;
  date?: string;
  type: 'twitter' | 'github' | 'youtube' | 'article' | 'other';
  metadata?: {
    [key: string]: any;
  };
}

/**
 * Obtiene el contenido scrapeado de una URL desde el backend
 * @param url URL a scrapear
 * @returns Contenido scrapeado o null si falla
 */
async function fetchUrlContent(url: string): Promise<ScrapedContent | null> {
  try {
    logger.info('Scraper', `Intentando obtener contenido de URL desde backend`, { url });
    const response = await fetch(`${SCRAPER_API_URL}/api/scrape-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.warn('Scraper', `Backend scraper no disponible o error`, { 
        url, 
        status: response.status,
        error: errorData.message || 'Unknown error'
      });
      return null;
    }

    const scrapedContent: ScrapedContent = await response.json();
    logger.info('Scraper', `Contenido obtenido exitosamente`, { 
      url, 
      contentLength: scrapedContent.content.length,
      type: scrapedContent.type
    });
    return scrapedContent;
  } catch (error: any) {
    logger.warn('Scraper', `Error obteniendo contenido desde backend`, { 
      url, 
      error: error.message 
    });
    return null;
  }
}

/**
 * Obtiene la transcripción de un video de YouTube usando el endpoint dedicado
 */
async function fetchYouTubeTranscript(url: string): Promise<ScrapedContent | null> {
  try {
    logger.info('Scraper', `Intentando obtener transcripción de YouTube desde backend`, { url });
    const response = await fetch(`${SCRAPER_API_URL}/api/youtube-transcript`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.warn('Scraper', `Backend scraper no disponible o error obteniendo transcripción`, { 
        url, 
        status: response.status,
        error: errorData.message || 'Unknown error'
      });
      return null;
    }

    const scrapedContent: ScrapedContent & { transcript?: string } = await response.json();
    logger.info('Scraper', `Transcripción obtenida exitosamente`, { 
      url, 
      transcriptLength: scrapedContent.transcript?.length || 0,
      contentLength: scrapedContent.content.length,
      type: scrapedContent.type
    });
    return scrapedContent;
  } catch (error: any) {
    logger.warn('Scraper', `Error obteniendo transcripción desde backend`, { 
      url, 
      error: error.message 
    });
    return null;
  }
}

export const analyzeEmailContent = async (
  emailData: ParsedEmailRaw
): Promise<{
  tematica: string;
  etiquetas: string[];
  contenido_resumido: string;
  urls: string[];
  fecha_normalizada: string;
}> => {
  const ai = initGemini();

  const prompt = `
Eres un analista experto de correos electrónicos. Analiza el siguiente correo y extrae información valiosa de forma directa y concisa.

METADATOS:
- Asunto: ${emailData.rawSubject}
- Fecha: ${emailData.rawDate}

INSTRUCCIONES CRÍTICAS PARA EL RESUMEN:
1. EVITA completamente frases redundantes como:
   - "Este correo electrónico notifica sobre..."
   - "El mensaje informa que..."
   - "Este email trata sobre..."
   - "El correo menciona..."
   
2. Ve DIRECTAMENTE al grano. Empieza con la información útil inmediatamente.

3. Si el correo contiene enlaces, investiga su propósito real:
   - Describe QUÉ hace el enlace o herramienta, no solo que "hay un enlace"
   - Si es un producto/servicio, explica su funcionalidad principal
   - Si es un tutorial/artículo, resume los conceptos clave que enseña
   - Si es una noticia, resume los hechos principales

4. Para newsletters o correos con múltiples secciones:
   - Resume cada artículo/sección de forma independiente
   - Incluye los puntos técnicos más importantes
   - Menciona herramientas, tecnologías o conceptos específicos

5. Sé específico y técnico cuando corresponda. Evita generalidades.

TAREAS:
1. Normaliza la fecha a formato ISO 8601 (YYYY-MM-DD HH:mm:ss)
2. Identifica la temática principal (una palabra o frase corta: "Newsletter Tecnología", "Facturación", "Tutorial", etc.)
3. Genera 3-5 etiquetas relevantes (tecnologías, conceptos, categorías específicas)
4. Genera un RESUMEN HTML de aproximadamente 200 palabras que:
   - Empiece directamente con la información útil, sin prefijos redundantes
   - Use etiquetas HTML para destacar las partes más importantes:
     * <strong> o <b> para conceptos clave, nombres de herramientas, tecnologías importantes
     * <em> o <i> para énfasis en puntos críticos
     * <mark> para información destacada o llamadas a la acción
     * <a href="URL">texto</a> para enlaces importantes (si aplica)
   - Explique QUÉ hace cada enlace/herramienta mencionada
   - Incluya detalles técnicos relevantes
   - Sea conciso pero completo: aproximadamente 200 palabras
   - Para newsletters: resume los artículos principales con puntos clave destacados
   - Para tutoriales: explica conceptos principales con términos técnicos destacados
   - Para productos/herramientas: describe funcionalidades principales con características destacadas
   - Ejemplo: "Nueva herramienta <strong>React Query</strong> para gestión de estado. Permite <mark>caché automática</mark> y sincronización de datos. Incluye <em>soporte para paginación</em> y actualizaciones en tiempo real."
5. Extrae TODAS las URLs válidas (http/https) del cuerpo del mensaje

CONTENIDO DEL CORREO:
${emailData.bodyText}

NOTA IMPORTANTE SOBRE ENLACES:
- Si encuentras URLs en el contenido, analiza su propósito basándote en:
  * El dominio y contexto del correo
  * El texto que rodea el enlace
  * Tu conocimiento sobre servicios/herramientas comunes
- Para cada enlace importante, explica QUÉ hace o QUÉ contiene, no solo que existe
- Si es un servicio conocido (GitHub, Stack Overflow, Medium, etc.), menciona el tipo de contenido
- Si es un producto/herramienta, describe su funcionalidad principal
- Si es un tutorial/artículo, resume los conceptos clave que enseña

EJEMPLO DE BUEN RESUMEN:
❌ MAL: "Este correo electrónico notifica sobre un nuevo tutorial de React que está disponible en el siguiente enlace..."
✅ BIEN: "Tutorial de React sobre hooks avanzados: explica useReducer, useMemo y useCallback con ejemplos prácticos. Incluye código para optimizar renderizados y gestionar estado complejo..."

  `;

  let attempt = 1;
  const maxAttempts = 5;
  let delay = 10000; // Start with 10 seconds to handle 429s aggressively

  logger.info('Gemini', `Iniciando análisis`, {
    fileName: emailData.fileName,
    promptLength: prompt.length,
    bodyLength: emailData.bodyText.length
  });
  
  while (attempt <= maxAttempts) {
    try {
      logger.debug('Gemini', `Intento ${attempt}/${maxAttempts}`, { fileName: emailData.fileName });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tematica: { type: Type.STRING },
              etiquetas: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              contenido_resumido: { type: Type.STRING, description: "Resumen HTML de aproximadamente 200 palabras. Debe usar etiquetas HTML (<strong>, <em>, <mark>, <a>) para destacar las partes más importantes: conceptos clave, herramientas, tecnologías, información destacada. Debe empezar inmediatamente con información útil, sin prefijos redundantes. Debe explicar qué hacen los enlaces/herramientas mencionadas y ser conciso pero completo." },
              urls: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              fecha_normalizada: { type: Type.STRING, description: "ISO 8601 date string" }
            },
          },
        },
      });

      const text = response.text;
      if (!text) throw new Error("No response from AI");

      logger.info('Gemini', `Respuesta recibida`, { fileName: emailData.fileName, responseLength: text.length });
      
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(text);
      } catch (parseError: any) {
        logger.error('Gemini', `Error parseando JSON`, {
          fileName: emailData.fileName,
          error: parseError.message,
          responsePreview: text.substring(0, 500)
        });
        throw new Error(`Error parseando respuesta JSON: ${parseError.message}`);
      }
      
      // Validate and normalize response
      if (!parsedResponse.tematica) {
        logger.warn('Gemini', `Tematica faltante, usando valor por defecto`, { fileName: emailData.fileName });
        parsedResponse.tematica = "Sin clasificar";
      }
      
      if (!Array.isArray(parsedResponse.etiquetas)) {
        logger.warn('Gemini', `Etiquetas no es array, normalizando`, { fileName: emailData.fileName });
        if (typeof parsedResponse.etiquetas === 'string') {
          try {
            parsedResponse.etiquetas = JSON.parse(parsedResponse.etiquetas);
          } catch {
            parsedResponse.etiquetas = parsedResponse.etiquetas.split(',').map((t: string) => t.trim()).filter(Boolean);
          }
        } else {
          parsedResponse.etiquetas = [];
        }
      }
      
      if (!Array.isArray(parsedResponse.urls)) {
        logger.warn('Gemini', `URLs no es array, normalizando`, { fileName: emailData.fileName });
        if (typeof parsedResponse.urls === 'string') {
          try {
            parsedResponse.urls = JSON.parse(parsedResponse.urls);
          } catch {
            // Try to extract URLs from string
            const urlRegex = /https?:\/\/[^\s]+/g;
            parsedResponse.urls = parsedResponse.urls.match(urlRegex) || [];
          }
        } else {
          parsedResponse.urls = [];
        }
      }
      
      if (!parsedResponse.contenido_resumido) {
        logger.warn('Gemini', `Contenido resumido faltante`, { fileName: emailData.fileName });
        parsedResponse.contenido_resumido = "No se pudo generar resumen del contenido.";
      }
      
      if (!parsedResponse.fecha_normalizada) {
        logger.warn('Gemini', `Fecha normalizada faltante, usando fecha original`, { fileName: emailData.fileName });
        parsedResponse.fecha_normalizada = emailData.rawDate;
      }
      
      logger.info('Gemini', `Análisis completado exitosamente`, {
        fileName: emailData.fileName,
        tematica: parsedResponse.tematica,
        etiquetasCount: parsedResponse.etiquetas.length,
        urlsCount: parsedResponse.urls.length,
        contenidoLength: parsedResponse.contenido_resumido.length
      });
      
      return parsedResponse;

    } catch (error: any) {
      // Check for Rate Limits (429) or Service Overload (503)
      const isTransient = 
        error.status === 429 || 
        error.code === 429 || 
        (error.message && (error.message.includes('429') || error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED')));

      if (isTransient) {
          if (attempt < maxAttempts) {
            logger.warn('Gemini', `Rate Limit detectado, reintentando`, {
              attempt: `${attempt}/${maxAttempts}`,
              delay: delay,
              fileName: emailData.fileName
            });
            await wait(delay);
            delay *= 1.5; // Exponential backoff
            attempt++;
          } else {
             logger.error('Gemini', `Cuota API excedida después de ${maxAttempts} intentos`, {
               fileName: emailData.fileName,
               error: error.message,
               status: error.status
             });
             // Return a specific error object for the UI to handle, but don't crash
             return {
                tematica: "Error Cuota API",
                etiquetas: ["Error", "Quota"],
                contenido_resumido: "Error: Se ha excedido la cuota de la API Key definida en tu fichero .env (429 Resource Exhausted). Espera unos minutos o revisa tu plan de facturación en Google AI Studio.",
                urls: [],
                fecha_normalizada: emailData.rawDate
            };
          }
      } else {
        logger.error('Gemini', `Error en análisis`, {
          attempt: `${attempt}/${maxAttempts}`,
          fileName: emailData.fileName,
          errorName: error.name,
          errorMessage: error.message,
          status: error.status,
          code: error.code,
          stack: error.stack
        });
        
        // If it's the last attempt, return error
        if (attempt === maxAttempts) {
          const errorMessage = `Error analizando contenido después de ${maxAttempts} intentos: ${error.message || 'Error desconocido'}`;
          logger.error('Gemini', errorMessage, { fileName: emailData.fileName });
          
          return {
            tematica: "Error en Análisis",
            etiquetas: ["Error"],
            contenido_resumido: errorMessage + ". Contenido parcial: " + emailData.bodyText.substring(0, 200),
            urls: [],
            fecha_normalizada: emailData.rawDate
          };
        }
        
        // Otherwise, wait and retry
        logger.debug('Gemini', `Reintentando`, { delay: delay, fileName: emailData.fileName });
        await wait(delay);
        delay *= 1.5;
        attempt++;
      }
    }
  }

  return {
    tematica: "Error",
    etiquetas: ["Error"],
    contenido_resumido: "Error desconocido tras reintentos.",
    urls: [],
    fecha_normalizada: emailData.rawDate
  };
};

/**
 * Valida que la respuesta de Gemini para YouTube esté relacionada con la transcripción
 */
function validateYouTubeResponse(
  response: any,
  transcript: string,
  url: string
): { isValid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const transcriptLower = transcript.toLowerCase();
  const transcriptWords = new Set(
    transcriptLower
      .split(/\s+/)
      .map(w => w.replace(/[^\w]/g, ''))
      .filter(w => w.length > 3)
  );

  // Validar temática
  if (response.tematica) {
    const tematicaLower = response.tematica.toLowerCase();
    const tematicaWords = tematicaLower
      .split(/\s+/)
      .map(w => w.replace(/[^\w]/g, ''))
      .filter(w => w.length > 2);
    
    // Verificar que al menos una palabra importante de la temática aparezca en la transcripción
    const hasMatch = tematicaWords.some(word => 
      word.length > 3 && (
        transcriptLower.includes(word) || 
        Array.from(transcriptWords).some(tw => tw.includes(word) || word.includes(tw))
      )
    );
    
    if (!hasMatch && tematicaWords.length > 0) {
      warnings.push(`Temática "${response.tematica}" no parece estar relacionada con la transcripción`);
    }
  }

  // Validar etiquetas principales (al menos 2 de las primeras 3 deben estar relacionadas)
  if (response.etiquetas && Array.isArray(response.etiquetas) && response.etiquetas.length > 0) {
    const mainTags = response.etiquetas.slice(0, 3);
    const relatedTags = mainTags.filter(tag => {
      const tagLower = tag.toLowerCase().replace(/[^\w\s]/g, '');
      const tagWords = tagLower.split(/\s+/).filter(w => w.length > 2);
      return tagWords.some(word => 
        word.length > 3 && (
          transcriptLower.includes(word) || 
          Array.from(transcriptWords).some(tw => tw.includes(word) || word.includes(tw))
        )
      );
    });
    
    if (relatedTags.length < Math.min(2, mainTags.length)) {
      warnings.push(`Menos de 2 etiquetas principales están relacionadas con la transcripción`);
    }
  }

  // Validar resumen - buscar frases sospechosas de alucinación
  if (response.contenido_resumido) {
    const resumenLower = response.contenido_resumido.toLowerCase();
    const hallucinationPhrases = [
      'promete revolucionar',
      'revoluciona el campo',
      'herramienta indispensable',
      'introducción completa',
      'tutorial completo',
      'guía completa',
      'explora sus capacidades avanzadas',
      'facilita la generación',
      'prototipado rápido',
      'colaboración en tiempo real'
    ];
    
    const foundPhrases = hallucinationPhrases.filter(phrase => resumenLower.includes(phrase));
    if (foundPhrases.length > 0) {
      // Verificar si estas frases están realmente en la transcripción
      const phrasesInTranscript = foundPhrases.filter(phrase => 
        transcriptLower.includes(phrase.toLowerCase())
      );
      
      if (phrasesInTranscript.length < foundPhrases.length) {
        warnings.push(`Resumen contiene frases genéricas que no aparecen en la transcripción: ${foundPhrases.filter(p => !transcriptLower.includes(p.toLowerCase())).join(', ')}`);
      }
    }
  }

  return {
    isValid: warnings.length === 0,
    warnings
  };
}

/**
 * Analiza una URL directamente y genera todos los campos necesarios
 * @param url La URL a analizar
 * @param useTranscript Si es true y la URL es de YouTube, usa transcripción en lugar de scraping básico
 * @returns Objeto con temática, etiquetas, contenido resumido, URLs y fecha
 */
export const analyzeUrlContent = async (
  url: string,
  useTranscript: boolean = false
): Promise<{
  tematica: string;
  etiquetas: string[];
  contenido_resumido: string;
  urls: string[];
  fecha_normalizada: string;
}> => {
  const ai = initGemini();

  // Intentar obtener contenido scrapeado del backend
  let scrapedContent: ScrapedContent | null = null;
  let scrapedText = '';
  let scrapedAuthor = '';
  let scrapedDate = '';
  let hasTranscript = false;

  try {
    // Si es YouTube y se solicita transcripción, usar el endpoint dedicado
    if (useTranscript && (url.includes('youtube.com/') || url.includes('youtu.be/'))) {
      scrapedContent = await fetchYouTubeTranscript(url);
      if (scrapedContent) {
        const contentWithTranscript = scrapedContent as ScrapedContent & { transcript?: string };
        // PRIORIZAR la transcripción sobre cualquier otro contenido
        // Validar que la transcripción tenga contenido significativo (más de 200 caracteres según validación del backend)
        if (contentWithTranscript.transcript && contentWithTranscript.transcript.length >= 200) {
          scrapedText = contentWithTranscript.transcript;
          hasTranscript = true;
          logger.info('Gemini', `✅ Usando TRANSCRIPCIÓN COMPLETA de YouTube para análisis`, { 
            url, 
            transcriptLength: contentWithTranscript.transcript.length,
            transcriptPreview: contentWithTranscript.transcript.substring(0, 500) + '...',
            transcriptMetrics: contentWithTranscript.metadata?.transcriptMetrics,
            hasAuthor: !!scrapedContent.author,
            hasDate: !!scrapedContent.date
          });
        } else {
          // Fallback a contenido scrapeado si no hay transcripción válida
          scrapedText = scrapedContent.content;
          hasTranscript = false;
          const transcriptLength = contentWithTranscript.transcript?.length || 0;
          logger.warn('Gemini', `⚠️ No se obtuvo transcripción válida (longitud: ${transcriptLength}), usando contenido scrapeado`, { 
            url, 
            transcriptLength,
            contentLength: scrapedText.length,
            transcriptError: contentWithTranscript.metadata?.transcriptError,
            transcriptMetrics: contentWithTranscript.metadata?.transcriptMetrics,
            usingFallback: contentWithTranscript.metadata?.usingFallback
          });
        }
        scrapedAuthor = scrapedContent.author || '';
        scrapedDate = scrapedContent.date || '';
      }
    } else {
      scrapedContent = await fetchUrlContent(url);
      if (scrapedContent) {
        scrapedText = scrapedContent.content;
        scrapedAuthor = scrapedContent.author || '';
        scrapedDate = scrapedContent.date || '';
        logger.info('Gemini', `Usando contenido scrapeado para análisis`, { 
          url, 
          contentLength: scrapedText.length,
          hasAuthor: !!scrapedAuthor,
          hasDate: !!scrapedDate
        });
      }
    }
  } catch (error: any) {
    logger.warn('Gemini', `No se pudo obtener contenido scrapeado, continuando sin él`, { 
      url, 
      error: error.message 
    });
  }

  // Construir prompt con contenido scrapeado si está disponible
  // Para YouTube con transcripción, usar prompt específico y restrictivo
  const isYouTube = url.includes('youtube.com/') || url.includes('youtu.be/');
  const hasValidTranscript = hasTranscript && scrapedText && scrapedText.length >= 200;
  
  const contentSection = hasValidTranscript && isYouTube
    ? `TRANSCRIPCIÓN COMPLETA DEL VIDEO DE YOUTUBE:
${scrapedText}

METADATOS DEL VIDEO (solo informativos, NO usar para análisis):
${scrapedContent?.title ? `Título: ${scrapedContent.title}` : 'Título no disponible'}
${scrapedAuthor ? `Canal: ${scrapedAuthor}` : 'Canal no disponible'}

`
    : scrapedText && isYouTube
    ? `METADATOS DEL VIDEO DE YOUTUBE (sin transcripción disponible):
${scrapedText}
${scrapedAuthor ? `\nCanal: ${scrapedAuthor}` : ''}

⚠️ ADVERTENCIA: Solo hay metadatos básicos. NO hay transcripción. Sé extremadamente conservador.

`
    : scrapedText 
    ? `CONTENIDO EXTRAÍDO DE LA URL:
${scrapedText}
${scrapedAuthor ? `\nAutor: ${scrapedAuthor}` : ''}
${scrapedDate ? `\nFecha del contenido: ${scrapedDate}` : ''}

`
    : '';

  // Crear prompt específico para YouTube con transcripción (más restrictivo)
  const youtubeTranscriptPrompt = hasValidTranscript && isYouTube 
    ? `Eres un analista de contenido. Analiza ÚNICAMENTE la transcripción del video de YouTube proporcionada.

URL: ${url}

${contentSection}REGLAS ESTRICTAS - LEE CON ATENCIÓN:

🚫 PROHIBIDO:
- Inventar información que NO esté explícitamente en la transcripción
- Describir funcionalidades o características que NO se mencionan en la transcripción
- Usar información genérica como "revoluciona el campo", "herramienta indispensable", "promete revolucionar" a menos que esté en la transcripción
- Inferir capacidades o características no mencionadas
- Usar frases como "el video ofrece", "el tutorial explora", "se enseña" si no están en la transcripción

✅ PERMITIDO:
- Mencionar SOLO lo que está EXPLÍCITAMENTE dicho en la transcripción
- Extraer palabras clave y conceptos que aparecen literalmente
- Resumir lo que realmente se dice, citando frases específicas cuando sea posible
- Si algo NO está claro en la transcripción, usar términos muy generales o "Sin clasificar"

TAREAS:

1. TEMÁTICA (una frase corta):
   - Basada EXCLUSIVAMENTE en palabras/conceptos que aparecen en la transcripción
   - Si la transcripción menciona "Gemini 3.0 Designer", la temática DEBE incluir eso
   - Si NO menciona funcionalidades específicas, NO las inventes
   - Ejemplo CORRECTO si dice "Gemini 3.0 Designer": "Gemini 3.0 Designer" o "Herramienta de Diseño con IA"
   - Ejemplo INCORRECTO: "Herramienta que revoluciona el diseño" (si no dice "revoluciona")

2. ETIQUETAS (3-5 palabras clave):
   - SOLO palabras que aparecen en la transcripción o variaciones directas
   - Ejemplo: Si dice "Gemini", "Google", "IA", "diseño" → ["Gemini", "Google AI", "Diseño", "IA"]

3. RESUMEN HTML (máximo 150 palabras):
   - Empieza directamente con información útil
   - Cita frases específicas de la transcripción entre comillas cuando sea posible
   - Usa <strong> para conceptos mencionados explícitamente
   - NO describas funcionalidades que no se mencionan
   - Si la transcripción solo menciona el nombre de una herramienta sin detalles, di solo eso
   - Ejemplo CORRECTO: "Video sobre <strong>Gemini 3.0 Designer</strong>, herramienta de Google AI mencionada en la transcripción. [citar frases específicas de la transcripción]"
   - Ejemplo INCORRECTO: "Este video ofrece una introducción completa a Gemini 3.0 Designer que promete revolucionar el campo del diseño..." (si no dice "revoluciona" o "introducción completa")

4. URLs: Solo la URL del video: ${url}

5. FECHA: Usa la fecha actual en formato YYYY-MM-DD HH:mm:ss

EJEMPLO DE ALUCINACIÓN (NO HACER):
❌ MAL: "Este video ofrece una introducción completa a Gemini 3.0 Designer, la innovadora herramienta de Google AI que promete revolucionar el campo del diseño de interfaces de usuario. El tutorial explora sus capacidades avanzadas, destacando cómo facilita la generación de diseños inteligentes, el prototipado rápido y la colaboración en tiempo real."

✅ BIEN (si la transcripción solo menciona el nombre): "Video sobre <strong>Gemini 3.0 Designer</strong> de Google AI. [citar exactamente lo que dice la transcripción]"

  `
    : '';

  // Prompt estándar para otros tipos de URLs (cuando NO hay transcripción válida de YouTube)
  const standardPrompt = !(hasValidTranscript && isYouTube) 
    ? `Eres un analista experto de enlaces web. Analiza la siguiente URL y extrae información valiosa de forma directa y concisa.

URL A ANALIZAR: ${url}

${contentSection}INSTRUCCIONES CRÍTICAS PARA EL ANÁLISIS:
1. Para URLs de Twitter/X (x.com o twitter.com):
   ${scrapedText 
     ? '- Tienes el CONTENIDO REAL del tweet extraído arriba. ÚSALO para analizar el tema específico.'
     : '- DEBES analizar basándote en el contenido real del tweet si está disponible'
   }
   - Extrae el texto completo del tweet/post principal
   - Si es un hilo, resume TODOS los tweets del hilo
   - Identifica el autor (@usuario) y menciona si es relevante
   - Extrae el tema técnico específico (NO uses genéricos como "Publicación Red Social")
   - Si menciona herramientas, tecnologías, conceptos técnicos, destácalos específicamente
   - Ejemplo: Si el tweet habla de Cython para acelerar Python, la temática debe ser "Optimización Python" o "Tutorial Cython", NO "Publicación Red Social"

${isYouTube && !hasValidTranscript ? `
2. Para URLs de YouTube (youtube.com o youtu.be):
   ⚠️ ADVERTENCIA: Solo tienes METADATOS BÁSICOS (título y descripción). NO hay transcripción disponible.
   - NO inventes información que no esté explícitamente en los metadatos
   - Si no estás seguro, usa "Sin clasificar" o términos muy generales
   - NO asumas funcionalidades, características o capacidades no mencionadas
   - Ejemplo: Si el título dice "Gemini 3.0 Designer" pero no hay más información, la temática puede ser "Gemini 3.0 Designer" pero el resumen debe ser muy conservador
` : ''}

2. Para URLs de GitHub:
   ${scrapedText 
     ? '- Tienes el CONTENIDO REAL del repositorio extraído arriba. ÚSALO para identificar tecnologías y propósito.'
     : '- Identifica el propósito del repositorio basándote en el nombre y usuario'
   }
   - Menciona tecnologías/lenguajes principales
   - Describe funcionalidades clave si es una herramienta

3. Para artículos/posts/blogs:
   ${scrapedText 
     ? '- Tienes el CONTENIDO REAL del artículo extraído arriba. ÚSALO para resumir conceptos clave.'
     : '- Resume los conceptos principales'
   }
   - Destaca tecnologías/herramientas mencionadas
   - Incluye puntos clave del contenido

4. EVITA completamente frases redundantes como:
   - "Este enlace contiene..."
   - "La URL muestra..."
   - "El enlace lleva a..."
   
5. Ve DIRECTAMENTE al grano. Empieza con la información útil inmediatamente.

6. Sé específico y técnico cuando corresponda:
   - Menciona tecnologías específicas (React, Python, Docker, Cython, etc.)
   - Identifica conceptos clave (APIs, microservicios, CI/CD, optimización, etc.)
   - Describe funcionalidades concretas

TAREAS:
1. Identifica la temática principal ESPECÍFICA basándote ÚNICAMENTE en el contenido proporcionado:
   - NO uses genéricos como "Publicación Red Social", "Tweet Tecnología", "Video YouTube" a menos que el contenido realmente hable de eso
   - Para tweets técnicos: "Tutorial Cython", "Optimización Python", "Guía React", etc.
   - Para GitHub: "Repositorio Python", "Herramienta DevOps", etc.
   - Sé específico sobre el contenido real

2. Genera 3-5 etiquetas relevantes (tecnologías, conceptos, categorías específicas):
   - Ejemplo para tweet sobre Cython: ["Python", "Cython", "Optimización", "Performance", "C"]

3. Genera un RESUMEN HTML de aproximadamente 200 palabras que:
   - Empiece directamente con la información útil, sin prefijos redundantes
   - Use etiquetas HTML para destacar las partes más importantes:
     * <strong> o <b> para conceptos clave, nombres de herramientas, tecnologías importantes
     * <em> o <i> para énfasis en puntos críticos
     * <mark> para información destacada
     * <a href="${url}">texto</a> para el enlace principal
   - Para tweets: incluye el contenido principal del tweet, menciona el autor si es relevante
   - Para hilos: resume los puntos principales de todos los tweets
   - Explique QUÉ contiene o QUÉ enseña el enlace
   - Incluya detalles técnicos relevantes
   - Sea conciso pero completo: aproximadamente 200 palabras

4. Extrae TODAS las URLs válidas relacionadas (puede ser solo la URL principal o URLs adicionales si las hay)

5. Genera una fecha normalizada en formato "YYYY-MM-DD HH:mm:ss":
   ${scrapedDate 
     ? `- USA la fecha extraída del contenido: ${scrapedDate}`
     : '- Si puedes inferir la fecha del contenido (ej: fecha del tweet), úsala'
   }
   - Si no hay fecha disponible, usa la fecha actual en formato "YYYY-MM-DD HH:mm:ss"
   - Ejemplo: "2025-11-29 07:50:00"

EJEMPLO DE BUEN RESUMEN PARA TWEET SOBRE CYTHON:
✅ BIEN: "Tweet de <strong>Avi Chawla</strong> sobre cómo acelerar código Python más de 50x usando <mark>Cython</mark>. Explica que CPython es lento por su dinamismo y que Cython convierte Python a C. Describe 4 pasos: cargar módulo con <code>%load_ext Cython</code>, usar magic command, especificar tipos de parámetros y definir variables con <code>cdef</code>. También menciona que Python 3.14 permite deshabilitar GIL para código multi-threaded. Incluye consejos sobre NumPy como alternativa."

NOTA CRÍTICA:
${scrapedText 
  ? '- TIENES EL CONTENIDO REAL EXTRAÍDO. ÚSALO para generar un análisis preciso y específico.'
  : '- Si no tienes contenido scrapeado, intenta inferir basándote en la URL y tu conocimiento'
}
- NO uses temáticas genéricas como "Publicación Red Social" - sé específico sobre el contenido técnico
- Si el tweet es técnico, la temática debe reflejar el tema técnico específico
  `
    : '';

  // Usar prompt específico para YouTube con transcripción, o prompt estándar para otros casos
  const prompt = hasValidTranscript && isYouTube ? youtubeTranscriptPrompt : standardPrompt;

  let attempt = 1;
  const maxAttempts = 5;
  let delay = 10000;

  logger.info('Gemini', `Iniciando análisis de URL`, {
    url: url,
    promptLength: prompt.length
  });
  
  while (attempt <= maxAttempts) {
    try {
      logger.debug('Gemini', `Intento ${attempt}/${maxAttempts}`, { url });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tematica: { type: Type.STRING },
              etiquetas: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              contenido_resumido: { type: Type.STRING, description: hasValidTranscript && isYouTube ? "Resumen HTML de máximo 150 palabras basado EXCLUSIVAMENTE en la transcripción. Debe usar etiquetas HTML (<strong>, <em>, <mark>, <a>) para destacar conceptos mencionados explícitamente. Debe empezar inmediatamente con información útil, sin prefijos redundantes. NO inventes información que no esté en la transcripción." : "Resumen HTML de aproximadamente 200 palabras. Debe usar etiquetas HTML (<strong>, <em>, <mark>, <a>) para destacar las partes más importantes: conceptos clave, herramientas, tecnologías, información destacada. Debe empezar inmediatamente con información útil, sin prefijos redundantes." },
              urls: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              fecha_normalizada: { type: Type.STRING, description: "Fecha en formato YYYY-MM-DD HH:mm:ss (ejemplo: 2025-11-29 07:50:00)" }
            },
          },
        },
      });

      const text = response.text;
      if (!text) throw new Error("No response from AI");

      logger.info('Gemini', `Respuesta recibida`, { url, responseLength: text.length });
      
      // Loggear respuesta completa para debugging (solo primeros 1000 caracteres)
      if (hasValidTranscript && isYouTube) {
        logger.debug('Gemini', `Respuesta completa de Gemini (primeros 1000 caracteres)`, {
          url,
          responsePreview: text.substring(0, 1000)
        });
        // Loggear también el prompt completo para debugging
        logger.debug('Gemini', `Prompt completo enviado a Gemini (primeros 2000 caracteres)`, {
          url,
          promptPreview: prompt.substring(0, 2000)
        });
      }
      
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(text);
      } catch (parseError: any) {
        logger.error('Gemini', `Error parseando JSON`, {
          url,
          error: parseError.message,
          responsePreview: text.substring(0, 500)
        });
        throw new Error(`Error parseando respuesta JSON: ${parseError.message}`);
      }
      
      // Validación post-procesamiento para YouTube con transcripción
      if (hasValidTranscript && isYouTube && scrapedText) {
        const validationResult = validateYouTubeResponse(parsedResponse, scrapedText, url);
        if (!validationResult.isValid) {
          logger.warn('Gemini', `⚠️ Validación post-procesamiento falló`, {
            url,
            warnings: validationResult.warnings,
            tematica: parsedResponse.tematica,
            etiquetas: parsedResponse.etiquetas
          });
          // Marcar con advertencia pero continuar (no fallar completamente)
          parsedResponse._validationWarnings = validationResult.warnings;
        } else {
          logger.info('Gemini', `✅ Validación post-procesamiento exitosa`, { url });
        }
      }
      
      // Validate and normalize response
      if (!parsedResponse.tematica) {
        logger.warn('Gemini', `Tematica faltante, usando valor por defecto`, { url });
        parsedResponse.tematica = "Sin clasificar";
      }
      
      if (!Array.isArray(parsedResponse.etiquetas)) {
        logger.warn('Gemini', `Etiquetas no es array, normalizando`, { url });
        if (typeof parsedResponse.etiquetas === 'string') {
          try {
            parsedResponse.etiquetas = JSON.parse(parsedResponse.etiquetas);
          } catch {
            parsedResponse.etiquetas = parsedResponse.etiquetas.split(',').map((t: string) => t.trim()).filter(Boolean);
          }
        } else {
          parsedResponse.etiquetas = [];
        }
      }
      
      // Asegurar que la URL original esté en el array de URLs
      if (!Array.isArray(parsedResponse.urls)) {
        parsedResponse.urls = [];
      }
      // Agregar la URL original si no está presente
      if (!parsedResponse.urls.includes(url)) {
        parsedResponse.urls.unshift(url);
      }
      
      if (!parsedResponse.contenido_resumido) {
        logger.warn('Gemini', `Contenido resumido faltante`, { url });
        parsedResponse.contenido_resumido = `<p>Enlace: <a href="${url}">${url}</a></p>`;
      }
      
      // Normalizar formato de fecha a YYYY-MM-DD HH:mm:ss
      // Prioridad: fecha scrapeada > fecha de Gemini > fecha actual
      if (scrapedDate && !parsedResponse.fecha_normalizada) {
        // Intentar usar fecha scrapeada
        try {
          const fechaScraped = new Date(scrapedDate);
          if (!isNaN(fechaScraped.getTime())) {
            parsedResponse.fecha_normalizada = fechaScraped.toISOString().slice(0, 19).replace('T', ' ');
            logger.info('Gemini', `Usando fecha scrapeada`, { url, fecha: parsedResponse.fecha_normalizada });
          }
        } catch (e) {
          logger.warn('Gemini', `Error parseando fecha scrapeada`, { url, fechaScraped: scrapedDate });
        }
      }

      if (!parsedResponse.fecha_normalizada) {
        logger.warn('Gemini', `Fecha normalizada faltante, usando fecha actual`, { url });
        parsedResponse.fecha_normalizada = new Date().toISOString().slice(0, 19).replace('T', ' ');
      } else {
        // Asegurar formato correcto YYYY-MM-DD HH:mm:ss
        try {
          const fechaStr = parsedResponse.fecha_normalizada.trim();
          // Si viene en formato ISO con T, convertir
          if (fechaStr.includes('T')) {
            parsedResponse.fecha_normalizada = fechaStr.replace('T', ' ').slice(0, 19);
          } else if (fechaStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // Si solo tiene fecha, agregar hora actual
            const now = new Date();
            const timeStr = now.toISOString().slice(11, 19);
            parsedResponse.fecha_normalizada = `${fechaStr} ${timeStr}`;
          } else if (!fechaStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
            // Si no tiene el formato correcto, intentar parsear y convertir
            const fecha = new Date(fechaStr);
            if (!isNaN(fecha.getTime())) {
              parsedResponse.fecha_normalizada = fecha.toISOString().slice(0, 19).replace('T', ' ');
            } else {
              // Si no se puede parsear, usar fecha actual
              parsedResponse.fecha_normalizada = new Date().toISOString().slice(0, 19).replace('T', ' ');
            }
          }
        } catch (e) {
          logger.warn('Gemini', `Error normalizando fecha, usando fecha actual`, { url, fechaOriginal: parsedResponse.fecha_normalizada });
          parsedResponse.fecha_normalizada = new Date().toISOString().slice(0, 19).replace('T', ' ');
        }
      }
      
      logger.info('Gemini', `Análisis de URL completado exitosamente`, {
        url,
        tematica: parsedResponse.tematica,
        etiquetasCount: parsedResponse.etiquetas.length,
        urlsCount: parsedResponse.urls.length,
        contenidoLength: parsedResponse.contenido_resumido.length
      });
      
      return parsedResponse;

    } catch (error: any) {
      // Check for Rate Limits (429) or Service Overload (503)
      const isTransient = 
        error.status === 429 || 
        error.code === 429 || 
        (error.message && (error.message.includes('429') || error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED')));

      if (isTransient) {
          if (attempt < maxAttempts) {
            logger.warn('Gemini', `Rate Limit detectado, reintentando`, {
              attempt: `${attempt}/${maxAttempts}`,
              delay: delay,
              url
            });
            await wait(delay);
            delay *= 1.5;
            attempt++;
          } else {
             logger.error('Gemini', `Cuota API excedida después de ${maxAttempts} intentos`, {
               url,
               error: error.message,
               status: error.status
             });
             return {
                tematica: "Error Cuota API",
                etiquetas: ["Error", "Quota"],
                contenido_resumido: "Error: Se ha excedido la cuota de la API Key definida en tu fichero .env (429 Resource Exhausted). Espera unos minutos o revisa tu plan de facturación en Google AI Studio.",
                urls: [url],
                fecha_normalizada: new Date().toISOString().slice(0, 19).replace('T', ' ')
            };
          }
      } else {
        logger.error('Gemini', `Error en análisis de URL`, {
          attempt: `${attempt}/${maxAttempts}`,
          url,
          errorName: error.name,
          errorMessage: error.message,
          status: error.status,
          code: error.code,
          stack: error.stack
        });
        
        if (attempt === maxAttempts) {
          const errorMessage = `Error analizando URL después de ${maxAttempts} intentos: ${error.message || 'Error desconocido'}`;
          logger.error('Gemini', errorMessage, { url });
          
          return {
            tematica: "Error en Análisis",
            etiquetas: ["Error"],
            contenido_resumido: `<p>Error: ${errorMessage}</p><p>URL: <a href="${url}">${url}</a></p>`,
            urls: [url],
            fecha_normalizada: new Date().toISOString().slice(0, 19).replace('T', ' ')
          };
        }
        
        logger.debug('Gemini', `Reintentando`, { delay, url });
        await wait(delay);
        delay *= 1.5;
        attempt++;
      }
    }
  }

  return {
    tematica: "Error",
    etiquetas: ["Error"],
    contenido_resumido: `<p>Error desconocido tras reintentos.</p><p>URL: <a href="${url}">${url}</a></p>`,
    urls: [url],
    fecha_normalizada: new Date().toISOString().slice(0, 19).replace('T', ' ')
  };
};