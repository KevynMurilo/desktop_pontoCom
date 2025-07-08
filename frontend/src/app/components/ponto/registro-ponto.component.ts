import {
  Component,
  signal,
  computed,
  inject,
  HostListener,
  ViewChild,
  ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { RegistroPontoService } from './registro-ponto.service';
import { NgxMaskDirective, provideNgxMask } from 'ngx-mask';
import { ConfiguracoesComponent } from '../configuracoes/configuracoes.component';
import { interval } from 'rxjs';
import { cpfValidator } from '../../validators/cpf.validator';

@Component({
  selector: 'app-registro-ponto',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NgxMaskDirective,
    ConfiguracoesComponent
  ],
  templateUrl: './registro-ponto.component.html',
  providers: [RegistroPontoService, provideNgxMask()]
})
export class RegistroPontoComponent {
  private fb = inject(FormBuilder);
  private service = inject(RegistroPontoService);

  @ViewChild('cpfInput') cpfInputRef!: ElementRef<HTMLInputElement>;

  form = this.fb.group({
    cpf: ['', [Validators.required, cpfValidator]]
  });

  carregandoCamera = signal(true);
  mostrarFlash = signal(false);
  fotoTirada = signal(false);
  fotoCapturada = computed(() => this.fotoTirada());
  mostrarConfiguracoes = signal(false);
  statusOnline = signal(false);

  mensagemSucesso = signal<string | null>(null);
  mensagemErro = signal<string | null>(null);

  modoEscuro = signal(localStorage.getItem('modo') === 'dark');
  imagemCapturada: string | null = null;
  videoElement!: HTMLVideoElement;
  stream!: MediaStream;

  deviceIdentifier = 'desconhecido';
  dispositivosVideo: MediaDeviceInfo[] = [];
  dispositivoSelecionadoId: string | null = null;

  avisosPendentes = signal<number>(3);
  mostrarAvisoPendentes = signal(true);

  constructor() {
    document.documentElement.classList.toggle('dark', this.modoEscuro());
  }

  async ngAfterViewInit() {
    this.deviceIdentifier = (window as any).device?.getId?.() || 'desconhecido';
    await this.listarDispositivos();

    const salvo = localStorage.getItem('cameraSelecionada');
    if (salvo && this.dispositivosVideo.some(d => d.deviceId === salvo)) {
      this.dispositivoSelecionadoId = salvo;
    } else if (this.dispositivosVideo.length > 0) {
      this.dispositivoSelecionadoId = this.dispositivosVideo[0].deviceId;
    }

    this.iniciarVideoComPermissao();
    this.verificarStatus();
    this.verificarAvisosPendentes();

    interval(10000).subscribe(() => this.verificarStatus());
    interval(30000).subscribe(() => this.verificarAvisosPendentes());
  }

  verificarAvisosPendentes() {
    this.service.verificarPendentesAntigos().subscribe({
      next: total => {
        if (total > 0) {
          this.avisosPendentes.set(total);
          this.mostrarAvisoPendentes.set(true);
        }
      },
      error: () => {
        console.warn('Erro ao verificar avisos pendentes. Mantendo valor atual.');
      }
    });
  }

  verificarStatus() {
    this.service.verificarStatus().subscribe({
      next: (online) => this.statusOnline.set(online),
      error: () => this.statusOnline.set(false)
    });
  }

  alternarTema() {
    const ehEscuro = !this.modoEscuro();
    this.modoEscuro.set(ehEscuro);
    localStorage.setItem('modo', ehEscuro ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', ehEscuro);
  }

  async listarDispositivos() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.dispositivosVideo = devices.filter(d => d.kind === 'videoinput');
  }

  iniciarVideoComPermissao() {
    navigator.permissions?.query({ name: 'camera' as PermissionName })
      .then((result) => {
        if (result.state === 'denied') {
          alert('Permissão de câmera negada.');
          return;
        }
        this.solicitarPermissaoECapturar();
      })
      .catch(() => {
        this.solicitarPermissaoECapturar();
      });
  }

