import React, { useCallback, useState } from 'react';

interface UrlDropzoneProps {
  onUrlsDropped: (urls: string[]) => void;
  disabled?: boolean;
}

const UrlDropzone: React.FC<UrlDropzoneProps> = ({ onUrlsDropped, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    // Intentar extraer URLs del texto arrastrado
    const text = e.dataTransfer.getData('text/plain');
    const urls = extractUrls(text);
    
    if (urls.length > 0) {
      onUrlsDropped(urls);
    }
  }, [onUrlsDropped, disabled]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (disabled) return;
    const text = e.clipboardData.getData('text/plain');
    const urls = extractUrls(text);
    if (urls.length > 0) {
      e.preventDefault();
      onUrlsDropped(urls);
      setUrlInput('');
    }
  }, [onUrlsDropped, disabled]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setUrlInput(e.target.value);
  };

  const handleSubmitUrls = () => {
    if (disabled || !urlInput.trim()) return;
    const urls = extractUrls(urlInput);
    if (urls.length > 0) {
      onUrlsDropped(urls);
      setUrlInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmitUrls();
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
        className={`
          relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-300
          ${isDragging 
            ? 'border-purple-400 bg-purple-900/20 shadow-[0_0_20px_rgba(192,132,252,0.2)]' 
            : 'border-slate-600 hover:border-slate-500 bg-slate-800/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <div className="flex flex-col items-center justify-center space-y-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <div>
            <p className="text-lg font-medium text-slate-200">
              Arrastra enlaces aquí o pégalos
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Twitter, GitHub, artículos, repositorios, etc.
            </p>
          </div>
        </div>
      </div>
      
      <div className="space-y-2">
        <textarea
          value={urlInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Pega URLs aquí (una por línea o separadas por espacios)...&#10;Ejemplo:&#10;https://twitter.com/user/status/123&#10;https://github.com/user/repo"
          disabled={disabled}
          className={`
            w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
            text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 
            focus:ring-2 focus:ring-purple-500/20 resize-none
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          rows={4}
        />
        <button
          onClick={handleSubmitUrls}
          disabled={disabled || !urlInput.trim()}
          className={`
            w-full px-4 py-2 rounded-lg font-medium transition-colors
            ${disabled || !urlInput.trim()
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-purple-600 hover:bg-purple-700 text-white'}
          `}
        >
          Procesar URLs
        </button>
        <p className="text-xs text-slate-500 text-center">
          También puedes pegar URLs directamente en el área de arriba o usar Ctrl+Enter aquí
        </p>
      </div>
    </div>
  );
};

/**
 * Extrae URLs válidas de un texto
 */
function extractUrls(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  
  // Patrón para URLs válidas (http/https)
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const matches = text.match(urlPattern);
  
  if (!matches) return [];
  
  // Normalizar y filtrar URLs duplicadas
  const uniqueUrls = Array.from(new Set(matches.map(url => url.trim())));
  
  // Filtrar URLs válidas
  return uniqueUrls.filter(url => {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  });
}

export default UrlDropzone;

