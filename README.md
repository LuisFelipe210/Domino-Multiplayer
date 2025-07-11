# Plataforma de Jogo de Dominó Multiplayer

Bem-vindo à plataforma de Jogo de Dominó Multiplayer! Esta é uma aplicação web completa que permite que utilizadores joguem dominó em tempo real. O projeto inclui autenticação de utilizadores, um lobby para criação e listagem de salas, e uma interface de jogo interativa com comunicação via WebSockets.

## ✨ Funcionalidades

* **Autenticação de Utilizadores**: Sistema de registo e login seguro com senhas criptografadas e sessões baseadas em JWT (JSON Web Tokens).
* **Lobby de Salas**: Crie salas de jogo públicas ou privadas (com senha) e veja uma lista de salas disponíveis para entrar.
* **Jogo em Tempo Real**: Jogue dominó com até 4 jogadores, com todas as ações (jogar peça, passar, etc.) sincronizadas instantaneamente para todos na sala através de WebSockets.
* **Lógica de Dominó Completa**: Implementação das regras do dominó, incluindo a validação de jogadas, condição de vitória por "bater", e vitória por pontos em caso de jogo fechado.
* **Histórico de Partidas**: Visualize o seu histórico de partidas, incluindo vencedores e jogadores participantes.
* **Reconexão Automática**: Se um jogador perder a conexão ou atualizar a página no meio de um jogo, o sistema o reconecta automaticamente à partida em andamento.
* **Design Responsivo**: Interface de utilizador desenhada para ser funcional e agradável em diferentes tamanhos de ecrã.

## 🏗️ Arquitetura e Tecnologias

O projeto é executado em contentores Docker, garantindo um ambiente de desenvolvimento e produção consistente e isolado.

| Componente      | Tecnologia                          | Descrição                                                                                                                         |
| :-------------- | :---------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| **Backend** | **Node.js, Express, TypeScript** | Serve a API REST para autenticação e gestão de salas, e gere as conexões WebSocket para a lógica do jogo.                            |
| **Frontend** | **HTML5, CSS3, JavaScript (Vanilla)** | Interface de utilizador modular e reativa que interage com o backend via API REST e WebSockets.                                     |
| **Base de Dados** | **PostgreSQL** | Utilizada para persistir os dados dos utilizadores e o histórico de partidas.                                                     |
| **Servidor Web** | **Nginx** | Atua como proxy reverso, servindo os ficheiros do frontend e encaminhando os pedidos da API e WebSocket para o backend. Também está configurado para SSL (HTTPS). |
| **Deployment** | **Docker & Docker Compose** | Orquestra todos os serviços (backend, postgres, nginx) para uma execução simplificada.                                            |

## 🚀 Como Executar Localmente

Para executar este projeto na sua máquina, precisa de ter o **Git** e o **Docker Desktop** instalados.

**1. Clonar o Repositório**

```bash
git clone git@github.com:LuisFelipe210/projeto-domino.git
cd projeto-domino
```

**2. Criar o Ficheiro de Ambiente (`.env`)**

Crie um ficheiro chamado `.env` na raiz do projeto e cole o seguinte conteúdo. Estas variáveis são essenciais para a configuração dos serviços do Docker.

```env
# .env

# URL de conexão completa para o PostgreSQL
DATABASE_URL=postgresql://domino_user:domino_password@postgres:5432/domino_db

# Segredo para os JSON Web Tokens (JWT) - Altere para um valor seguro
JWT_SECRET=este-e-um-segredo-muito-forte-e-deve-ser-alterado

# ID do servidor (opcional, para ambientes com múltiplos servidores)
SERVER_ID=local-server
```

**3. Iniciar a Aplicação com Docker Compose**

Com o Docker Desktop em execução, execute o seguinte comando na raiz do projeto:

```bash
docker-compose up --build
```

O comando `--build` constrói as imagens do Docker para os serviços. Na primeira vez, este processo pode demorar alguns minutos.

