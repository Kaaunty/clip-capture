# Clip Capture — especificação arquitetural

**Status:** proposta aprovada para especificação; implementação ainda não iniciada  
**Data:** 2026-09-28

## 1. Objetivo

Criar uma aplicação para campos de futebol com várias câmeras que permanecem gravando localmente. Ao pressionar um botão físico, o sistema deve preservar o intervalo configurado do lance para cada câmera, enviar somente os clipes gerados ao servidor central e disponibilizar links privados temporários para assistir e baixar os vídeos.

O botão físico é o fluxo principal. O site também poderá disparar o mesmo evento pelo celular ou tablet, funcionando como alternativa, teste e contingência.

## 2. Decisões do produto

- Cada campo possui várias câmeras e gera um arquivo separado por ângulo.
- A janela de captura é configurável por campo, com tempo anterior e posterior ao acionamento.
- O processamento e o buffer acontecem localmente no campo.
- A internet é usada para enviar clipes finalizados, não para transportar vídeo continuamente.
- O acesso ocorre por link privado com validade, adequado para compartilhamento por WhatsApp.
- A demora de alguns minutos é aceitável quando isso aumenta a confiabilidade.
- Edição manual, detecção automática de gols, montagem multicâmera e aplicativo nativo ficam fora do primeiro MVP.

## 3. Escopo do MVP

### Incluído

1. Cadastro de campos, câmeras, nomes dos ângulos e configurações de captura.
2. Captura contínua local com buffer circular por câmera.
3. Acionamento por botão físico de rede.
4. Acionamento alternativo pelo site responsivo.
5. Recorte independente para cada câmera do campo.
6. Fila local de clipes e upload assíncrono ao servidor central.
7. Página de evento com os ângulos disponíveis, reprodução e download.
8. Links com token privado e expiração configurável.
9. Estados de processamento, logs operacionais e retentativas.
10. Detecção e sinalização de câmeras indisponíveis.

### Fora do escopo

- Reconhecimento automático de gols ou jogadas.
- Seleção automática dos melhores ângulos.
- Edição, corte manual ou montagem em um único vídeo.
- Aplicativo mobile nativo.
- Gestão de usuários finais/jogadores como requisito do primeiro lançamento.

## 4. Arquitetura

```text
                  ┌──────────────────────┐
                  │ Câmeras IP / RTSP    │
                  └──────────┬───────────┘
                             │ rede local
                  ┌──────────▼───────────┐
                  │ Agente no campo      │
                  │ buffer + recorte     │
                  │ fila + sincronização │
                  └──────┬─────────┬─────┘
                         │         │
                botão físico   site/celular
                         │         │
                         └────┬────┘
                              │ evento autenticado
                  ┌───────────▼───────────┐
                  │ API e armazenamento    │
                  │ central                │
                  └───────────┬───────────┘
                              │
                  ┌───────────▼───────────┐
                  │ Página do clipe        │
                  │ link privado temporário│
                  └────────────────────────┘
```

### Componentes locais

- **Câmeras:** câmeras IP com transmissão RTSP e alimentação PoE.
- **Rede:** switch PoE e rede local isolada ou controlada.
- **Agente do campo:** serviço que mantém o buffer, recebe eventos, recorta vídeos, mantém a fila e envia arquivos.
- **Armazenamento local:** disco suficiente para o buffer, eventos ainda não enviados e margem operacional.
- **Botão:** dispositivo de rede cadastrado, conectado por Ethernet ou Wi-Fi conforme a instalação. O comando deve ser autenticado e idempotente por identificador de evento.

### Componentes centrais

- **API:** cadastro, configuração, criação de eventos, status e emissão de links.
- **Banco relacional:** PostgreSQL para campos, câmeras, eventos, arquivos e tokens.
- **Armazenamento de objetos:** serviço compatível com S3 para os vídeos.
- **Interface web:** site responsivo para administração, operação e acesso aos eventos.

FFmpeg ou GStreamer pode ser usado no agente para captura, segmentação e recorte. A escolha final deve considerar suporte aos codecs das câmeras e operação estável como serviço.

## 5. Fluxos principais

### 5.1 Captura contínua

1. O agente conecta-se aos streams RTSP das câmeras cadastradas.
2. Cada stream é gravado em segmentos pequenos e rotativos.
3. Os segmentos antigos são removidos conforme a política do buffer.
4. O agente monitora conexão, espaço em disco e horário sincronizado por NTP.

### 5.2 Criação do lance

1. O botão físico ou o site envia um comando ao agente do campo.
2. O agente valida o dispositivo ou a credencial e registra o horário do evento.
3. Para cada câmera, identifica os segmentos correspondentes à janela anterior e posterior configurada.
4. Gera um MP4 independente por câmera.
5. Registra o evento localmente e coloca os arquivos em fila.
6. O agente informa que o evento foi recebido, mesmo antes do upload terminar.

