import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import db from './db.js';

const API_PREFEITURA = 'http://localhost:8080/api/timerecord';

export async function enviarRegistrosPendentes() {
  db.all(
    'SELECT * FROM registros WHERE enviado = 0 ORDER BY created_at ASC LIMIT 5',
    async (err, registros) => {
      if (err || registros.length === 0) return;

      // AQUI TENHO QUE COLOCAR OQ A API DO SERVIDOR VAI PRECISAR
      for (const registro of registros) {
        try {
          const form = new FormData();
          form.append('cpf', registro.cpf);
          form.append('latitude', registro.latitude);
          form.append('longitude', registro.longitude);
          form.append('deviceIdentifier', registro.deviceIdentifier);
          form.append('imagem', fs.createReadStream(registro.imagemPath));
          form.append('createdAt', registro.created_at); 

          await axios.post(API_PREFEITURA, form, {
            headers: form.getHeaders()
          });

          db.run('UPDATE registros SET enviado = 1 WHERE id = ?', [registro.id]);
          console.log(`✅ Registro ID ${registro.id} enviado`);
        } catch (e) {
          console.error(`❌ Erro ao enviar ID ${registro.id}:`, e.message);
        }
      }
    }
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('⏳ Serviço de sincronização iniciado (intervalo automático)');
  setInterval(enviarRegistrosPendentes, 10000);
}
