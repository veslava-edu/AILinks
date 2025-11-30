export interface ParsedEmailRaw {
  fileName: string;
  rawDate: string;
  rawSubject: string;
  bodyText: string;
}

export interface AnalyzedEmail {
  id: string;
  fileName: string;
  fechaEnvio: string; // ISO String or original string
  tematica: string;
  etiquetas: string[];
  contenido: string;
  urls: string[];
  status: 'pending' | 'processing' | 'completed' | 'error';
  errorMessage?: string;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  PARSING = 'PARSING',
  ANALYZING = 'ANALYZING',
  GENERATING_DB = 'GENERATING_DB',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

// Interface for the SQL.js library (partial)
export interface SqlJsStatic {
  Database: any;
}

declare global {
  interface Window {
    initSqlJs: (config: any) => Promise<any>;
  }
}