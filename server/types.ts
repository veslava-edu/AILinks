export interface ScrapedContent {
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

export interface ScrapeError {
  error: string;
  message: string;
  url: string;
}

