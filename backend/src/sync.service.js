import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import db from './db.js';
import { fileURLToPath } from 'url';

const API_PREFEITURA = 'http://10.1.59.59:8082/api/timerecord';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🟡 sync.service.js carregado');

export async function enviarRegistrosPendentes() {
  db.all(
    `SELECT * FROM registros 
     WHERE enviado = 0 
       AND erro_definitivo = 0 
       AND (tentativas IS NULL OR tentativas < 3)
       AND (
         ultima_tentativa IS NULL OR 
         strftime('%s','now') - strftime('%s', ultima_tentativa) >= 21600
       )
     ORDER BY created_at ASC LIMIT 5`,
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

          if (response.status >= 200 && response.status < 300) {
            db.run('UPDATE registros SET enviado = 1 WHERE id = ?', [registro.id]);
            console.log(`✅ Registro ID ${registro.id} enviado com sucesso.`);
          } else {
            const mensagem = response.data?.message || response.statusText;
            console.error(`❌ Falha no envio do registro ID ${registro.id}. Status: ${response.status} - ${mensagem}`);
            tratarErroEnvio(registro.id, response.status, mensagem);
          }

        } catch (e) {
          const status = e.response?.status;
          const mensagem = e.response?.data?.message || e.response?.statusText || e.message;

          if (e.response) {
            console.error(`❌ Erro ao enviar ID ${registro.id}: ${mensagem} (status: ${status})`);
            tratarErroEnvio(registro.id, status, mensagem);
          } else {
            console.warn(`🌐 Backend indisponível ao enviar ID ${registro.id}: ${e.message}`);
            // Não incrementa tentativas
          }
        }
      }
    }
  );
}

function tratarErroEnvio(id, status, mensagem) {
  const agora = new Date().toISOString();
  let erroDefinitivo = 0;
  const ERROS_PERMANENTES = [403, 404, 409];

  if (ERROS_PERMANENTES.includes(status)) {
    erroDefinitivo = 1;
    console.warn(`🚫 Erro permanente (status ${status}) para ID ${id}: ${mensagem}`);
  }

  db.run(`
    UPDATE registros 
    SET 
      tentativas = COALESCE(tentativas, 0) + 1,
      ultima_tentativa = ?,
      erro_mensagem = ?,
      erro_definitivo = ?
    WHERE id = ?
  `, [agora, mensagem, erroDefinitivo, id]);

  // Segurança extra: se passou de 1 dia, ignorar
  db.get(`SELECT created_at FROM registros WHERE id = ?`, [id], (err, row) => {
    if (!err && row?.created_at) {
      const criado = new Date(row.created_at);
      const horas = (Date.now() - criado.getTime()) / (1000 * 60 * 60);
      if (horas >= 24) {
        db.run(`UPDATE registros SET erro_definitivo = 1 WHERE id = ?`, [id]);
        console.warn(`🛑 Registro ID ${id} desativado após 1 dia de tentativas.`);
      }
    }
  });
}

// ⏳ Execução automática
if (process.argv[1]?.endsWith('sync.service.js')) {
  console.log('⏳ Serviço de sincronização iniciado em modo automático (intervalo de 10s)');
  setInterval(() => {
    console.log('🔄 Executando sincronização automática...');
    enviarRegistrosPendentes();
  }, 10000);
}

/*
  LOGICA
  Erros como 403/404/409 nunca mais serão reenviados.
  Depois de 24h, qualquer registro ainda com erro será ignorado.
  Evita flood, logs excessivos ou desperdício de banda e processamento.
*/ 