**4. Aceder à Aplicação**

Após a conclusão, abra o seu navegador e aceda a:
`http://localhost`

## 📂 Estrutura do Projeto

```
/
|-- backend/
|   |-- src/
|   |   |-- api/                # Lógica da API REST (rotas, controllers, middleware)
|   |   |-- config/             # Configurações (base de dados, ambiente, jogo)
|   |   |-- websockets/         # Lógica do jogo em tempo real (WebSocket)
|   |   |-- types/              # Definições de tipos do TypeScript
|   |   |-- app.ts              # Ponto de entrada do Express
|   |   `-- server.ts           # Inicialização do servidor HTTP
|   |-- sql/
|   |   `-- init.sql            # Script de inicialização da base de dados
|   `-- package.json            # Dependências do backend
|
|-- frontend/
|   |-- css/style.css           # Estilização
|   |-- js/                     # Scripts do cliente
|   |   |-- api.js              # Funções para chamar a API
|   |   |-- main.js             # Ponto de entrada, orquestração
|   |   |-- state.js            # Gestão de estado do lado do cliente
|   |   |-- ui.js               # Manipulação do DOM
|   |   `-- websocket.js        # Gestão da conexão WebSocket
|   `-- index.html              # Estrutura principal da página
|
|-- certbot/                    # Configurações do Let's Encrypt para HTTPS
|-- docker-compose.yml          # Ficheiro de orquestração dos contentores
|-- nginx.conf                  # Configuração do Nginx
`-- README.md                   # Este ficheiro
```

## 🔌 Endpoints da API

Todas as rotas, exceto `/auth`, são protegidas e exigem autenticação.

* `POST /api/auth/register`: Regista um novo utilizador.
* `POST /api/auth/login`: Autentica um utilizador e retorna um cookie com o token JWT.
* `POST /api/auth/logout`: Faz o logout do utilizador, limpando o cookie.
* `GET /api/lobby/rooms`: Lista todas as salas de jogo disponíveis.
* `POST /api/lobby/rooms`: Cria ou entra numa sala de jogo.
* `GET /api/lobby/rejoin`: Verifica se o utilizador tem um jogo ativo para reconexão.
* `GET /api/user/history`: Retorna o histórico de partidas do utilizador autenticado.

## 🔄 Eventos WebSocket

A comunicação em tempo real é baseada nos seguintes tipos de mensagens:

#### **Cliente → Servidor**

* **`PLAY_PIECE`**: Envia a peça que o jogador deseja jogar.
* **`PASS_TURN`**: Informa o servidor que o jogador está a passar a sua vez.
* **`LEAVE_GAME`**: Informa o servidor que o jogador está a sair do jogo.
* **`PLAYER_READY`**: Indica que o jogador está pronto para começar uma nova partida (usado no rematch).
* **`START_GAME`**: Mensagem enviada pelo anfitrião para iniciar a partida.

#### **Servidor → Cliente**

* **`ROOM_STATE`**: Enviado quando um jogador entra numa sala que ainda não começou; contém o estado do lobby da sala.
* **`JOGO_INICIADO`**: Notifica todos os jogadores que o jogo começou e envia o estado inicial do jogo.
* **`ESTADO_ATUALIZADO`**: Enviado após cada jogada ou mudança de estado (ex: um jogador se reconecta), contém o estado público atual do jogo.
* **`UPDATE_HAND`**: Atualiza a mão de um jogador específico após ele jogar uma peça.
* **`CHOOSE_PLACEMENT`**: Solicitado quando uma peça pode ser jogada em mais de uma ponta do tabuleiro.
* **`JOGO_TERMINADO`**: Notifica todos os jogadores sobre o fim da partida, incluindo o vencedor e o motivo.
* **`ERRO`**: Envia uma mensagem de erro específica para um jogador (ex: jogada inválida, não é a sua vez).
