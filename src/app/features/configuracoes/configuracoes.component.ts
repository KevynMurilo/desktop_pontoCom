import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-configuracoes',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './configuracoes.component.html'
})
export class ConfiguracoesComponent {
  @Input() deviceIdentifier: string = '';
  @Input() dispositivosVideo: MediaDeviceInfo[] = [];
  @Input() dispositivoSelecionadoId: string | null = null;
  @Input() modoEscuro: boolean = false;

  @Output() fechar = new EventEmitter<void>();
  @Output() selecionarDispositivo = new EventEmitter<string>();
  @Output() sincronizar = new EventEmitter<void>();

  onSelecionarDispositivo(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    this.selecionarDispositivo.emit(selectElement.value);
  }
}
