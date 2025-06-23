import { Component, Input, Output, EventEmitter, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-configuracoes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './configuracoes.component.html'
})
export class ConfiguracoesComponent implements OnChanges {
  @Input() deviceIdentifier: string = '';
  @Input() dispositivosVideo: MediaDeviceInfo[] = [];
  @Input() dispositivoSelecionadoId: string | null = null;
  @Input() modoEscuro: boolean = false;

  @Output() fechar = new EventEmitter<void>();
  @Output() selecionarDispositivo = new EventEmitter<string>();

  dispositivoSelecionadoIdInterno: string | null = null;

  ngOnChanges(): void {
    this.dispositivoSelecionadoIdInterno = this.dispositivoSelecionadoId;
  }

  emitirMudancaCamera(deviceId: string) {
    this.selecionarDispositivo.emit(deviceId);
  }

  obterNomeCameraAtiva(): string {
    const atual = this.dispositivosVideo.find(d => d.deviceId === this.dispositivoSelecionadoIdInterno);
    return atual?.label || 'Desconhecida';
  }

  copiarCodigo() {
    const texto = this.deviceIdentifier;

    if (!texto) return;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(texto)
        .then(() => alert('✅ Código copiado!'))
        .catch(err => {
          console.warn('⚠️ Clipboard API falhou. Usando fallback.', err);
          this.fallbackCopiar(texto);
        });
    } else {
      this.fallbackCopiar(texto);
    }
  }

  fallbackCopiar(texto: string) {
    const temp = document.createElement('textarea');
    temp.value = texto;
    temp.style.position = 'fixed';
    temp.style.opacity = '0';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();

    try {
      const sucesso = document.execCommand('copy');
      alert(sucesso ? '✅ Código copiado!' : '❌ Não foi possível copiar.');
    } catch (err) {
      console.error('❌ Falha ao copiar (fallback):', err);
      alert('❌ Erro ao copiar o código.');
    }

    document.body.removeChild(temp);
  }
}
