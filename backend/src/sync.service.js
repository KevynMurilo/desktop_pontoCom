import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import db from './db.js';
import { fileURLToPath } from 'url';

// 🔧 Configurações
const API_PREFEITURA = 'http://localhost:8082/api/timerecord';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🟡 Log inicial para debug
console.log('🟡 sync.service.js carregado');

export async function enviarRegistrosPendentes() {
  db.all(
    'SELECT * FROM registros WHERE enviado = 0 ORDER BY created_at ASC LIMIT 5',
    async (err, registros) => {
      if (err) {
        console.error('❌ Erro ao buscar registros pendentes:', err.message);
        return;
      }

      if (!registros || registros.length === 0) {
        console.log('📭 Nenhum registro pendente para sincronizar.');
        return;
      }

      for (const registro of registros) {
        console.log(`🔁 Tentando enviar registro ID ${registro.id}`);

        try {
          if (!fs.existsSync(registro.imagemPath)) {
            console.warn(`⚠️ Imagem não encontrada para ID ${registro.id}: ${registro.imagemPath}`);
            continue;
          }

          const form = new FormData();
          form.append('cpf', registro.cpf);
          form.append('latitude', registro.latitude);
          form.append('longitude', registro.longitude);
          form.append('deviceIdentifier', registro.deviceIdentifier);
          form.append('imagem', fs.createReadStream(registro.imagemPath));
          form.append('createdAt', registro.created_at);

          const response = await axios.post(API_PREFEITURA, form, {
            headers: form.getHeaders()
          });

          // ✅ Se sucesso (status 200–299)
          if (response.status >= 200 && response.status < 300) {
            db.run('UPDATE registros SET enviado = 1 WHERE id = ?', [registro.id]);
            console.log(`✅ Registro ID ${registro.id} enviado com sucesso.`);
          } else {
            console.error(`❌ Falha no envio do registro ID ${registro.id}. Status: ${response.status}`);
          }
        } catch (e) {
          console.error(`❌ Erro ao enviar ID ${registro.id}: ${e.message}`);
        }
      }
    }
  );
}

// 🧠 Execução automática se chamado diretamente (usando process.argv[1])
if (process.argv[1]?.endsWith('sync.service.js')) {
  console.log('⏳ Serviço de sincronização iniciado em modo automático (intervalo de 10s)');

  setInterval(() => {
    console.log('🔄 Executando sincronização automática...');
    enviarRegistrosPendentes();
  }, 10000);
}
