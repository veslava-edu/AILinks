import React from 'react';
import { AnalyzedEmail } from '../types';

interface ResultsTableProps {
  emails: AnalyzedEmail[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string, fileName: string) => void;
  sortColumn: 'fecha' | 'tematica' | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: 'fecha' | 'tematica') => void;
}

const ResultsTable: React.FC<ResultsTableProps> = ({ 
  emails, 
  selectedIds, 
  onToggleSelect, 
  onDelete,
  sortColumn,
  sortDirection,
  onSort
}) => {
  if (emails.length === 0) {
      return (
          <div className="w-full p-8 text-center border border-slate-700 border-dashed rounded-lg bg-slate-800/30 text-slate-500">
              <p>No se encontraron correos que coincidan con los filtros seleccionados.</p>
          </div>
      );
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-800/50">
      <div className="overflow-x-auto max-h-[80vh] overflow-y-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-900/50 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-4 font-semibold w-12"></th>
              <th 
                className="px-6 py-4 font-semibold cursor-pointer hover:bg-slate-800/50 transition-colors select-none"
                onClick={() => onSort('fecha')}
              >
                <div className="flex items-center gap-2">
                  <span>Fecha</span>
                  {sortColumn === 'fecha' && (
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      className={`h-4 w-4 ${sortDirection === 'asc' ? '' : 'rotate-180'}`}
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  )}
                  {sortColumn !== 'fecha' && (
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      className="h-4 w-4 opacity-30"
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  )}
                </div>
              </th>
              <th 
                className="px-6 py-4 font-semibold cursor-pointer hover:bg-slate-800/50 transition-colors select-none"
                onClick={() => onSort('tematica')}
              >
                <div className="flex items-center gap-2">
                  <span>Temática</span>
                  {sortColumn === 'tematica' && (
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      className={`h-4 w-4 ${sortDirection === 'asc' ? '' : 'rotate-180'}`}
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  )}
                  {sortColumn !== 'tematica' && (
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      className="h-4 w-4 opacity-30"
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  )}
                </div>
              </th>
              <th className="px-6 py-4 font-semibold">Etiquetas</th>
              <th className="px-6 py-4 font-semibold">URLs Detectadas</th>
              <th className="px-6 py-4 font-semibold w-2/5">Contenido Resumido</th>
              <th className="px-4 py-4 font-semibold w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {emails.map((email) => (
              <tr 
                key={email.id} 
                className={`hover:bg-slate-700/30 transition-colors ${selectedIds.has(email.id) ? 'bg-red-900/10 border-l-2 border-red-500' : ''}`}
              >
                <td className="px-4 py-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(email.id)}
                    onChange={() => onToggleSelect(email.id)}
                    className="w-4 h-4 text-red-600 bg-slate-800 border-slate-600 rounded focus:ring-red-500 focus:ring-2 cursor-pointer"
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-slate-300">
                    <div className="flex flex-col">
                        <span>{email.fechaEnvio}</span>
                        <span className="text-xs text-slate-500 max-w-[150px] truncate" title={email.fileName}>{email.fileName}</span>
                    </div>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center rounded-full bg-cyan-900/50 px-2.5 py-0.5 text-xs font-medium text-cyan-300 border border-cyan-800">
                    {email.tematica}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {email.etiquetas.map((tag, idx) => (
                      <span key={idx} className="inline-flex items-center rounded bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-300 border border-slate-600">
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-1">
                    {email.urls.slice(0, 3).map((url, idx) => (
                      <a 
                        key={idx} 
                        href={url} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 hover:underline truncate max-w-[200px]"
                        title={url}
                      >
                        {new URL(url).hostname}
                      </a>
                    ))}
                    {email.urls.length > 3 && (
                        <span className="text-xs text-slate-500">+{email.urls.length - 3} más...</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="max-h-96 overflow-y-auto">
                    <div 
                      className="text-slate-300 text-sm max-w-none
                        [&_strong]:text-slate-100 [&_strong]:font-semibold
                        [&_b]:text-slate-100 [&_b]:font-semibold
                        [&_em]:text-cyan-300 [&_em]:italic [&_em]:not-italic
                        [&_i]:text-cyan-300 [&_i]:italic
                        [&_mark]:bg-yellow-500/30 [&_mark]:text-yellow-200 [&_mark]:px-1 [&_mark]:rounded [&_mark]:font-medium
                        [&_a]:text-cyan-400 [&_a]:hover:text-cyan-300 [&_a]:underline [&_a]:break-all
                        [&_p]:text-slate-300 [&_p]:mb-2 [&_p]:leading-relaxed
                        [&_ul]:list-disc [&_ul]:ml-4 [&_ul]:mb-2 [&_ul]:text-slate-300
                        [&_ol]:list-decimal [&_ol]:ml-4 [&_ol]:mb-2 [&_ol]:text-slate-300
                        [&_li]:mb-1"
                      dangerouslySetInnerHTML={{ __html: email.contenido }}
                    />
                  </div>
                </td>
                <td className="px-4 py-4">
                  <button
                    onClick={() => onDelete(email.id, email.fileName)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded p-1.5 transition-colors"
                    title="Eliminar registro"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ResultsTable;