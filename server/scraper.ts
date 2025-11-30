import puppeteer, { Browser, Page } from 'puppeteer';
import { YoutubeTranscript } from 'youtube-transcript';
import { ScrapedContent } from './types';

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
  }
  return browserInstance;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

function detectUrlType(url: string): 'twitter' | 'github' | 'youtube' | 'article' | 'other' {
  if (url.includes('x.com/') || url.includes('twitter.com/')) {
    return 'twitter';
  }
  if (url.includes('github.com/')) {
    return 'github';
  }
  if (url.includes('youtube.com/') || url.includes('youtu.be/')) {
    return 'youtube';
  }
  return 'article';
}

async function scrapeTwitter(page: Page, url: string): Promise<ScrapedContent> {
  try {
    // Normalizar URL de Twitter/X
    const normalizedUrl = url.replace(/twitter\.com/g, 'x.com').split('?')[0];
    
    await page.goto(normalizedUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Esperar a que el contenido se cargue
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 }).catch(() => {
      // Si no encuentra el selector, continuar de todas formas
    });

    // Extraer contenido del tweet
    const tweetContent = await page.evaluate(() => {
      // Intentar múltiples selectores para encontrar el contenido del tweet
      const selectors = [
        'article[data-testid="tweet"] div[data-testid="tweetText"]',
        'article div[lang]',
        '[data-testid="tweetText"]',
        'article span[lang]'
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent) {
          return element.textContent.trim();
        }
      }

      // Fallback: buscar cualquier texto en el artículo
      const article = document.querySelector('article[data-testid="tweet"]');
      if (article) {
        return (article as HTMLElement).innerText.trim();
      }

      return '';
    });

    // Extraer autor
    const author = await page.evaluate(() => {
      const authorSelectors = [
        'article[data-testid="tweet"] a[href*="/"] span',
        '[data-testid="User-Name"] span',
        'a[href*="/status"] span'
      ];

      for (const selector of authorSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent) {
          const text = element.textContent.trim();
          if (text && !text.includes('·') && text.length < 50) {
            return text;
          }
        }
      }
      return '';
    });

    // Extraer fecha
    const date = await page.evaluate(() => {
      const timeElement = document.querySelector('article[data-testid="tweet"] time');
      if (timeElement) {
        const datetime = timeElement.getAttribute('datetime');
        if (datetime) {
          return datetime;
        }
        return timeElement.textContent?.trim() || '';
      }
      return '';
    });

    // Extraer hilos (tweets relacionados)
    const threadTweets = await page.evaluate(() => {
      const tweets: string[] = [];
      const articleElements = document.querySelectorAll('article[data-testid="tweet"]');
      
      articleElements.forEach((article, index) => {
        if (index > 0) { // Saltar el primer tweet (el principal)
          const textElement = article.querySelector('div[data-testid="tweetText"]') || 
                             article.querySelector('div[lang]');
          if (textElement && textElement.textContent) {
            tweets.push(textElement.textContent.trim());
          }
        }
      });
      
      return tweets;
    });

    let fullContent = tweetContent;
    if (threadTweets.length > 0) {
      fullContent += '\n\n--- Hilo continuado ---\n\n' + threadTweets.join('\n\n');
    }

    return {
      url: normalizedUrl,
      content: fullContent,
      author: author || undefined,
      date: date || undefined,
      type: 'twitter',
      metadata: {
        threadCount: threadTweets.length,
        originalUrl: url
      }
    };
  } catch (error: any) {
    throw new Error(`Error scraping Twitter: ${error.message}`);
  }
}

async function scrapeGitHub(page: Page, url: string): Promise<ScrapedContent> {
  try {
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    const content = await page.evaluate(() => {
      // Extraer README o descripción del repositorio
      const readme = document.querySelector('#readme article') || 
                    document.querySelector('.markdown-body');
      const description = document.querySelector('[itemprop="about"]') || 
                         document.querySelector('.f4');
      
      return (readme?.textContent || description?.textContent || '').trim();
    });

    const title = await page.evaluate(() => {
      const titleElement = document.querySelector('strong[itemprop="name"]') ||
                          document.querySelector('h1 strong');
      return titleElement?.textContent?.trim() || '';
    });

    return {
      url,
      title,
      content,
      type: 'github'
    };
  } catch (error: any) {
    throw new Error(`Error scraping GitHub: ${error.message}`);
  }
}

/**
 * Extrae el ID del video de una URL de YouTube
 */
function extractVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtu.be')) {
      return urlObj.pathname.slice(1);
    } else if (urlObj.hostname.includes('youtube.com')) {
      return urlObj.searchParams.get('v') || null;
    }
  } catch {
    // Si no se puede parsear, intentar extraer ID del patrón
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Obtiene la transcripción de un video de YouTube
 */
export async function getYouTubeTranscript(videoId: string): Promise<string> {
  try {
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
    // Combinar todos los segmentos de la transcripción
    const transcript = transcriptItems
      .map(item => item.text)
      .join(' ')
      .trim();
    return transcript;
  } catch (error: any) {
    throw new Error(`Error obteniendo transcripción de YouTube: ${error.message}`);
  }
}

async function scrapeYouTube(page: Page, url: string): Promise<ScrapedContent> {
  try {
    // Extraer video ID
    const videoId = extractVideoId(url);
    if (!videoId) {
      throw new Error('No se pudo extraer el ID del video de YouTube');
    }

    const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    await page.goto(normalizedUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Esperar a que el contenido se cargue
    await page.waitForSelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, ytd-watch-metadata h1', { timeout: 15000 }).catch(() => {
      // Continuar aunque no encuentre el selector
    });

    // Extraer título del video
    const title = await page.evaluate(() => {
      const titleSelectors = [
        'h1.ytd-watch-metadata yt-formatted-string',
        '#title h1',
        'ytd-watch-metadata h1',
        'h1.ytd-video-primary-info-renderer',
        'meta[property="og:title"]'
      ];

      for (const selector of titleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          if (element.tagName === 'META') {
            return (element as HTMLMetaElement).content || '';
          }
          return element.textContent?.trim() || '';
        }
      }
      return document.title?.replace(' - YouTube', '') || '';
    });

    // Extraer descripción del video
    const description = await page.evaluate(() => {
      const descSelectors = [
        '#description yt-formatted-string',
        '#description-text',
        'ytd-expander #content',
        'meta[property="og:description"]'
      ];

      for (const selector of descSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          if (element.tagName === 'META') {
            return (element as HTMLMetaElement).content || '';
          }
          const text = element.textContent?.trim() || '';
          if (text.length > 50) {
            return text;
          }
        }
      }
      return '';
    });

    // Extraer canal/autor
    const author = await page.evaluate(() => {
      const authorSelectors = [
        'ytd-channel-name a',
        '#channel-name a',
        'ytd-video-owner-renderer #channel-name a',
        'meta[itemprop="author"]'
      ];

      for (const selector of authorSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          if (element.tagName === 'META') {
            return (element as HTMLMetaElement).content || '';
          }
          return element.textContent?.trim() || '';
        }
      }
      return '';
    });

    // Extraer fecha de publicación
    const date = await page.evaluate(() => {
      const dateSelectors = [
        '#info-strings yt-formatted-string',
        '#info-text span',
        'ytd-video-primary-info-renderer #info-strings'
      ];

      for (const selector of dateSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.textContent?.trim() || '';
          // Intentar extraer fecha del texto
          const dateMatch = text.match(/(\d{1,2}\s+\w+\s+\d{4})/);
          if (dateMatch) {
            return dateMatch[1];
          }
          // Buscar atributo datetime
          const datetime = element.getAttribute('datetime');
          if (datetime) {
            return datetime;
          }
        }
      }
      return '';
    });

    // Combinar título y descripción como contenido
    const content = [title, description].filter(Boolean).join('\n\n');

    return {
      url: normalizedUrl,
      title: title || undefined,
      content: content || 'Video de YouTube',
      author: author || undefined,
      date: date || undefined,
      type: 'youtube',
      metadata: {
        videoId,
        originalUrl: url
      }
    };
  } catch (error: any) {
    throw new Error(`Error scraping YouTube: ${error.message}`);
  }
}

async function scrapeArticle(page: Page, url: string): Promise<ScrapedContent> {
  try {
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    const content = await page.evaluate(() => {
      // Intentar encontrar el contenido principal del artículo
      const selectors = [
        'article',
        '[role="article"]',
        'main article',
        '.article-content',
        '.post-content',
        '.entry-content'
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent && element.textContent.length > 100) {
          return element.textContent.trim();
        }
      }

      // Fallback: usar body
      return document.body.textContent?.trim() || '';
    });

    const title = await page.evaluate(() => {
      return document.title || '';
    });

    return {
      url,
      title,
      content,
      type: 'article'
    };
  } catch (error: any) {
    throw new Error(`Error scraping article: ${error.message}`);
  }
}

export async function scrapeUrl(url: string): Promise<ScrapedContent> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    // Configurar User-Agent para evitar bloqueos
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const urlType = detectUrlType(url);
    
    switch (urlType) {
      case 'twitter':
        return await scrapeTwitter(page, url);
      case 'github':
        return await scrapeGitHub(page, url);
      case 'youtube':
        return await scrapeYouTube(page, url);
      default:
        return await scrapeArticle(page, url);
    }
  } finally {
    await page.close();
  }
}

export async function cleanup() {
  await closeBrowser();
}

// Manejar cierre limpio del proceso
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

