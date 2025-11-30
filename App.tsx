import React, { useState, useEffect, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Dropzone from './components/Dropzone';
import UrlDropzone from './components/UrlDropzone';
import YouTubeDropzone from './components/YouTubeDropzone';
import ResultsTable from './components/ResultsTable';
import { AnalyzedEmail, ProcessingStatus } from './types';
import { parseEmlFile } from './services/parserService';
import { analyzeEmailContent, analyzeUrlContent, validateApiKeyConfiguration } from './services/geminiService';
import { saveToDb, exportDb, exportDbAndSaveToBd, resetDb, getAllEmails, importDb, getExistingFileNames, deleteRecords } from './services/dbService';
import { logger } from './services/loggerService';

const App: React.FC = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [youtubeUrls, setYoutubeUrls] = useState<string[]>([]);
  const [processedEmails, setProcessedEmails] = useState<AnalyzedEmail[]>([]);
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [progress, setProgress] = useState<{ current: number; total: number; currentFile?: string; currentUrl?: string }>({ current: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isApiKeyValid, setIsApiKeyValid] = useState<boolean>(true);
  
  // Control de cancelación del procesamiento
  const isProcessingCancelled = useRef<boolean>(false);

  // Filter State - Multi-select
  const [filterTopics, setFilterTopics] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showTopicDropdown, setShowTopicDropdown] = useState<boolean>(false);
  const [showTagDropdown, setShowTagDropdown] = useState<boolean>(false);
  
  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Tab State
  const [activeTab, setActiveTab] = useState<'eml' | 'urls' | 'youtube'>('eml');
  
  // Sorting State
  const [sortColumn, setSortColumn] = useState<'fecha' | 'tematica' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Load existing data from persistence on mount
  useEffect(() => {
    logger.info('App', 'Aplicación iniciada');
    const loadData = async () => {
      try {
        const existingEmails = await getAllEmails();
        if (existingEmails.length > 0) {
          setProcessedEmails(existingEmails);
          logger.info('App', `Cargados ${existingEmails.length} enlace(s) desde persistencia`);
        }
      } catch (e: any) {
        logger.error('App', 'Error cargando base de datos persistida', { error: e.message, stack: e.stack });
      }
    };
    loadData();
    const apiKeyValid = validateApiKeyConfiguration();
    setIsApiKeyValid(apiKeyValid);
    if (!apiKeyValid) {
      logger.warn('App', 'API Key no configurada');
    }
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.filter-dropdown')) {
        setShowTopicDropdown(false);
        setShowTagDropdown(false);
      }
    };

    if (showTopicDropdown || showTagDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showTopicDropdown, showTagDropdown]);


  const handleFilesDropped = async (newFiles: File[]) => {
    // Filter out files that have already been processed
    const existingFileNames = await getExistingFileNames();
    const newFilesToProcess = newFiles.filter(file => !existingFileNames.has(file.name));
    
    if (newFilesToProcess.length === 0) {
      setErrorMsg(`Todos los archivos seleccionados ya han sido procesados. Se omitieron ${newFiles.length} archivo(s).`);
      setFiles([]);
      return;
    }
    
    if (newFilesToProcess.length < newFiles.length) {
      const skippedCount = newFiles.length - newFilesToProcess.length;
      setErrorMsg(`${skippedCount} archivo(s) ya procesado(s) fueron omitidos. ${newFilesToProcess.length} archivo(s) nuevo(s) listo(s) para procesar.`);
    } else {
      setErrorMsg(null);
    }
    
    setFiles(newFilesToProcess);
    setStatus(ProcessingStatus.IDLE);
    setActiveTab('eml'); // Cambiar a la pestaña de EML cuando se agreguen archivos
  };

  const handleUrlsDropped = (newUrls: string[]) => {
    if (newUrls.length === 0) {
      setErrorMsg('No se encontraron URLs válidas.');
      return;
    }
    
    setUrls(newUrls);
    setErrorMsg(null);
    setStatus(ProcessingStatus.IDLE);
    setActiveTab('urls'); // Cambiar a la pestaña de URLs cuando se agreguen enlaces
  };

  const handleYouTubeUrlsDropped = (newUrls: string[]) => {
    if (newUrls.length === 0) {
      setErrorMsg('No se encontraron URLs de YouTube válidas.');
      return;
    }
    
    setYoutubeUrls(newUrls);
    setErrorMsg(null);
    setStatus(ProcessingStatus.IDLE);
    setActiveTab('youtube'); // Cambiar a la pestaña de YouTube cuando se agreguen videos
  };

  const stopProcessing = () => {
    logger.info('Procesamiento', 'Cancelación solicitada por el usuario');
    isProcessingCancelled.current = true;
    setErrorMsg('Procesamiento cancelado por el usuario');
  };

  const downloadLogs = () => {
    const errorCount = logger.getErrorCount();
    if (errorCount > 0) {
      logger.info('UI', `Descargando logs con ${errorCount} error(es)`);
    }
    logger.downloadLogs('txt');
  };

  const processFiles = async () => {
    if (files.length === 0) return;

    if (!isApiKeyValid) {
        setErrorMsg("API Key no configurada.");
        return;
    }

    // Reset cancellation flag
    isProcessingCancelled.current = false;
    setStatus(ProcessingStatus.PARSING);
    setProgress({ current: 0, total: files.length, currentFile: files[0]?.name });
    setErrorMsg(null);
    
    const results: AnalyzedEmail[] = [];

    const processingErrors: string[] = [];
    
    try {
      for (let i = 0; i < files.length; i++) {
        // Check if processing was cancelled
        if (isProcessingCancelled.current) {
          logger.info('Procesamiento', `Procesamiento cancelado después de ${i} archivo(s)`, { processedCount: results.length });
          setErrorMsg(`Procesamiento cancelado. ${results.length} archivo(s) procesado(s) antes de la cancelación.`);
          setStatus(ProcessingStatus.IDLE);
          
          // Save what was processed so far
          if (results.length > 0) {
            setStatus(ProcessingStatus.GENERATING_DB);
            await saveToDb(results);
            const allEmails = await getAllEmails();
            setProcessedEmails(allEmails);
          }
          
          setStatus(ProcessingStatus.IDLE);
          return;
        }
        const file = files[i];
        const fileNumber = i + 1;
        
        logger.info('Procesamiento', `Iniciando archivo ${fileNumber}/${files.length}`, { fileName: file.name, fileNumber, total: files.length });
        // Only show progress message during processing, not as error
        if (status !== ProcessingStatus.COMPLETED && status !== ProcessingStatus.ERROR) {
          setErrorMsg(`Procesando ${fileNumber}/${files.length}: ${file.name}`);
        }
        
        // RATE LIMIT PROTECTION
        // Gemini Free Tier allows ~15 RPM (Requests Per Minute). 
        // We set 15 seconds delay to be extremely safe (4 RPM)
        if (i > 0) {
            logger.debug('Procesamiento', `Esperando 15 segundos antes del siguiente archivo`, { fileName: file.name });
            // Check for cancellation during delay
            for (let delayCount = 0; delayCount < 15; delayCount++) {
              if (isProcessingCancelled.current) {
                logger.info('Procesamiento', `Cancelación detectada durante la espera`, { fileName: file.name });
                break;
              }
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            if (isProcessingCancelled.current) continue; // Will be caught by check at start of loop
        }
        
        try {
          // 1. Local Parse
          logger.info('Procesamiento', `Paso 1/3: Parseando archivo`, { fileName: file.name });
          setStatus(ProcessingStatus.PARSING);
          setProgress({ current: i, total: files.length, currentFile: file.name });
          
          let parsedRaw;
          try {
            parsedRaw = await parseEmlFile(file);
            logger.info('Procesamiento', `Parseo completado exitosamente`, {
              fileName: file.name,
              subject: parsedRaw.rawSubject,
              date: parsedRaw.rawDate,
              bodyLength: parsedRaw.bodyText.length
            });
          } catch (parseError: any) {
            logger.error('Procesamiento', `Error en parseo`, {
              fileName: file.name,
              error: parseError.message,
              stack: parseError.stack
            });
            throw new Error(`Error parseando archivo: ${parseError.message || 'Error desconocido en parseo'}`);
          }
          
          // 2. AI Analysis
          logger.info('Procesamiento', `Paso 2/3: Analizando con Gemini`, { fileName: file.name });
          setStatus(ProcessingStatus.ANALYZING);
          setProgress({ current: i, total: files.length, currentFile: file.name });
          
          let analysis;
          try {
            analysis = await analyzeEmailContent(parsedRaw);
            logger.info('Procesamiento', `Análisis completado exitosamente`, { fileName: file.name });
          } catch (analysisError: any) {
            logger.error('Procesamiento', `Error en análisis de Gemini`, {
              fileName: file.name,
              error: analysisError.message,
              stack: analysisError.stack,
              errorName: analysisError.name
            });
            throw new Error(`Error en análisis de Gemini: ${analysisError.message || 'Error desconocido en análisis'}`);
          }

          // Check for specific API Key Error returned from service logic
          if (analysis.tematica === "Error Cuota API") {
              const errorMsg = "Tu API Key ha excedido la cuota gratuita (429). Espera un minuto o revisa tu plan.";
              logger.error('Procesamiento', `Error de cuota API`, { fileName: file.name });
              setErrorMsg(errorMsg);
              setStatus(ProcessingStatus.ERROR);
              break;
          }
          
          if (analysis.tematica === "Error en Análisis") {
              const errorMsg = `Error analizando ${file.name}: ${analysis.contenido_resumido}`;
              logger.error('Procesamiento', errorMsg, { fileName: file.name });
              processingErrors.push(errorMsg);
              // Continue with next file instead of breaking
              setProgress({ current: i + 1, total: files.length });
              continue;
          }

          // 3. Create analyzed email object
          logger.info('Procesamiento', `Paso 3/3: Creando objeto analizado`, { fileName: file.name });
          
          // Validate data before creating object
          const validatedEtiquetas = Array.isArray(analysis.etiquetas) 
            ? analysis.etiquetas.filter((tag: any) => typeof tag === 'string' && tag.trim().length > 0)
            : [];
          
          const validatedUrls = Array.isArray(analysis.urls)
            ? analysis.urls.filter((url: any) => typeof url === 'string' && url.trim().length > 0)
            : [];
          
          const validatedTematica = analysis.tematica && typeof analysis.tematica === 'string' 
            ? analysis.tematica.trim() 
            : 'Sin clasificar';
          
          // Use HTML summary (200 words) instead of full content
          const contenidoResumido = analysis.contenido_resumido && typeof analysis.contenido_resumido === 'string'
            ? analysis.contenido_resumido.trim()
            : (parsedRaw.bodyText && parsedRaw.bodyText.trim().length > 0
                ? `<p>${parsedRaw.bodyText.substring(0, 500).trim()}...</p>`
                : '<p>No se pudo obtener el contenido del correo.</p>');
          
          const validatedFecha = analysis.fecha_normalizada && typeof analysis.fecha_normalizada === 'string'
            ? analysis.fecha_normalizada.trim()
            : parsedRaw.rawDate || new Date().toISOString();
          
          const analyzedEmail: AnalyzedEmail = {
            id: uuidv4(),
            fileName: file.name,
            fechaEnvio: validatedFecha,
            tematica: validatedTematica,
            etiquetas: validatedEtiquetas,
            contenido: contenidoResumido,
            urls: validatedUrls,
            status: 'completed'
          };

          logger.debug('Procesamiento', `Objeto analizado creado`, {
            fileName: file.name,
            tematica: validatedTematica,
            etiquetasCount: validatedEtiquetas.length,
            urlsCount: validatedUrls.length,
            contenidoLength: contenidoResumido.length
          });

          results.push(analyzedEmail);
          logger.info('Procesamiento', `Archivo procesado exitosamente`, { fileName: file.name, fileNumber, total: files.length });
          
          // Save immediately to DB and update UI in real-time
          try {
            await saveToDb([analyzedEmail]);
            // Reload from DB to show updated list
            const allEmails = await getAllEmails();
            setProcessedEmails(allEmails);
            logger.debug('Procesamiento', `Email guardado y UI actualizada`, { fileName: file.name });
          } catch (saveError: any) {
            logger.error('Procesamiento', `Error guardando email individual`, {
              fileName: file.name,
              error: saveError.message
            });
            // Continue processing even if save fails
          }
          
        } catch (fileError: any) {
          const errorMsg = `Error procesando ${file.name}: ${fileError.message || 'Error desconocido'}`;
          logger.error('Procesamiento', `Error procesando archivo`, {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            errorName: fileError.name,
            errorMessage: fileError.message,
            stack: fileError.stack
          });
          processingErrors.push(errorMsg);
          
          // Create error entry for this file
          const errorEmail: AnalyzedEmail = {
            id: uuidv4(),
            fileName: file.name,
            fechaEnvio: new Date().toISOString(),
            tematica: "Error en Análisis",
            etiquetas: ["Error"],
            contenido: `Error procesando archivo: ${fileError.message || 'No se pudo analizar el contenido'}. Revisa la consola (F12) para más detalles.`,
            urls: [],
            status: 'error',
            errorMessage: fileError.message || 'Error desconocido'
          };
          
          results.push(errorEmail);
          
          // Save error email immediately to DB
          try {
            await saveToDb([errorEmail]);
            const allEmails = await getAllEmails();
            setProcessedEmails(allEmails);
          } catch (saveError: any) {
            logger.error('Procesamiento', `Error guardando email con error`, {
              fileName: file.name,
              error: saveError.message
            });
          }
          
          // Update error message in UI
          setErrorMsg(`Error en ${file.name}. ${processingErrors.length} error(es) hasta ahora. Revisa la consola (F12) para detalles.`);
        }
        
        setProgress({ current: i + 1, total: files.length, currentFile: i + 1 < files.length ? files[i + 1]?.name : undefined });
      }
      
      // All emails have been saved individually, no need to save again
      logger.info('Procesamiento', `Procesamiento completado. ${results.length} archivo(s) procesado(s) y guardado(s) individualmente`);
      
      // Show summary of errors if any, or clear message on success
      if (processingErrors.length > 0) {
        logger.warn('Procesamiento', `Resumen de errores`, { errorCount: processingErrors.length, errors: processingErrors });
        // Keep error message for warnings
      } else {
        logger.info('Procesamiento', `Todos los archivos procesados exitosamente`, { totalProcessed: results.length });
        // Clear progress message on success
        setErrorMsg(null);
      }
      
      if (status !== ProcessingStatus.ERROR && !isProcessingCancelled.current) {
        setStatus(ProcessingStatus.COMPLETED);
        setFiles([]); // Clear queue
        // Clear progress message
        setProgress({ current: 0, total: 0 });
        // Ensure error message is cleared on successful completion
        if (processingErrors.length === 0) {
          setErrorMsg(null);
        } else {
          // Set final summary message if there were errors
          setErrorMsg(`${results.length} archivo(s) procesado(s). ${processingErrors.length} error(es) - descarga los logs para detalles.`);
        }
      }
      
      // Reset cancellation flag
      isProcessingCancelled.current = false;

    } catch (err: any) {
      logger.error('Procesamiento', 'Error crítico en procesamiento', {
        error: err.message,
        stack: err.stack,
        errorName: err.name,
        filesProcessed: results.length,
        totalFiles: files.length
      });
      setStatus(ProcessingStatus.ERROR);
      // Simplify error message for UI
      const msg = err.message || "Ocurrió un error crítico.";
      setErrorMsg(msg.includes("API Key") ? msg : `Error procesando ficheros. ${results.length} procesado(s). Descarga los logs para detalles.`);
    }
  };

  const processUrls = async () => {
    if (urls.length === 0) return;

    if (!isApiKeyValid) {
        setErrorMsg("API Key no configurada.");
        return;
    }

    // Reset cancellation flag
    isProcessingCancelled.current = false;
    setStatus(ProcessingStatus.ANALYZING);
    setProgress({ current: 0, total: urls.length, currentUrl: urls[0] });
    setErrorMsg(null);
    
    const results: AnalyzedEmail[] = [];
    const processingErrors: string[] = [];
    
    try {
      for (let i = 0; i < urls.length; i++) {
        // Check if processing was cancelled
        if (isProcessingCancelled.current) {
          logger.info('Procesamiento', `Procesamiento cancelado después de ${i} URL(s)`, { processedCount: results.length });
          setErrorMsg(`Procesamiento cancelado. ${results.length} URL(s) procesada(s) antes de la cancelación.`);
          setStatus(ProcessingStatus.IDLE);
          
          // Save what was processed so far
          if (results.length > 0) {
            setStatus(ProcessingStatus.GENERATING_DB);
            await saveToDb(results);
            const allEmails = await getAllEmails();
            setProcessedEmails(allEmails);
          }
          
          setStatus(ProcessingStatus.IDLE);
          return;
        }
        
        const url = urls[i];
        const urlNumber = i + 1;
        
        logger.info('Procesamiento', `Iniciando URL ${urlNumber}/${urls.length}`, { url, urlNumber, total: urls.length });
        if (status !== ProcessingStatus.COMPLETED && status !== ProcessingStatus.ERROR) {
          setErrorMsg(`Procesando ${urlNumber}/${urls.length}: ${url}`);
        }
        
        // RATE LIMIT PROTECTION
        if (i > 0) {
            logger.debug('Procesamiento', `Esperando 15 segundos antes de la siguiente URL`, { url });
            for (let delayCount = 0; delayCount < 15; delayCount++) {
              if (isProcessingCancelled.current) {
                logger.info('Procesamiento', `Cancelación detectada durante la espera`, { url });
                break;
              }
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            if (isProcessingCancelled.current) continue;
        }
        
        try {
          // AI Analysis
          logger.info('Procesamiento', `Analizando URL con Gemini`, { url });
          setStatus(ProcessingStatus.ANALYZING);
          setProgress({ current: i, total: urls.length, currentUrl: url });
          
          let analysis;
          try {
            analysis = await analyzeUrlContent(url);
            logger.info('Procesamiento', `Análisis completado exitosamente`, { url });
          } catch (analysisError: any) {
            logger.error('Procesamiento', `Error en análisis de Gemini`, {
              url,
              error: analysisError.message,
              stack: analysisError.stack,
              errorName: analysisError.name
            });
            throw new Error(`Error en análisis de Gemini: ${analysisError.message || 'Error desconocido en análisis'}`);
          }

          // Check for specific API Key Error returned from service logic
          if (analysis.tematica === "Error Cuota API") {
              const errorMsg = "Tu API Key ha excedido la cuota gratuita (429). Espera un minuto o revisa tu plan.";
              logger.error('Procesamiento', `Error de cuota API`, { url });
              setErrorMsg(errorMsg);
              setStatus(ProcessingStatus.ERROR);
              break;
          }
          
          if (analysis.tematica === "Error en Análisis") {
              const errorMsg = `Error analizando ${url}: ${analysis.contenido_resumido}`;
              logger.error('Procesamiento', errorMsg, { url });
              processingErrors.push(errorMsg);
              setProgress({ current: i + 1, total: urls.length });
              continue;
          }

          // Create analyzed email object (reusing AnalyzedEmail type for consistency)
          logger.info('Procesamiento', `Creando objeto analizado`, { url });
          
          const validatedEtiquetas = Array.isArray(analysis.etiquetas) 
            ? analysis.etiquetas.filter((tag: any) => typeof tag === 'string' && tag.trim().length > 0)
            : [];
          
          const validatedUrls = Array.isArray(analysis.urls)
            ? analysis.urls.filter((urlItem: any) => typeof urlItem === 'string' && urlItem.trim().length > 0)
            : [];
          
          const validatedTematica = analysis.tematica && typeof analysis.tematica === 'string' 
            ? analysis.tematica.trim() 
            : 'Sin clasificar';
          
          const contenidoResumido = analysis.contenido_resumido && typeof analysis.contenido_resumido === 'string'
            ? analysis.contenido_resumido.trim()
            : `<p>Enlace: <a href="${url}">${url}</a></p>`;
          
          // Usar la fecha-hora actual del momento de procesamiento
          const validatedFecha = new Date().toISOString().slice(0, 19).replace('T', ' ');
          
          // Usar la URL como fileName para mantener consistencia con la BD
          const analyzedEmail: AnalyzedEmail = {
            id: uuidv4(),
            fileName: url, // Usar URL como identificador
            fechaEnvio: validatedFecha,
            tematica: validatedTematica,
            etiquetas: validatedEtiquetas,
            contenido: contenidoResumido,
            urls: validatedUrls,
            status: 'completed'
          };

          logger.debug('Procesamiento', `Objeto analizado creado`, {
            url,
            tematica: validatedTematica,
            etiquetasCount: validatedEtiquetas.length,
            urlsCount: validatedUrls.length,
            contenidoLength: contenidoResumido.length
          });

          results.push(analyzedEmail);
          logger.info('Procesamiento', `URL procesada exitosamente`, { url, urlNumber, total: urls.length });
          
          // Save immediately to DB and update UI in real-time
          try {
            await saveToDb([analyzedEmail]);
            const allEmails = await getAllEmails();
            setProcessedEmails(allEmails);
            logger.debug('Procesamiento', `URL guardada y UI actualizada`, { url });
          } catch (saveError: any) {
            logger.error('Procesamiento', `Error guardando URL individual`, {
              url,
              error: saveError.message
            });
          }
          
        } catch (urlError: any) {
          const errorMsg = `Error procesando ${url}: ${urlError.message || 'Error desconocido'}`;
          logger.error('Procesamiento', `Error procesando URL`, {
            url,
            errorName: urlError.name,
            errorMessage: urlError.message,
            stack: urlError.stack
          });
          processingErrors.push(errorMsg);
          
          // Create error entry for this URL
          const errorEmail: AnalyzedEmail = {
            id: uuidv4(),
            fileName: url,
            fechaEnvio: new Date().toISOString(),
            tematica: "Error en Análisis",
            etiquetas: ["Error"],
            contenido: `Error procesando URL: ${urlError.message || 'No se pudo analizar el contenido'}. Revisa la consola (F12) para más detalles.`,
            urls: [url],
            status: 'error',
            errorMessage: urlError.message || 'Error desconocido'
          };
          
          results.push(errorEmail);
          
          // Save error entry immediately to DB
          try {
            await saveToDb([errorEmail]);
            const allEmails = await getAllEmails();
            setProcessedEmails(allEmails);
          } catch (saveError: any) {
            logger.error('Procesamiento', `Error guardando URL con error`, {
              url,
              error: saveError.message
            });
          }
          
          setErrorMsg(`Error en ${url}. ${processingErrors.length} error(es) hasta ahora. Revisa la consola (F12) para detalles.`);
        }
        
        setProgress({ current: i + 1, total: urls.length, currentUrl: i + 1 < urls.length ? urls[i + 1] : undefined });
      }
      
      // All URLs have been saved individually
      logger.info('Procesamiento', `Procesamiento completado. ${results.length} URL(s) procesada(s) y guardada(s) individualmente`);
      
      if (processingErrors.length > 0) {
        logger.warn('Procesamiento', `Resumen de errores`, { errorCount: processingErrors.length, errors: processingErrors });
      } else {
        logger.info('Procesamiento', `Todas las URLs procesadas exitosamente`, { totalProcessed: results.length });
        setErrorMsg(null);
      }
      
      if (status !== ProcessingStatus.ERROR && !isProcessingCancelled.current) {
        setStatus(ProcessingStatus.COMPLETED);
        setUrls([]); // Clear queue
        setProgress({ current: 0, total: 0 });
        if (processingErrors.length === 0) {
          setErrorMsg(null);
        } else {
          setErrorMsg(`${results.length} URL(s) procesada(s). ${processingErrors.length} error(es) - descarga los logs para detalles.`);
        }
      }
      
      isProcessingCancelled.current = false;

    } catch (err: any) {
      logger.error('Procesamiento', 'Error crítico en procesamiento de URLs', {
        error: err.message,
        stack: err.stack,
        errorName: err.name,
        urlsProcessed: results.length,
        totalUrls: urls.length
      });
      setStatus(ProcessingStatus.ERROR);
      const msg = err.message || "Ocurrió un error crítico.";
      setErrorMsg(msg.includes("API Key") ? msg : `Error procesando URLs. ${results.length} procesada(s). Descarga los logs para detalles.`);
    }
  };

  const processYouTubeUrls = async () => {
    if (youtubeUrls.length === 0) return;

    if (!isApiKeyValid) {
        setErrorMsg("API Key no configurada.");
        return;
    }

    // Reset cancellation flag
    isProcessingCancelled.current = false;
    setStatus(ProcessingStatus.ANALYZING);
    setProgress({ current: 0, total: youtubeUrls.length, currentUrl: youtubeUrls[0] });
    setErrorMsg(null);
    
    const results: AnalyzedEmail[] = [];
    const processingErrors: string[] = [];
    
    try {
      for (let i = 0; i < youtubeUrls.length; i++) {
        // Check if processing was cancelled
        if (isProcessingCancelled.current) {
          logger.info('Procesamiento', `Procesamiento cancelado después de ${i} video(s)`, { processedCount: results.length });
          setErrorMsg(`Procesamiento cancelado. ${results.length} video(s) procesado(s) antes de la cancelación.`);
          setStatus(ProcessingStatus.IDLE);
          
          // Save what was processed so far
          if (results.length > 0) {
            setStatus(ProcessingStatus.GENERATING_DB);
            await saveToDb(results);
            const allEmails = await getAllEmails();
            setProcessedEmails(allEmails);
          }
          
          setStatus(ProcessingStatus.IDLE);
          return;
        }
        
        const url = youtubeUrls[i];
        const urlNumber = i + 1;
        
        logger.info('Procesamiento', `Iniciando video YouTube ${urlNumber}/${youtubeUrls.length}`, { url, urlNumber, total: youtubeUrls.length });
        if (status !== ProcessingStatus.COMPLETED && status !== ProcessingStatus.ERROR) {
          setErrorMsg(`Procesando ${urlNumber}/${youtubeUrls.length}: ${url}`);
        }
        
        // RATE LIMIT PROTECTION
        if (i > 0) {
            logger.debug('Procesamiento', `Esperando 15 segundos antes del siguiente video`, { url });
            for (let delayCount = 0; delayCount < 15; delayCount++) {
              if (isProcessingCancelled.current) {
                logger.info('Procesamiento', `Cancelación detectada durante la espera`, { url });
                break;
              }
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            if (isProcessingCancelled.current) continue;
        }
        
        try {
          // AI Analysis con transcripción
          logger.info('Procesamiento', `Obteniendo transcripción y analizando video con Gemini`, { url });
          setStatus(ProcessingStatus.ANALYZING);
          setProgress({ current: i, total: youtubeUrls.length, currentUrl: url });
          
          let analysis;
          try {
            // Usar useTranscript=true para activar el flujo de transcripción
            analysis = await analyzeUrlContent(url, true);
            logger.info('Procesamiento', `Análisis con transcripción completado exitosamente`, { url });
          } catch (analysisError: any) {
            logger.error('Procesamiento', `Error en análisis de Gemini con transcripción`, {
              url,
              error: analysisError.message,
              stack: analysisError.stack,
              errorName: analysisError.name
            });
            throw new Error(`Error en análisis de Gemini: ${analysisError.message || 'Error desconocido en análisis'}`);
          }

          // Check for specific API Key Error returned from service logic
          if (analysis.tematica === "Error Cuota API") {
              const errorMsg = "Tu API Key ha excedido la cuota gratuita (429). Espera un minuto o revisa tu plan.";
              logger.error('Procesamiento', `Error de cuota API`, { url });
              setErrorMsg(errorMsg);
              setStatus(ProcessingStatus.ERROR);
              break;
          }
          
          if (analysis.tematica === "Error en Análisis") {
              const errorMsg = `Error analizando ${url}: ${analysis.contenido_resumido}`;
              logger.error('Procesamiento', errorMsg, { url });
              processingErrors.push(errorMsg);
              setProgress({ current: i + 1, total: youtubeUrls.length });
              continue;
          }

          // Create analyzed email object
          logger.info('Procesamiento', `Creando objeto analizado`, { url });
          
          const validatedEtiquetas = Array.isArray(analysis.etiquetas) 
            ? analysis.etiquetas.filter((tag: any) => typeof tag === 'string' && tag.trim().length > 0)
            : [];
          
          const validatedUrls = Array.isArray(analysis.urls)
            ? analysis.urls.filter((urlItem: any) => typeof urlItem === 'string' && urlItem.trim().length > 0)
            : [];
          
          const validatedTematica = analysis.tematica && typeof analysis.tematica === 'string' 
            ? analysis.tematica.trim() 
            : 'Sin clasificar';
          
          const contenidoResumido = analysis.contenido_resumido && typeof analysis.contenido_resumido === 'string'
            ? analysis.contenido_resumido.trim()
            : `<p>Video de YouTube: <a href="${url}">${url}</a></p>`;
          
          // Usar la fecha-hora actual del momento de procesamiento
          const validatedFecha = new Date().toISOString().slice(0, 19).replace('T', ' ');
          
          // Usar la URL como fileName para mantener consistencia con la BD
          const analyzedEmail: AnalyzedEmail = {
            id: uuidv4(),
            fileName: url, // Usar URL como identificador
            fechaEnvio: validatedFecha,
            tematica: validatedTematica,
            etiquetas: validatedEtiquetas,
            contenido: contenidoResumido,
            urls: validatedUrls,
            status: 'completed'
          };

          logger.debug('Procesamiento', `Objeto analizado creado`, {
            url,
            tematica: validatedTematica,
            etiquetasCount: validatedEtiquetas.length,
            urlsCount: validatedUrls.length,
            contenidoLength: contenidoResumido.length
          });

          results.push(analyzedEmail);
          logger.info('Procesamiento', `Video procesado exitosamente`, { url, urlNumber, total: youtubeUrls.length });
          
          // Save immediately to DB and update UI in real-time
          try {
            await saveToDb([analyzedEmail]);
            const allEmails = await getAllEmails();
            setProcessedEmails(allEmails);
            logger.debug('Procesamiento', `Video guardado y UI actualizada`, { url });
          } catch (saveError: any) {
            logger.error('Procesamiento', `Error guardando video individual`, {
              url,
              error: saveError.message
            });
          }
          
        } catch (urlError: any) {
          const errorMsg = `Error procesando ${url}: ${urlError.message || 'Error desconocido'}`;
          logger.error('Procesamiento', `Error procesando video`, {
            url,
            errorName: urlError.name,
            errorMessage: urlError.message,
            stack: urlError.stack
          });
          processingErrors.push(errorMsg);
          
          // Create error entry for this video
          const errorEmail: AnalyzedEmail = {
            id: uuidv4(),
            fileName: url,
            fechaEnvio: new Date().toISOString(),
            tematica: "Error en Análisis",
            etiquetas: ["Error"],
            contenido: `Error procesando video: ${urlError.message || 'No se pudo analizar el contenido'}. Revisa la consola (F12) para más detalles.`,
            urls: [url],
            status: 'error',
            errorMessage: urlError.message || 'Error desconocido'
          };
          
          results.push(errorEmail);
          
          // Save error entry immediately to DB
          try {
            await saveToDb([errorEmail]);
            const allEmails = await getAllEmails();
            setProcessedEmails(allEmails);
          } catch (saveError: any) {
            logger.error('Procesamiento', `Error guardando video con error`, {
              url,
              error: saveError.message
            });
          }
          
          setErrorMsg(`Error en ${url}. ${processingErrors.length} error(es) hasta ahora. Revisa la consola (F12) para detalles.`);
        }
        
        setProgress({ current: i + 1, total: youtubeUrls.length, currentUrl: i + 1 < youtubeUrls.length ? youtubeUrls[i + 1] : undefined });
      }
      
      // All videos have been saved individually
      logger.info('Procesamiento', `Procesamiento completado. ${results.length} video(s) procesado(s) y guardado(s) individualmente`);
      
      if (processingErrors.length > 0) {
        logger.warn('Procesamiento', `Resumen de errores`, { errorCount: processingErrors.length, errors: processingErrors });
      } else {
        logger.info('Procesamiento', `Todos los videos procesados exitosamente`, { totalProcessed: results.length });
        setErrorMsg(null);
      }
      
      if (status !== ProcessingStatus.ERROR && !isProcessingCancelled.current) {
        setStatus(ProcessingStatus.COMPLETED);
        setYoutubeUrls([]); // Clear queue
        setProgress({ current: 0, total: 0 });
        if (processingErrors.length === 0) {
          setErrorMsg(null);
        } else {
          setErrorMsg(`${results.length} video(s) procesado(s). ${processingErrors.length} error(es) - descarga los logs para detalles.`);
        }
      }
      
      isProcessingCancelled.current = false;

    } catch (err: any) {
      logger.error('Procesamiento', 'Error crítico en procesamiento de videos YouTube', {
        error: err.message,
        stack: err.stack,
        errorName: err.name,
        videosProcessed: results.length,
        totalVideos: youtubeUrls.length
      });
      setStatus(ProcessingStatus.ERROR);
      const msg = err.message || "Ocurrió un error crítico.";
      setErrorMsg(msg.includes("API Key") ? msg : `Error procesando videos. ${results.length} procesado(s). Descarga los logs para detalles.`);
    }
  };

  const handleReset = async () => {
      if(confirm("¿Estás seguro de que quieres borrar toda la base de datos?")) {
          await resetDb();
          setProcessedEmails([]);
          setFilterTopics([]);
          setFilterTags([]);
      }
  }

  const downloadDb = async () => {
    try {
      // Usar exportDbAndSaveToBd para guardar automáticamente en carpeta bd
      const uInt8Array = await exportDbAndSaveToBd();
      const blob = new Blob([uInt8Array], { type: 'application/x-sqlite3' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `email_intelligence_${new Date().toISOString().slice(0,10)}.sqlite`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Error exporting DB", e);
      alert("Error exportando la base de datos.");
    }
  };

  const handleImportDb = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.sqlite')) {
      setErrorMsg("Por favor, selecciona un archivo .sqlite válido.");
      return;
    }

    try {
      setStatus(ProcessingStatus.GENERATING_DB);
      setErrorMsg(null);
      
      const result = await importDb(file);
      
      // Reload emails from DB
      const allEmails = await getAllEmails();
      setProcessedEmails(allEmails);
      
      setStatus(ProcessingStatus.COMPLETED);
      
      // Build message with details
      let message = `Importación completada: ${result.imported} email(s) importado(s)`;
      if (result.skipped > 0) {
        message += `, ${result.skipped} omitido(s)`;
      }
      
      // Add errors if any
      if (result.errors && result.errors.length > 0) {
        message += `. ${result.errors.length} error(es) detectado(s) - revisa la consola para detalles.`;
        console.error("Errores de importación:", result.errors);
      }
      
      setErrorMsg(message);
      
      // Reset file input
      event.target.value = '';
    } catch (err: any) {
      console.error("Error importing DB", err);
      setStatus(ProcessingStatus.ERROR);
      setErrorMsg(`Error importando base de datos: ${err.message || "Error desconocido"}`);
    }
  };

  // --- Filtering Logic ---
  
  const uniqueTopics = useMemo(() => {
    const topics = new Set(processedEmails.map(e => e.tematica).filter(Boolean));
    return Array.from(topics).sort();
  }, [processedEmails]);

  const uniqueTags = useMemo(() => {
    const tags = new Set(processedEmails.flatMap(e => e.etiquetas).filter(Boolean));
    return Array.from(tags).sort();
  }, [processedEmails]);

  const filteredEmails = useMemo(() => {
    let filtered = processedEmails.filter(email => {
      const matchTopic = filterTopics.length > 0 ? filterTopics.includes(email.tematica) : true;
      const matchTag = filterTags.length > 0 ? email.etiquetas.some(tag => filterTags.includes(tag)) : true;
      return matchTopic && matchTag;
    });

    // Aplicar ordenamiento si hay una columna seleccionada
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let comparison = 0;
        
        if (sortColumn === 'fecha') {
          // Comparar fechas (formato: YYYY-MM-DD HH:mm:ss)
          const dateA = new Date(a.fechaEnvio).getTime();
          const dateB = new Date(b.fechaEnvio).getTime();
          comparison = dateA - dateB;
        } else if (sortColumn === 'tematica') {
          // Comparar temáticas alfabéticamente
          comparison = a.tematica.localeCompare(b.tematica, 'es', { sensitivity: 'base' });
        }
        
        // Aplicar dirección de ordenamiento
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return filtered;
  }, [processedEmails, filterTopics, filterTags, sortColumn, sortDirection]);

  // Limpiar selección cuando cambian los filtros (mantener solo los IDs que siguen visibles)
  useEffect(() => {
    const visibleIds = new Set(filteredEmails.map(email => email.id));
    setSelectedIds(prev => {
      const newSet = new Set<string>();
      prev.forEach(id => {
        if (visibleIds.has(id)) {
          newSet.add(id);
        }
      });
      return newSet;
    });
  }, [filteredEmails]);

  // Toggle functions for multi-select filters
  const toggleTopic = (topic: string) => {
    setFilterTopics(prev => 
      prev.includes(topic) 
        ? prev.filter(t => t !== topic)
        : [...prev, topic]
    );
  };

  const toggleTag = (tag: string) => {
    setFilterTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  // Selection functions
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredEmails.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEmails.map(email => email.id)));
    }
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Sorting functions
  const handleSort = (column: 'fecha' | 'tematica') => {
    if (sortColumn === column) {
      // Si ya está ordenando por esta columna, cambiar dirección
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // Si es una nueva columna, establecerla y dirección ascendente por defecto
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    
    const count = selectedIds.size;
    const confirmMessage = `¿Estás seguro de que quieres eliminar ${count} registro(s) seleccionado(s)? Esta acción no se puede deshacer.`;
    
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      const idsToDelete = Array.from(selectedIds) as string[];
      await deleteRecords(idsToDelete);
      
      // Reload data from DB
      const allEmails = await getAllEmails();
      setProcessedEmails(allEmails);
      
      // Clear selection
      setSelectedIds(new Set());
      
      logger.info('App', `Eliminados ${count} registro(s) exitosamente`);
      setErrorMsg(null);
    } catch (error: any) {
      logger.error('App', 'Error eliminando registros', { error: error.message });
      setErrorMsg(`Error eliminando registros: ${error.message}`);
    }
  };

  const handleDeleteSingle = async (id: string, fileName: string) => {
    const confirmMessage = `¿Estás seguro de que quieres eliminar este registro?\n\n${fileName}\n\nEsta acción no se puede deshacer.`;
    
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      await deleteRecords([id]);
      
      // Reload data from DB
      const allEmails = await getAllEmails();
      setProcessedEmails(allEmails);
      
      // Remove from selection if it was selected
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
      
      logger.info('App', `Registro eliminado exitosamente`, { id, fileName });
      setErrorMsg(null);
    } catch (error: any) {
      logger.error('App', 'Error eliminando registro', { id, fileName, error: error.message });
      setErrorMsg(`Error eliminando registro: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans selection:bg-cyan-500/30">
      
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
        <div className="w-[96%] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-100 to-slate-400">
              AI Links
            </h1>
          </div>
          <div className="flex gap-2 items-center">
             <label className="text-xs text-blue-400 hover:text-blue-300 px-3 py-1 border border-blue-900/50 rounded-lg hover:bg-blue-900/20 transition-colors cursor-pointer">
                 <input 
                   type="file" 
                   accept=".sqlite" 
                   onChange={handleImportDb}
                   className="hidden"
                   disabled={status === ProcessingStatus.PARSING || status === ProcessingStatus.ANALYZING || status === ProcessingStatus.GENERATING_DB}
                 />
                 Importar BD
             </label>
             
             <button
               onClick={downloadDb}
               className="text-xs text-emerald-400 hover:text-emerald-300 px-3 py-1 border border-emerald-900/50 rounded-lg hover:bg-emerald-900/20 transition-colors"
             >
               Descargar BD
             </button>
             
             <button 
               onClick={downloadLogs}
               className="text-xs text-yellow-400 hover:text-yellow-300 px-3 py-1 border border-yellow-900/50 rounded-lg hover:bg-yellow-900/20 transition-colors"
               title={`Descargar logs (${logger.getErrorCount()} error(es))`}
             >
                 📋 Logs {logger.getErrorCount() > 0 && `(${logger.getErrorCount()})`}
             </button>
             
             <button onClick={handleReset} className="text-xs text-red-400 hover:text-red-300 px-3 py-1 border border-red-900/50 rounded-lg hover:bg-red-900/20 transition-colors">
                 Reset DB
             </button>
             
             {/* API Status Indicator */}
             <div 
               title={isApiKeyValid ? "API Key detectada en variables de entorno" : "API Key NO encontrada"}
               className={`flex items-center gap-2 text-xs font-mono border px-3 py-1 rounded-full transition-colors ${
                 isApiKeyValid 
                  ? 'border-emerald-900/50 text-emerald-400 bg-emerald-900/10' 
                  : 'border-red-900/50 text-red-400 bg-red-900/10'
               }`}
             >
                <span className={`h-2 w-2 rounded-full shadow-[0_0_8px_currentColor] ${isApiKeyValid ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`}></span>
                {isApiKeyValid ? 'API Ready' : 'No API Key'}
             </div>

             <div className="hidden sm:block text-xs font-mono text-slate-500 border border-slate-800 px-3 py-1 rounded-full">
                Gemini 2.5 Flash
             </div>
          </div>
        </div>
      </header>

      <main className="w-[96%] mx-auto px-6 py-10 space-y-8">
        
        {/* API Key Missing Guide */}
        {!isApiKeyValid && (
          <div className="w-[96%] max-w-3xl mx-auto bg-amber-900/10 border border-amber-600/30 rounded-xl p-6 text-amber-200 shadow-lg">
            <div className="flex items-start gap-4">
               <div className="bg-amber-500/20 p-2 rounded-full">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                 </svg>
               </div>
               <div>
                  <h3 className="text-lg font-bold mb-2">Configuración requerida</h3>
                  <p className="text-sm mb-3">La aplicación no detecta tu <code className="font-mono text-amber-400">API_KEY</code>.</p>
                  <div className="text-sm space-y-3 text-amber-100/80">
                      <p>
                        Asegúrate de que la variable de entorno <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-amber-400">API_KEY</code> está definida al iniciar la aplicación.
                      </p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>
                          Si usas <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-amber-400">.env</code> (estándar), asegúrate de que existe en la raíz.
                        </li>
                        <li>
                          Si usas <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-amber-400">2.env</code>, se recomienda renombrarlo a <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-amber-400">.env</code> para asegurar compatibilidad.
                        </li>
                      </ul>
                      <p className="font-semibold text-xs mt-2 text-amber-500">
                        * Recuerda reiniciar el servidor de desarrollo tras crear o renombrar el fichero.
                      </p>
                  </div>
               </div>
            </div>
          </div>
        )}

        {/* Hero / Instructions */}
        {isApiKeyValid && (
            <div className="text-center space-y-4 w-[96%] max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-white tracking-tight">
                Organiza tus enlaces con <span className="text-cyan-400">Inteligencia Artificial</span>
            </h2>
            <p className="text-slate-400">
                Procesa ficheros <code className="bg-slate-800 px-1.5 py-0.5 rounded text-cyan-200 text-sm">.eml</code>, 
                añade <code className="bg-slate-800 px-1.5 py-0.5 rounded text-purple-200 text-sm">URLs directamente</code> o 
                categoriza <code className="bg-slate-800 px-1.5 py-0.5 rounded text-red-200 text-sm">videos de YouTube</code>. 
                Nuestra IA analizará y categorizará el contenido usando tu API Key segura.
            </p>
            </div>
        )}

        {/* Upload Section - Tabs */}
        <div className="w-[96%] max-w-4xl mx-auto">
          {/* Tabs Navigation */}
          <div className="flex border-b border-slate-700 mb-6">
            <button
              onClick={() => setActiveTab('eml')}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setActiveTab('eml');
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setActiveTab('eml');
              }}
              className={`flex-1 px-6 py-4 text-sm font-medium transition-all duration-200 relative group ${
                activeTab === 'eml'
                  ? 'text-cyan-400 border-b-2 border-cyan-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-colors ${activeTab === 'eml' ? 'text-cyan-400' : 'text-slate-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span>Archivos .eml</span>
                {files.length > 0 && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    activeTab === 'eml' ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {files.length}
                  </span>
                )}
              </div>
            </button>
            
            <button
              onClick={() => setActiveTab('urls')}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setActiveTab('urls');
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setActiveTab('urls');
              }}
              className={`flex-1 px-6 py-4 text-sm font-medium transition-all duration-200 relative group ${
                activeTab === 'urls'
                  ? 'text-purple-400 border-b-2 border-purple-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-colors ${activeTab === 'urls' ? 'text-purple-400' : 'text-slate-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span>Enlaces Directos</span>
                {urls.length > 0 && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    activeTab === 'urls' ? 'bg-purple-500/20 text-purple-300' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {urls.length}
                  </span>
                )}
              </div>
            </button>
            
            <button
              onClick={() => setActiveTab('youtube')}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setActiveTab('youtube');
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setActiveTab('youtube');
              }}
              className={`flex-1 px-6 py-4 text-sm font-medium transition-all duration-200 relative group ${
                activeTab === 'youtube'
                  ? 'text-red-400 border-b-2 border-red-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-colors ${activeTab === 'youtube' ? 'text-red-400' : 'text-slate-500'}`} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                <span>Videos de YouTube</span>
                {youtubeUrls.length > 0 && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    activeTab === 'youtube' ? 'bg-red-500/20 text-red-300' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {youtubeUrls.length}
                  </span>
                )}
              </div>
            </button>
          </div>

          {/* Tab Content */}
          <div className="min-h-[400px]">
            {/* EML Tab */}
            {activeTab === 'eml' && (
              <div className="space-y-4 opacity-100 transition-opacity duration-300">
                <Dropzone 
                  onFilesDropped={handleFilesDropped} 
                  disabled={!isApiKeyValid || status === ProcessingStatus.PARSING || status === ProcessingStatus.ANALYZING || status === ProcessingStatus.GENERATING_DB}
                />
                
                {files.length > 0 && status === ProcessingStatus.IDLE && (
                  <div className="flex flex-col items-center animate-fade-in-up">
                    <p className="text-sm text-slate-400 mb-3">
                      {files.length} fichero(s) listo(s) para procesar
                    </p>
                    <button
                      onClick={processFiles}
                      disabled={!isApiKeyValid}
                      className={`group relative inline-flex h-10 items-center justify-center overflow-hidden rounded-md px-6 font-medium text-white transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900
                          ${isApiKeyValid 
                              ? 'bg-cyan-600 hover:bg-cyan-500 hover:shadow-[0_0_20px_rgba(6,182,212,0.4)] focus:ring-cyan-400' 
                              : 'bg-slate-700 cursor-not-allowed opacity-50'}
                      `}
                    >
                      <span className="mr-2 text-sm">{isApiKeyValid ? 'Procesar Archivos' : 'Configura tu API Key'}</span>
                      {isApiKeyValid && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* URLs Tab */}
            {activeTab === 'urls' && (
              <div className="space-y-4 opacity-100 transition-opacity duration-300">
                <UrlDropzone 
                  onUrlsDropped={handleUrlsDropped} 
                  disabled={!isApiKeyValid || status === ProcessingStatus.PARSING || status === ProcessingStatus.ANALYZING || status === ProcessingStatus.GENERATING_DB}
                />
                
                {urls.length > 0 && status === ProcessingStatus.IDLE && (
                  <div className="flex flex-col items-center animate-fade-in-up">
                    <p className="text-sm text-slate-400 mb-3">
                      {urls.length} enlace(s) listo(s) para procesar
                    </p>
                    <button
                      onClick={processUrls}
                      disabled={!isApiKeyValid}
                      className={`group relative inline-flex h-10 items-center justify-center overflow-hidden rounded-md px-6 font-medium text-white transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900
                          ${isApiKeyValid 
                              ? 'bg-purple-600 hover:bg-purple-500 hover:shadow-[0_0_20px_rgba(192,132,252,0.4)] focus:ring-purple-400' 
                              : 'bg-slate-700 cursor-not-allowed opacity-50'}
                      `}
                    >
                      <span className="mr-2 text-sm">{isApiKeyValid ? 'Procesar URLs' : 'Configura tu API Key'}</span>
                      {isApiKeyValid && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* YouTube Tab */}
            {activeTab === 'youtube' && (
              <div className="space-y-4 opacity-100 transition-opacity duration-300">
                <YouTubeDropzone 
                  onUrlsDropped={handleYouTubeUrlsDropped} 
                  disabled={!isApiKeyValid || status === ProcessingStatus.PARSING || status === ProcessingStatus.ANALYZING || status === ProcessingStatus.GENERATING_DB}
                />
                
                {youtubeUrls.length > 0 && status === ProcessingStatus.IDLE && (
                  <div className="flex flex-col items-center animate-fade-in-up">
                    <p className="text-sm text-slate-400 mb-3">
                      {youtubeUrls.length} video(s) listo(s) para procesar
                    </p>
                    <button
                      onClick={processYouTubeUrls}
                      disabled={!isApiKeyValid}
                      className={`group relative inline-flex h-10 items-center justify-center overflow-hidden rounded-md px-6 font-medium text-white transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900
                          ${isApiKeyValid 
                              ? 'bg-red-600 hover:bg-red-500 hover:shadow-[0_0_20px_rgba(239,68,68,0.4)] focus:ring-red-400' 
                              : 'bg-slate-700 cursor-not-allowed opacity-50'}
                      `}
                    >
                      <span className="mr-2 text-sm">{isApiKeyValid ? 'Procesar Videos' : 'Configura tu API Key'}</span>
                      {isApiKeyValid && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Progress Section */}
        {(status !== ProcessingStatus.IDLE && status !== ProcessingStatus.COMPLETED && status !== ProcessingStatus.ERROR) && (
           <div className="w-[96%] max-w-2xl mx-auto bg-slate-800/50 rounded-xl p-6 border border-slate-700">
             <div className="flex justify-between items-end mb-2">
                <span className="text-sm font-medium text-cyan-400 animate-pulse">
                  {status === ProcessingStatus.PARSING && "📄 Leyendo fichero..."}
                  {status === ProcessingStatus.ANALYZING && "🤖 IA Analizando contenido..."}
                  {status === ProcessingStatus.GENERATING_DB && "💾 Generando SQLite..."}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  {progress.current} / {progress.total}
                </span>
             </div>
             {(progress.currentFile || progress.currentUrl) && (
               <div className="mb-2">
                 {progress.currentFile && (
                   <p className="text-xs text-slate-400 font-mono truncate" title={progress.currentFile}>
                     Archivo: {progress.currentFile}
                   </p>
                 )}
                 {progress.currentUrl && (
                   <p className="text-xs text-slate-400 font-mono truncate" title={progress.currentUrl}>
                     URL: {progress.currentUrl}
                   </p>
                 )}
               </div>
             )}
             <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
                <div 
                  className="bg-cyan-500 h-2.5 rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(6,182,212,0.6)]" 
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                ></div>
             </div>
             <div className="mt-4 flex justify-center">
               <button
                 onClick={stopProcessing}
                 className="inline-flex items-center px-4 py-2 text-sm font-medium text-red-400 bg-red-900/20 border border-red-900/50 rounded-lg hover:bg-red-900/30 transition-colors"
               >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                 </svg>
                 Detener Procesamiento
               </button>
             </div>
             <div className="mt-3 space-y-1">
               <p className="text-xs text-slate-500 text-center text-amber-500/80">
                 Pausando 15s entre ficheros para proteger límites de API Free Tier...
               </p>
               <p className="text-xs text-slate-600 text-center">
                 Revisa la consola del navegador (F12) para ver logs detallados
               </p>
             </div>
           </div>
        )}

        {/* Error Message */}
        {errorMsg && status === ProcessingStatus.ERROR && (
          <div className="w-[96%] max-w-2xl mx-auto p-4 bg-red-900/20 border border-red-800 rounded-lg text-red-200 text-center text-sm">
            <p className="font-bold mb-1">Error de Proceso</p>
            {errorMsg}
          </div>
        )}
        
        {/* Success/Info Message - Only show if completed and has message */}
        {errorMsg && status === ProcessingStatus.COMPLETED && (
          <div className="w-[96%] max-w-2xl mx-auto p-4 bg-blue-900/20 border border-blue-800 rounded-lg text-blue-200 text-center text-sm">
            <p className="font-bold mb-1">Procesamiento Completado</p>
            {errorMsg}
          </div>
        )}
        
        {/* Warning Message - Show if completed with errors */}
        {errorMsg && status === ProcessingStatus.COMPLETED && errorMsg.includes('error(es)') && (
          <div className="w-[96%] max-w-2xl mx-auto p-4 bg-amber-900/20 border border-amber-800 rounded-lg text-amber-200 text-center text-sm">
            <p className="font-bold mb-1">Procesamiento Completado con Advertencias</p>
            {errorMsg}
          </div>
        )}

        {/* Results Section */}
        {processedEmails.length > 0 && (
          <div className="w-[96%] mx-auto space-y-4 animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Base de Datos ({filteredEmails.length} / {processedEmails.length})
              </h3>
            </div>

            {/* Filter Bar */}
            <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-700/50 flex flex-wrap gap-4 items-start">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-sm font-medium text-slate-400 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    Filtros:
                  </span>

                  {/* Select All Checkbox */}
                  {filteredEmails.length > 0 && (
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300 hover:text-slate-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === filteredEmails.length && filteredEmails.length > 0}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 text-red-600 bg-slate-800 border-slate-600 rounded focus:ring-red-500 focus:ring-2"
                      />
                      <span>Seleccionar todos ({selectedIds.size})</span>
                    </label>
                  )}

                  {/* Delete Selected Button */}
                  {selectedIds.size > 0 && (
                    <button
                      onClick={handleDeleteSelected}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-400 bg-red-900/20 border border-red-600/50 rounded-lg hover:bg-red-900/30 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Eliminar seleccionados ({selectedIds.size})
                    </button>
                  )}
                </div>

                {/* Temáticas Multi-select */}
                <div className="relative filter-dropdown">
                  <button
                    onClick={() => {
                      setShowTopicDropdown(!showTopicDropdown);
                      setShowTagDropdown(false);
                    }}
                    className={`bg-slate-900 border border-slate-700 text-slate-200 text-xs sm:text-sm rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 outline-none flex items-center gap-2 min-w-[200px] ${
                      filterTopics.length > 0 ? 'border-cyan-600' : ''
                    }`}
                  >
                    <span className="flex-1 text-left">
                      {filterTopics.length === 0 
                        ? 'Todas las temáticas' 
                        : filterTopics.length === 1 
                          ? filterTopics[0]
                          : `${filterTopics.length} temáticas seleccionadas`}
                    </span>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform ${showTopicDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {showTopicDropdown && (
                    <div className="absolute z-50 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto min-w-[200px]">
                      {/* Opción "Todas las temáticas" siempre en primera posición */}
                      <label
                        className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800 cursor-pointer text-sm text-slate-200 border-b border-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={filterTopics.length === 0}
                          onChange={() => setFilterTopics([])}
                          className="w-4 h-4 text-cyan-600 bg-slate-800 border-slate-600 rounded focus:ring-cyan-500 focus:ring-2"
                        />
                        <span className="flex-1 font-medium text-cyan-300">Todas las temáticas</span>
                        {filterTopics.length === 0 && (
                          <span className="text-cyan-400 text-xs">✓</span>
                        )}
                      </label>
                      
                      {uniqueTopics.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-slate-400">No hay temáticas disponibles</div>
                      ) : (
                        uniqueTopics.map(topic => (
                          <label
                            key={topic}
                            className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800 cursor-pointer text-sm text-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={filterTopics.includes(topic)}
                              onChange={() => toggleTopic(topic)}
                              className="w-4 h-4 text-cyan-600 bg-slate-800 border-slate-600 rounded focus:ring-cyan-500 focus:ring-2"
                            />
                            <span className="flex-1">{topic}</span>
                            {filterTopics.includes(topic) && (
                              <span className="text-cyan-400 text-xs">✓</span>
                            )}
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Etiquetas Multi-select */}
                <div className="relative filter-dropdown">
                  <button
                    onClick={() => {
                      setShowTagDropdown(!showTagDropdown);
                      setShowTopicDropdown(false);
                    }}
                    className={`bg-slate-900 border border-slate-700 text-slate-200 text-xs sm:text-sm rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 outline-none flex items-center gap-2 min-w-[200px] ${
                      filterTags.length > 0 ? 'border-cyan-600' : ''
                    }`}
                  >
                    <span className="flex-1 text-left">
                      {filterTags.length === 0 
                        ? 'Todas las etiquetas' 
                        : filterTags.length === 1 
                          ? filterTags[0]
                          : `${filterTags.length} etiquetas seleccionadas`}
                    </span>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform ${showTagDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {showTagDropdown && (
                    <div className="absolute z-50 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto min-w-[200px]">
                      {/* Opción "Todas las etiquetas" siempre en primera posición */}
                      <label
                        className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800 cursor-pointer text-sm text-slate-200 border-b border-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={filterTags.length === 0}
                          onChange={() => setFilterTags([])}
                          className="w-4 h-4 text-cyan-600 bg-slate-800 border-slate-600 rounded focus:ring-cyan-500 focus:ring-2"
                        />
                        <span className="flex-1 font-medium text-cyan-300">Todas las etiquetas</span>
                        {filterTags.length === 0 && (
                          <span className="text-cyan-400 text-xs">✓</span>
                        )}
                      </label>
                      
                      {uniqueTags.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-slate-400">No hay etiquetas disponibles</div>
                      ) : (
                        uniqueTags.map(tag => (
                          <label
                            key={tag}
                            className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800 cursor-pointer text-sm text-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={filterTags.includes(tag)}
                              onChange={() => toggleTag(tag)}
                              className="w-4 h-4 text-cyan-600 bg-slate-800 border-slate-600 rounded focus:ring-cyan-500 focus:ring-2"
                            />
                            <span className="flex-1">{tag}</span>
                            {filterTags.includes(tag) && (
                              <span className="text-cyan-400 text-xs">✓</span>
                            )}
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {(filterTopics.length > 0 || filterTags.length > 0) && (
                   <button 
                      onClick={() => { 
                        setFilterTopics([]); 
                        setFilterTags([]);
                        setShowTopicDropdown(false);
                        setShowTagDropdown(false);
                      }}
                      className="text-xs text-cyan-400 hover:text-cyan-300 ml-auto hover:underline flex items-center gap-1"
                   >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Limpiar filtros
                   </button>
                )}
            </div>
            
            <ResultsTable 
              emails={filteredEmails}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelectId}
              onDelete={handleDeleteSingle}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
          </div>
        )}

      </main>
    </div>
  );
};

export default App;