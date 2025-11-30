import React, { useCallback, useState } from 'react';

interface YouTubeDropzoneProps {
  onUrlsDropped: (urls: string[]) => void;
  disabled?: boolean;
}

const YouTubeDropzone: React.FC<YouTubeDropzoneProps> = ({ onUrlsDropped, disabled }) => {
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
    const urls = extractYouTubeUrls(text);
    
    if (urls.length > 0) {
      onUrlsDropped(urls);
    }
  }, [onUrlsDropped, disabled]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (disabled) return;
    const text = e.clipboardData.getData('text/plain');
    const urls = extractYouTubeUrls(text);
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
    const urls = extractYouTubeUrls(urlInput);
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
            ? 'border-red-400 bg-red-900/20 shadow-[0_0_20px_rgba(239,68,68,0.2)]' 
            : 'border-slate-600 hover:border-slate-500 bg-slate-800/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <div className="flex flex-col items-center justify-center space-y-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
          <div>
            <p className="text-lg font-medium text-slate-200">
              Arrastra enlaces de YouTube aquí o pégalos
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Videos de YouTube para categorizar
            </p>
          </div>
        </div>
      </div>
      
      <div className="space-y-2">
        <textarea
          value={urlInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Pega URLs de YouTube aquí (una por línea o separadas por espacios)...&#10;Ejemplo:&#10;https://www.youtube.com/watch?v=dQw4w9WgXcQ&#10;https://youtu.be/delVwNqJ8Q"
          disabled={disabled}
          className={`
            w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
            text-slate-200 placeholder-slate-500 focus:outline-none focus:border-red-500 
            focus:ring-2 focus:ring-red-500/20 resize-none
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
              : 'bg-red-600 hover:bg-red-700 text-white'}
          `}
        >
          Procesar Videos
        </button>
        <p className="text-xs text-slate-500 text-center">
          También puedes pegar URLs directamente en el área de arriba o usar Ctrl+Enter aquí
        </p>
      </div>
    </div>
  );
};

/**
 * Extrae URLs válidas de YouTube de un texto
 */
function extractYouTubeUrls(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  
  // Patrones para URLs de YouTube
  const youtubePatterns = [
    /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/gi,
    /https?:\/\/(?:www\.)?youtube\.com\/watch\?[^\s<>"{}|\\^`\[\]]+/gi
  ];
  
  const urls: string[] = [];
  
  youtubePatterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      urls.push(...matches.map(url => url.trim()));
    }
  });
  
  // Normalizar y filtrar URLs duplicadas
  const uniqueUrls = Array.from(new Set(urls));
  
  // Filtrar URLs válidas de YouTube
  return uniqueUrls.filter(url => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be');
    } catch {
      return false;
    }
  });
}

export default YouTubeDropzone;