### 5.3 Sincronização

1. O agente tenta enviar os arquivos finalizados ao servidor central.
2. O servidor valida campo, câmera, tamanho, checksum e metadados.
3. O upload concluído torna o ângulo disponível na página do evento.
4. Falhas são retentadas com backoff; o arquivo permanece local até confirmação segura.
5. Após a política de retenção local, o arquivo pode ser removido do campo se estiver confirmado no armazenamento central.

### 5.4 Acesso

1. O operador abre o evento no site.
2. O site lista os ângulos prontos e informa os que ainda estão processando ou falharam.
3. O operador solicita compartilhamento.
4. A API cria um token aleatório com prazo de expiração.
5. O destinatário acessa a página do evento e reproduz ou baixa os arquivos autorizados.

## 6. Modelo lógico mínimo

- **Field:** campo, nome, configuração padrão e estado operacional.
- **Camera:** campo, nome do ângulo, origem RTSP protegida, ordem de exibição e estado.
- **CaptureProfile:** segundos anteriores, segundos posteriores, formato e retenção.
- **ClipEvent:** campo, horário do acionamento, origem do comando, estado geral e timestamps.
- **ClipFile:** evento, câmera, caminho no armazenamento, duração, checksum e estado do upload.
- **ShareToken:** evento, token hash, expiração, escopo e contagem de acessos opcional.
- **Device:** campo, tipo, identificador, credencial rotacionável e último contato.

URLs e credenciais RTSP não devem ser expostas ao navegador nem armazenadas em texto aberto sem proteção apropriada.

## 7. Falhas e comportamento esperado

- **Dois cliques:** cada comando aceito cria um evento próprio; identificadores evitam duplicar o mesmo comando em retries.
- **Câmera offline:** o evento continua com os demais ângulos e marca a câmera como indisponível.
- **Internet fora do ar:** os arquivos permanecem na fila local até a reconexão.
- **Upload interrompido:** o agente retenta sem remover o arquivo original antes da confirmação.
- **Pouco espaço:** o agente alerta o campo e aplica retenção; eventos não confirmados têm prioridade de preservação.
- **Falha do servidor:** o agente continua capturando e enfileirando, limitado pela capacidade local.
- **Relógio incorreto:** o agente e as câmeras devem usar NTP; diferenças detectadas devem aparecer nos logs.
- **Botão não autorizado:** o comando é rejeitado e auditado.

## 8. Segurança e privacidade

- Todo tráfego externo usa HTTPS.
- Links de compartilhamento usam tokens aleatórios não previsíveis e prazo de expiração.
- O armazenamento de objetos não é público; downloads usam autorização temporária.
- Dispositivos e agentes são cadastrados por campo e têm credenciais próprias.
- Credenciais RTSP ficam somente no agente ou em armazenamento seguro do servidor.
- Campos e eventos são isolados no modelo e nas autorizações da API.
- Logs não devem registrar tokens completos, senhas ou URLs com credenciais.

## 9. Observabilidade e testes

### Indicadores operacionais

- Último contato do agente e de cada câmera.
- Tamanho da fila local e idade do clipe mais antigo.
- Espaço livre no equipamento.
- Tempo entre acionamento, recorte, upload e disponibilidade.
- Taxa de falha por câmera e por campo.

### Testes essenciais

- Captura contínua e recorte nas bordas do segmento.
- Janela anterior/posterior configurável.
- Múltiplas câmeras com uma câmera offline.
- Clique duplicado e retry do mesmo comando.
- Queda de internet durante captura e durante upload.
- Reinício do agente com arquivos pendentes.
- Expiração e rejeição de links privados.
- Isolamento entre campos.
- Compatibilidade dos MP4 em navegador e celular.
- Recuperação quando o disco local atinge o limite definido.

## 10. Critérios de aceite do MVP

1. Um acionamento válido cria um evento para todas as câmeras cadastradas no campo.
2. Cada arquivo respeita os tempos anterior e posterior configurados.
3. O evento aparece no site com status de processamento.
4. Os clipes prontos podem ser assistidos e baixados por link privado.
5. Uma câmera indisponível não impede os outros ângulos.
6. Uma queda temporária da internet não perde eventos nem clipes confirmados localmente.
7. Uploads interrompidos são retomados ou reenviados automaticamente.
8. Eventos de campos diferentes não compartilham arquivos nem permissões.
9. O operador consegue identificar falhas de câmera, fila e armazenamento.

## 11. Evolução posterior

Depois que o MVP estiver estável, podem ser adicionados montagem multicâmera, edição simples, identificação de jogadores, notificações por WhatsApp, detecção automática de eventos e aplicativo nativo. Essas extensões não devem alterar o contrato básico de criação de evento e disponibilidade dos clipes.
