import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import db from './db.js';
import { fileURLToPath } from 'url';

const API_PREFEITURA = 'https://webhook-formosago.app.br/pontocom/api/timerecord';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🟡 sync.service.js carregado');

export async function enviarRegistrosPendentes() {
  const agora = new Date();
  const tentativasLimites = [
    0,
    10 * 60 * 1000,
    60 * 60 * 1000,
    3 * 60 * 60 * 1000,
    6 * 60 * 60 * 1000
  ];

  let tentativasRealizadas = 0;

  return new Promise((resolve) => {
    db.all(`
      SELECT * FROM registros 
      WHERE enviado = 0 AND erro_definitivo = 0 AND (tentativas IS NULL OR tentativas < 5)
      ORDER BY created_at ASC
    `, async (err, registros) => {
      if (err || !registros || registros.length === 0) return resolve(0);

      for (const registro of registros) {
        const tentativas = registro.tentativas ?? 0;
        const ultimaTentativa = registro.ultima_tentativa ? new Date(registro.ultima_tentativa) : null;
        const tempoDecorrido = ultimaTentativa ? agora - ultimaTentativa : Infinity;
        const limiteTempo = tentativasLimites[tentativas] ?? Infinity;

        if (tempoDecorrido < limiteTempo) continue;

        tentativasRealizadas++;
        console.log(`🔁 Tentando enviar registro ID ${registro.id} (CPF: ${registro.cpf})`);

        try {
          if (!fs.existsSync(registro.imagemPath)) {
            console.warn(`⚠️ Imagem não encontrada para ID ${registro.id}: ${registro.imagemPath}`);
            marcarComoErroDefinitivo(registro.id, 'Imagem não encontrada localmente');
            continue;
          }

          const form = new FormData();
          form.append('cpf', registro.cpf);
          form.append('latitude', registro.latitude);
          form.append('longitude', registro.longitude);
          form.append('deviceIdentifier', registro.deviceIdentifier);
          form.append('imagem', fs.createReadStream(registro.imagemPath));
          form.append('received', registro.created_at);

          const response = await axios.post(API_PREFEITURA, form, {
            headers: form.getHeaders()
          });

          if (response.status >= 200 && response.status < 300) {
            db.run('UPDATE registros SET enviado = 1 WHERE id = ?', [registro.id]);
            console.log(`✅ Registro ID ${registro.id} enviado com sucesso.`);
          } else {
            const mensagem = response.data?.message || response.statusText;
            tratarErroEnvio(registro.id, tentativas, response.status, mensagem);
          }

        } catch (e) {
          const status = e.response?.status;
          const mensagem = e.response?.data?.message || e.response?.statusText || e.message;

          if (e.response) {
            console.error(`❌ Erro ao enviar ID ${registro.id}: ${mensagem} (status: ${status})`);
            tratarErroEnvio(registro.id, tentativas, status, mensagem);
          } else {
            console.warn(`🌐 Backend indisponível ao enviar ID ${registro.id}: ${e.message}`);
          }
        }
      }

      resolve(tentativasRealizadas);
    });
  });
}

function tratarErroEnvio(id, tentativas, status, mensagem) {
  const agora = new Date().toISOString();
  const ERROS_PERMANENTES = [403, 404, 409];
  const erroDefinitivo = ERROS_PERMANENTES.includes(status) || tentativas + 1 >= 5 ? 1 : 0;

  if (erroDefinitivo) {
    console.warn(`🚫 Erro definitivo para ID ${id} (status: ${status}): ${mensagem}`);
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
}

function marcarComoErroDefinitivo(id, mensagem) {
  const agora = new Date().toISOString();
  db.run(`
    UPDATE registros 
    SET 
      erro_definitivo = 1,
      erro_mensagem = ?,
      ultima_tentativa = ?
    WHERE id = ?
  `, [mensagem, agora, id]);
}

// ✅ Executa sincronização automática a cada 10s se executado diretamente
if (process.argv[1]?.endsWith('sync.service.js')) {
  console.log('⏳ Serviço de sincronização automática iniciado (a cada 10s)');
  setInterval(async () => {
    const tentativas = await enviarRegistrosPendentes();
    if (tentativas > 0) {
      console.log(`🔄 ${tentativas} registro(s) processado(s) na sincronização automática`);
    }
  }, 10000);
}
