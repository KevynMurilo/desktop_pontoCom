import { FormBuilder, Validators } from '@angular/forms';
import { signal, computed } from '@angular/core';
import { cpfValidator } from '../../core/validators/cpf.validator';

export class RegistroPontoViewModel {
  form;

  modoEscuro = signal(localStorage.getItem('modo') === 'dark');
  carregandoCamera = signal(true);
  mostrarFlash = signal(false);
  fotoTirada = signal(false);
  fotoCapturada = computed(() => this.fotoTirada());

  statusOnline = signal(false);
  mensagemSucesso = signal<string | null>(null);
  mensagemErro = signal<string | null>(null);
  mostrarConfiguracoes = signal(false);

  imagemCapturada: string | null = null;
  videoElement!: HTMLVideoElement;
  stream!: MediaStream;

  dispositivosVideo: MediaDeviceInfo[] = [];
  dispositivoSelecionadoId: string | null = null;
  deviceIdentifier = 'desconhecido';

  avisosPendentes = signal<number>(0);
  mostrarAvisoPendentes = signal(true);

  vinculoDispositivo = signal<{
    municipioNome: string | null;
    secretariaNome: string | null;
    setorNome: string | null;
  } | null>(null);

  carregandoVinculo = signal(false);

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      cpf: ['', [Validators.required, cpfValidator]]
    });

    document.documentElement.classList.toggle('dark', this.modoEscuro());
  }
}