  solicitarPermissaoECapturar() {
    this.videoElement = document.getElementById('video') as HTMLVideoElement;
    if (!this.videoElement) return;

    this.pararStreamAtual();
    this.carregandoCamera.set(true);

    const constraints: MediaStreamConstraints = {
      video: {
        deviceId: this.dispositivoSelecionadoId ? { exact: this.dispositivoSelecionadoId } : undefined
      }
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        this.stream = stream;
        this.videoElement.srcObject = stream;
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          this.carregandoCamera.set(false);
        };
      })
      .catch(err => {
        alert(`Erro ao acessar a câmera: ${err.name} - ${err.message}`);
        this.carregandoCamera.set(false);
      });
  }

  tirarFoto() {
    this.mostrarFlash.set(true);
    setTimeout(() => {
      const audio = new Audio('assets/camera-shutter-roger.mp3');
      audio.play();

      const canvas = document.createElement('canvas');
      canvas.width = this.videoElement.videoWidth;
      canvas.height = this.videoElement.videoHeight;
      canvas.getContext('2d')?.drawImage(this.videoElement, 0, 0);
      this.imagemCapturada = canvas.toDataURL('image/jpeg');
      this.fotoTirada.set(true);

      this.videoElement.srcObject = null;
      this.stream.getTracks().forEach(track => track.stop());
      setTimeout(() => this.mostrarFlash.set(false), 150);
    }, 250);
  }

  repetirFoto() {
    this.imagemCapturada = null;
    this.fotoTirada.set(false);
    this.carregandoCamera.set(true);
    this.solicitarPermissaoECapturar();
  }

  registrarPonto = async () => {
    if (!this.form.valid || !this.imagemCapturada) return;

    const blob = await (await fetch(this.imagemCapturada)).blob();
    const file = new File([blob], 'foto.jpg', { type: 'image/jpeg' });
    const cpfLimpo = this.form.value.cpf!;

    this.service.registrar({
      cpf: cpfLimpo,
      imagem: file,
      deviceIdentifier: this.deviceIdentifier
    }).subscribe({
      next: () => {
        this.mensagemSucesso.set('Ponto registrado com sucesso!');
        this.mensagemErro.set(null);
        setTimeout(() => this.mensagemSucesso.set(null), 3000);

        this.form.reset();
        setTimeout(() => this.repetirFoto(), 0);
      },
      error: err => {
        this.mensagemErro.set(err?.error?.message || '❌ Erro ao registrar ponto.');
        this.mensagemSucesso.set(null);
        setTimeout(() => this.mensagemErro.set(null), 4000);
      }
    });
  };

  forcarSincronizacaoManual() {
    this.service.forcarSincronizacao().subscribe({
      next: () => alert('✅ Sincronização manual concluída.'),
      error: () => alert('❌ Erro ao sincronizar com o servidor.')
    });
  }

  fecharModalConfiguracoes() {
    this.mostrarConfiguracoes.set(false);
    setTimeout(() => {
      this.cpfInputRef?.nativeElement?.focus();
    }, 150);
  }

  focarCPF() {
    this.mensagemSucesso.set('Código copiado com sucesso!');
    setTimeout(() => this.mensagemSucesso.set(null), 2000);
    setTimeout(() => {
      const el = this.cpfInputRef?.nativeElement;
      if (el) {
        el.blur();
        el.focus();
      }
    }, 150);
  }

  onSelecionarDispositivo(deviceId: string) {
    this.dispositivoSelecionadoId = deviceId;
    localStorage.setItem('cameraSelecionada', deviceId);
    this.pararStreamAtual();
    this.carregandoCamera.set(true);
    this.solicitarPermissaoECapturar();
  }

  pararStreamAtual() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null!;
    }

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
    }
  }

  @HostListener('document:keydown.enter', ['$event'])
  handleEnterKey(event: KeyboardEvent) {
    event.preventDefault();
    if (!this.fotoCapturada()) {
      this.tirarFoto();
    } else if (this.form.valid) {
      this.registrarPonto();
    }
  }
}
