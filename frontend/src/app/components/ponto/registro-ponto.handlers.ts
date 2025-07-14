import { RegistroPontoViewModel } from './registro-ponto.viewmodel';
import { RegistroPontoCamera } from './registro-ponto.camera';
import { RegistroPontoService } from '../../core/service/registro-ponto.service';
import { ElementRef } from '@angular/core';
import { interval } from 'rxjs';

export class RegistroPontoHandlers {
  private pollingVinculoInterval: any = null;

  constructor(
    private vm: RegistroPontoViewModel,
    private service: RegistroPontoService,
    private camera: RegistroPontoCamera
  ) {}

  async inicializar(cpfInputRef: ElementRef<HTMLInputElement>) {
    this.vm.deviceIdentifier = (window as any).device?.getId?.() || 'desconhecido';

    this.verificarVinculoDispositivo();

    await this.camera.listarDispositivos();

    const salvo = localStorage.getItem('cameraSelecionada');
    if (salvo && this.vm.dispositivosVideo.some(d => d.deviceId === salvo)) {
      this.vm.dispositivoSelecionadoId = salvo;
    } else {
      this.vm.dispositivoSelecionadoId = this.vm.dispositivosVideo[0]?.deviceId || null;
    }

    this.camera.iniciarVideoComPermissao();
    this.verificarStatus();
    this.verificarAvisosPendentes();

    interval(10000).subscribe(() => this.verificarStatus());
    interval(30000).subscribe(() => this.verificarAvisosPendentes());

    this.pollingVinculoInterval = setInterval(() => {
      if (!this.vm.vinculoDispositivo()) {
        this.verificarVinculoDispositivo();
      }
    }, 60000);
  }

  verificarVinculoDispositivo() {
    this.vm.carregandoVinculo.set(true);

    this.service.verificarDispositivo(this.vm.deviceIdentifier).subscribe(info => {
      const vinculo = info ? {
        municipioNome: info.municipalityName,
        secretariaNome: info.departmentName,
        setorNome: info.sectorName
      } : null;

      this.vm.vinculoDispositivo.set(vinculo);
      this.vm.carregandoVinculo.set(false);

      if (vinculo && this.pollingVinculoInterval) {
        clearInterval(this.pollingVinculoInterval);
        this.pollingVinculoInterval = null;
      }
    }, () => {
      this.vm.carregandoVinculo.set(false);
    });
  }

  verificarStatus() {
    this.service.verificarStatus().subscribe({
      next: online => this.vm.statusOnline.set(online),
      error: () => this.vm.statusOnline.set(false)
    });
  }

  verificarAvisosPendentes() {
    this.service.verificarPendentesAntigos().subscribe({
      next: total => {
        if (total > 0) {
          this.vm.avisosPendentes.set(total);
          this.vm.mostrarAvisoPendentes.set(true);
        }
      },
      error: () => console.warn('Erro ao verificar pendências.')
    });
  }

  async registrarPonto() {
    if (!this.vm.form.valid || !this.vm.imagemCapturada) return;

    const blob = await (await fetch(this.vm.imagemCapturada)).blob();
    const file = new File([blob], 'foto.jpg', { type: 'image/jpeg' });
    const cpf = this.vm.form.value.cpf!;

    this.service.registrar({
      cpf,
      imagem: file,
      deviceIdentifier: this.vm.deviceIdentifier
    }).subscribe({
      next: () => {
        this.vm.mensagemSucesso.set('Ponto registrado com sucesso!');
        this.vm.mensagemErro.set(null);
        setTimeout(() => this.vm.mensagemSucesso.set(null), 3000);
        this.vm.form.reset();
        this.camera.reiniciarCamera();
      },
      error: err => {
        this.vm.mensagemErro.set(err?.error?.message || '❌ Erro ao registrar ponto.');
        this.vm.mensagemSucesso.set(null);
        setTimeout(() => this.vm.mensagemErro.set(null), 4000);
      }
    });
  }

  tratarEnter(event: KeyboardEvent, input: ElementRef<HTMLInputElement>) {
    event.preventDefault();
    if (!this.vm.fotoCapturada()) {
      this.camera.tirarFoto();
    } else if (this.vm.form.valid) {
      this.registrarPonto();
    }
  }
}
