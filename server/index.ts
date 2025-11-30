import express from 'express';
import cors from 'cors';
import { scrapeUrl, getYouTubeTranscript } from './scraper';
import { ScrapeError } from './types';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'url-scraper' });
});

// Scrape URL endpoint
app.post('/api/scrape-url', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'URL is required and must be a string'
    } as ScrapeError);
  }

  // Validar que sea una URL válida
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({
      error: 'Invalid URL',
      message: 'The provided URL is not valid',
      url
    } as ScrapeError);
  }

  try {
    console.log(`[Scraper] Scraping URL: ${url}`);
    const scrapedContent = await scrapeUrl(url);
    console.log(`[Scraper] Successfully scraped: ${url}`);
    res.json(scrapedContent);
  } catch (error: any) {
    console.error(`[Scraper] Error scraping ${url}:`, error.message);
    res.status(500).json({
      error: 'Scraping failed',
      message: error.message || 'Unknown error occurred',
      url
    } as ScrapeError);
  }
});

// YouTube Transcript endpoint (flujo independiente para YouTube)
app.post('/api/youtube-transcript', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'URL is required and must be a string'
    } as ScrapeError);
  }

  // Validar que sea una URL válida
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({
      error: 'Invalid URL',
      message: 'The provided URL is not valid',
      url
    } as ScrapeError);
  }

  // Validar que sea una URL de YouTube
  if (!url.includes('youtube.com/') && !url.includes('youtu.be/')) {
    return res.status(400).json({
      error: 'Invalid YouTube URL',
      message: 'The provided URL is not a YouTube URL',
      url
    } as ScrapeError);
  }

  try {
    // Extraer video ID
    let videoId: string | null = null;
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname.includes('youtu.be')) {
        videoId = urlObj.pathname.slice(1);
      } else if (urlObj.hostname.includes('youtube.com')) {
        videoId = urlObj.searchParams.get('v') || null;
      }
    } catch {
      const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (match) {
        videoId = match[1];
      }
    }

    if (!videoId) {
      return res.status(400).json({
        error: 'Invalid YouTube URL',
        message: 'Could not extract video ID from URL',
        url
      } as ScrapeError);
    }

    console.log(`[Scraper] Obteniendo transcripción para video: ${videoId}`);
    
    // Función para validar transcripción
    const validateTranscript = (text: string): { valid: boolean; error?: string; metrics?: any } => {
      // Validar longitud mínima (200 caracteres)
      if (text.length < 200) {
        return { 
          valid: false, 
          error: `Transcripción muy corta: ${text.length} caracteres (mínimo 200 requeridos)` 
        };
      }

      // Contar palabras y palabras únicas
      const words = text.split(/\s+/).filter(w => w.length > 0);
      const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^\w]/g, '')));
      const wordCount = words.length;
      const uniqueWordCount = uniqueWords.size;

      // Validar densidad de palabras (al menos 10 palabras únicas)
      if (uniqueWordCount < 10) {
        return { 
          valid: false, 
          error: `Transcripción tiene muy pocas palabras únicas: ${uniqueWordCount} (mínimo 10 requeridas)` 
        };
      }

      // Validar que contenga palabras reales (no solo caracteres especiales o números)
      const hasRealWords = words.some(w => /[a-zA-Z]{3,}/.test(w));
      if (!hasRealWords) {
        return { 
          valid: false, 
          error: `Transcripción no contiene palabras reales (solo caracteres especiales o números)` 
        };
      }

      // Validar ratio de palabras únicas vs totales (debe ser razonable)
      const uniquenessRatio = uniqueWordCount / wordCount;
      if (uniquenessRatio < 0.1) {
        return { 
          valid: false, 
          error: `Transcripción tiene muy baja diversidad de palabras (ratio: ${uniquenessRatio.toFixed(2)})` 
        };
      }

      return { 
        valid: true, 
        metrics: {
          length: text.length,
          wordCount,
          uniqueWordCount,
          uniquenessRatio: uniquenessRatio.toFixed(2)
        }
      };
    };
    
    // Obtener transcripción PRIMERO
    let transcript = '';
    let transcriptError: string | null = null;
    let transcriptMetrics: any = null;
    try {
      transcript = await getYouTubeTranscript(videoId);
      console.log(`[Scraper] Transcripción obtenida: ${transcript.length} caracteres`);
      
      // Validar transcripción
      const validation = validateTranscript(transcript);
      if (!validation.valid) {
        console.warn(`[Scraper] ⚠️ Transcripción inválida: ${validation.error}`);
        transcriptError = validation.error || 'Transcripción inválida';
        transcript = ''; // Tratar como si no hubiera transcripción
      } else {
        transcriptMetrics = validation.metrics;
        console.log(`[Scraper] ✅ Transcripción válida:`, transcriptMetrics);
        console.log(`[Scraper] Preview transcripción (primeros 500 caracteres): ${transcript.substring(0, 500)}...`);
      }
    } catch (error: any) {
      console.error(`[Scraper] ⚠️ Error obteniendo transcripción: ${error.message}`);
      transcriptError = error.message;
      transcript = ''; // Asegurar que esté vacía si hay error
    }
    
    // Obtener metadatos básicos usando scraping
    const scrapedContent = await scrapeUrl(url);
    
    // Validar que tenemos información útil
    const hasValidTranscript = transcript.length >= 200 && transcriptMetrics !== null;
    const hasValidMetadata = scrapedContent.content && scrapedContent.content.length > 0;
    
    if (!hasValidTranscript && !hasValidMetadata) {
      console.error(`[Scraper] ❌ No se pudo obtener ni transcripción ni metadatos válidos`);
      return res.status(500).json({
        error: 'No content available',
        message: 'No se pudo obtener transcripción ni metadatos del video',
        url
      } as ScrapeError);
    }
    
    // Combinar transcripción con metadatos
    // IMPORTANTE: Si hay transcripción válida, debe ser el contenido principal
    res.json({
      ...scrapedContent,
      content: hasValidTranscript ? transcript : scrapedContent.content, // Usar transcripción si está disponible y es válida
      transcript: transcript, // Incluir transcripción completa como campo separado
      metadata: {
        ...scrapedContent.metadata,
        hasTranscript: hasValidTranscript,
        transcriptLength: transcript.length,
        transcriptError: transcriptError || undefined,
        transcriptMetrics: transcriptMetrics || undefined,
        transcriptPreview: hasValidTranscript ? transcript.substring(0, 500) : undefined,
        usingFallback: !hasValidTranscript && hasValidMetadata
      }
    });
  } catch (error: any) {
    console.error(`[Scraper] Error obteniendo transcripción de YouTube ${url}:`, error.message);
    res.status(500).json({
      error: 'Transcript fetch failed',
      message: error.message || 'Unknown error occurred',
      url
    } as ScrapeError);
  }
});

app.listen(PORT, () => {
  console.log(`[Server] URL Scraper server running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
});

