import {
  Component,
  ViewChild,
  ElementRef,
  inject,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { NgxMaskDirective, provideNgxMask } from 'ngx-mask';
import { ConfiguracoesComponent } from '../configuracoes/configuracoes.component';
import { RegistroPontoService } from '../../core/service/registro-ponto.service';
import { RegistroPontoCamera } from './registro-ponto.camera';
import { RegistroPontoViewModel } from './registro-ponto.viewmodel';
import { RegistroPontoHandlers } from './registro-ponto.handlers';

@Component({
  selector: 'app-registro-ponto',
  standalone: true,
  templateUrl: './registro-ponto.component.html',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NgxMaskDirective,
    ConfiguracoesComponent
  ],
  providers: [RegistroPontoService, provideNgxMask()]
})
export class RegistroPontoComponent {
  private fb = inject(FormBuilder);
  private service = inject(RegistroPontoService);

  @ViewChild('cpfInput') cpfInputRef!: ElementRef<HTMLInputElement>;

  vm = new RegistroPontoViewModel(this.fb);
  camera = new RegistroPontoCamera(this.vm);
  handlers = new RegistroPontoHandlers(this.vm, this.service, this.camera);


  get carregandoVinculo() { return this.vm.carregandoVinculo; }

  atualizarVinculo() {
    this.handlers.verificarVinculoDispositivo();
  }

  iniciarSincronizacao() {
    this.handlers.iniciarSincronizacao();
  }

  get carregandoSincronizacao() { return this.vm.carregandoSincronizacao; }
  get progressoSincronizacao() { return this.vm.progressoSincronizacao; }

  async ngAfterViewInit() {
    await this.handlers.inicializar(this.cpfInputRef);
  }

  @HostListener('document:keydown.enter', ['$event'])
  onEnter(event: KeyboardEvent) {
    this.handlers.tratarEnter(event, this.cpfInputRef);
  }

  // ✅ Reexpõe sinais e valores computados para o template
  get modoEscuro() { return this.vm.modoEscuro; }
  get mostrarFlash() { return this.vm.mostrarFlash; }
  get mensagemSucesso() { return this.vm.mensagemSucesso; }
  get mensagemErro() { return this.vm.mensagemErro; }
  get mostrarConfiguracoes() { return this.vm.mostrarConfiguracoes; }
  get statusOnline() { return this.vm.statusOnline; }
  get vinculoDispositivo() { return this.vm.vinculoDispositivo; }
  get avisosPendentes() { return this.vm.avisosPendentes; }
  get mostrarAvisoPendentes() { return this.vm.mostrarAvisoPendentes; }
  get form() { return this.vm.form; }
  get carregandoCamera() { return this.vm.carregandoCamera; }
  get fotoCapturada() { return this.vm.fotoCapturada; }
  get imagemCapturada() { return this.vm.imagemCapturada; }
  get dispositivosVideo() { return this.vm.dispositivosVideo; }
  get dispositivoSelecionadoId() { return this.vm.dispositivoSelecionadoId; }
  get deviceIdentifier() { return this.vm.deviceIdentifier; }

  alternarTema() {
    const novo = !this.vm.modoEscuro();
    this.vm.modoEscuro.set(novo);
    localStorage.setItem('modo', novo ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', novo);
  }

  refresh() {
    (window as any).electron?.send('reload-app');
  }

  tirarFoto() {
    this.camera.tirarFoto();
  }

  repetirFoto() {
    this.camera.repetirFoto();
  }

  registrarPonto() {
    this.handlers.registrarPonto();
  }

  focarCPF() {
    this.vm.mensagemSucesso.set('Código copiado com sucesso!');
    setTimeout(() => this.vm.mensagemSucesso.set(null), 2000);
    setTimeout(() => {
      const el = this.cpfInputRef?.nativeElement;
      if (el) {
        el.blur();
        el.focus();
      }
    }, 150);
  }

  fecharModalConfiguracoes() {
    this.vm.mostrarConfiguracoes.set(false);
    setTimeout(() => {
      this.cpfInputRef?.nativeElement?.focus();
    }, 150);
  }

  onSelecionarDispositivo(deviceId: string) {
    this.vm.dispositivoSelecionadoId = deviceId;
    localStorage.setItem('cameraSelecionada', deviceId);
    this.camera.pararStreamAtual();
    this.vm.carregandoCamera.set(true);
    this.camera.solicitarPermissaoECapturar();
  }
}
