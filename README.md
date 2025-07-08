# Plataforma de Jogo de Dominó Multiplayer

---

## Como Executar o Projeto Localmente

Para executar este projeto na sua máquina, precisa de ter o **Git** e o **Docker Desktop** instalados.

**1. Clonar o Repositório**
```bash
git clone git@github.com:LuisFelipe210/projeto-domino.git
cd projeto-domino
```

**2. Criar o Ficheiro de Ambiente**
Este passo é crucial. Crie um ficheiro chamado `.env` na raiz do projeto e cole o seguinte conteúdo. Estas variáveis são usadas pelo `docker-compose.yml` para configurar os contentores do backend.

```
# .env

# URL de conexão completa para o PostgreSQL
DATABASE_URL=postgresql://domino_user:domino_password@postgres:5432/domino_db

# URL de conexão para o Redis
REDIS_URL=redis://redis:6379

# Segredo para os JSON Web Tokens (JWT) - Altere para um valor seguro em produção
JWT_SECRET=este-e-um-segredo-muito-forte-e-deve-ser-alterado
```

**3. Iniciar a Aplicação**
Com o Docker Desktop a correr, execute o seguinte comando na raiz do projeto:

```bash
docker-compose up --build
```

O comando `--build` irá construir as imagens do Docker para o frontend e o backend. Na primeira vez, este processo pode demorar alguns minutos.

**4. Aceder à Aplicação**
Após a conclusão, abra o seu navegador e aceda a:
[http://localhost](http://localhost)

A aplicação estará pronta a ser utilizada.

---

## 📂 Estrutura do Projeto

```
/projeto-domino/
|
|-- backend/          # Contém a aplicação Node.js/Express
|-- frontend/         # Era pra ter react aqui, mas desisti
|-- nginx/            # Ficheiro de configuração do NGINX principal
|-- docker-compose.yml # Orquestra todos os serviços
|-- .env              # Ficheiro de ambiente (criado localmente)
|-- .gitignore        # Ficheiros e pastas a serem ignorados pelo Git
|-- README.md         # Este ficheiro
```