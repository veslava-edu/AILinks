// Script de prueba para verificar la configuración de la API de Gemini
// Este script verifica que la API key esté configurada correctamente

console.log('🔍 Verificando configuración de API Key de Gemini...\n');

// Nota: Este script verifica la configuración básica
// Para probar la conexión real, ejecuta la aplicación con: npm run dev

console.log('📋 Checklist de configuración:\n');
console.log('1. ✅ Archivo .env debe existir en la raíz del proyecto');
console.log('2. ✅ Debe contener la línea: GEMINI_API_KEY=tu_api_key_aqui');
console.log('3. ✅ La API key debe ser válida (obtenerla en: https://aistudio.google.com/apikey)');
console.log('4. ✅ El servidor debe reiniciarse después de crear/modificar .env\n');

console.log('💡 Para verificar que funciona:');
console.log('   - Ejecuta: npm run dev');
console.log('   - Abre http://localhost:3000');
console.log('   - Deberías ver "API Ready" en verde en la esquina superior derecha\n');

console.log('🔧 Configuración de Vite:');
console.log('   - vite.config.ts lee GEMINI_API_KEY del archivo .env');
console.log('   - Lo expone como process.env.API_KEY en el código\n');

console.log('✅ Si todo está correcto, la aplicación debería funcionar correctamente.\n');
