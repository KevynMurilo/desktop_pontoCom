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
  ) { }

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

    let ultimaContagem = { registrosSincronizados: 0, totalRegistros: 0 };

    this.service.onProgressoSyncRecebimento(({ registrosSincronizados, totalRegistros }) => {
      if (
        registrosSincronizados === ultimaContagem.registrosSincronizados &&
        totalRegistros === ultimaContagem.totalRegistros
      ) {
        return;
      }

      ultimaContagem = { registrosSincronizados, totalRegistros };

      if (totalRegistros === 0) {
        this.vm.carregandoSincronizacao.set(false);
        this.vm.totalRegistros.set(0);
        this.vm.registrosSincronizados.set(0);
        return;
      }

      this.vm.carregandoSincronizacao.set(true);
      this.vm.totalRegistros.set(totalRegistros);
      this.vm.registrosSincronizados.set(registrosSincronizados);

      if (registrosSincronizados >= totalRegistros) {
        setTimeout(() => {
          this.vm.carregandoSincronizacao.set(false);
          this.vm.totalRegistros.set(0);
          this.vm.registrosSincronizados.set(0);
          ultimaContagem = { registrosSincronizados: 0, totalRegistros: 0 };
        }, 1500);
      }
    });
  }

  iniciarSincronizacao() {
    this.vm.carregandoSincronizacao.set(true);
    this.vm.progressoSincronizacao.set(0);

    this.service.sincronizarRecebimento().subscribe({
      next: res => {
        this.vm.progressoSincronizacao.set(100);
        setTimeout(() => this.vm.carregandoSincronizacao.set(false), 1000);
      },
      error: err => {
        console.log(err)
        this.vm.carregandoSincronizacao.set(false);
        this.vm.mensagemErro.set('Erro ao sincronizar dados.');
        setTimeout(() => this.vm.mensagemErro.set(null), 4000);
      }
    });
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

    this.vm.registrandoPonto.set(true);

    const blob = await (await fetch(this.vm.imagemCapturada)).blob();
    const file = new File([blob], 'foto.jpg', { type: 'image/jpeg' });
    const cpf = this.vm.form.value.cpf!;

    this.service.registrar({
      cpf,
      imagem: file,
      deviceIdentifier: this.vm.deviceIdentifier
    }).subscribe({
      next: () => {
        const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        this.vm.mensagemSucesso.set(`✅ Ponto registrado com sucesso às ${hora}!`);
        this.vm.mensagemErro.set(null);
        setTimeout(() => this.vm.mensagemSucesso.set(null), 3000);
        this.vm.form.reset();
        this.camera.reiniciarCamera();

        setTimeout(() => {
          this.vm.registrandoPonto.set(false);
        }, 2000);
      },
      error: err => {
        this.vm.mensagemErro.set(`❌ Falha ao registrar ponto. ${err?.error?.message || 'Tente novamente.'}`);
        this.vm.mensagemSucesso.set(null);
        setTimeout(() => this.vm.mensagemErro.set(null), 4000);

        setTimeout(() => {
          this.vm.registrandoPonto.set(false);
        }, 2000);
      }
    });
  }

  tratarEnter(event: KeyboardEvent, input: ElementRef<HTMLInputElement>) {
    event.preventDefault();
    if (this.vm.tirandoFoto()) return;

    if (!this.vm.fotoCapturada()) {
      this.camera.tirarFoto();
    } else if (this.vm.form.valid) {
      this.registrarPonto();
    }
  }
}