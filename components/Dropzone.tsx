import React, { useCallback, useState } from 'react';

interface DropzoneProps {
  onFilesDropped: (files: File[]) => void;
  disabled?: boolean;
}

const Dropzone: React.FC<DropzoneProps> = ({ onFilesDropped, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);

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

    const files = (Array.from(e.dataTransfer.files) as File[]).filter(file => 
        file.name.toLowerCase().endsWith('.eml')
    );
    
    if (files.length > 0) {
      onFilesDropped(files);
    }
  }, [onFilesDropped, disabled]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      if(e.target.files && !disabled) {
          const files = (Array.from(e.target.files) as File[]).filter(file => 
            file.name.toLowerCase().endsWith('.eml')
          );
          onFilesDropped(files);
      }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-300
          ${isDragging 
            ? 'border-cyan-400 bg-cyan-900/20 shadow-[0_0_20px_rgba(34,211,238,0.2)]' 
            : 'border-slate-600 hover:border-slate-500 bg-slate-800/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <input 
          type="file" 
          multiple 
          accept=".eml"
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          disabled={disabled}
        />
        <div className="flex flex-col items-center justify-center space-y-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <div>
            <p className="text-lg font-medium text-slate-200">
              Arrastra ficheros .eml aquí
            </p>
            <p className="text-sm text-slate-400 mt-1">
              o haz click para seleccionar
            </p>
          </div>
        </div>
      </div>
      
      {/* Placeholder para mantener el mismo tamaño que UrlDropzone */}
      <div className="space-y-2 opacity-0 pointer-events-none" style={{ height: '140px' }}>
        <div className="w-full h-full"></div>
      </div>
    </div>
  );
};

export default Dropzone;