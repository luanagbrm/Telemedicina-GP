# Design Document — TeleMed+ (Sistema de Telemedicina e Prontuário Eletrônico Simplificado)

**Versão:** 1.0  
**Data:** [Preencher]  
**Autoras:** Giulia Mattedi, Grazielle Almeida, Luana Macedo  
**Disciplina:** [Nome da disciplina] — Prof. Mario Farah  

---

## 1. Resumo Executivo

O TeleMed+ é um sistema web que permite a realização de consultas médicas remotas (assíncronas via chat) e o registro de prontuários eletrônicos de forma simplificada, segura e em conformidade com a LGPD. O sistema atende três perfis de usuário — Paciente, Médico e Administrador — com controle de acesso baseado em papéis (RBAC) e trilha de auditoria completa.

---

## 2. Contexto e Motivação

Clínicas de pequeno porte e consultórios independentes frequentemente utilizam ferramentas fragmentadas (WhatsApp, planilhas, prontuários em papel) para comunicação com pacientes e registro clínico. Isso resulta em:

- Exposição de dados sensíveis de saúde em canais não seguros
- Ausência de rastreabilidade de acesso (quem viu qual informação)
- Dificuldade de conformidade com a LGPD (Lei 13.709/2018), especialmente para dados de saúde (art. 11)
- Impossibilidade de auditoria em caso de incidentes

O TeleMed+ resolve esses problemas oferecendo um sistema unificado, com segurança incorporada desde a concepção (privacy by design).

---

## 3. Requisitos Funcionais

### 3.1 Gestão de Usuários e Autenticação

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-01 | Cadastro de usuário com perfil (Paciente, Médico, Administrador) | Alta |
| RF-02 | Autenticação com e-mail e senha (hash bcrypt, mínimo 8 caracteres) | Alta |
| RF-03 | Recuperação de senha via e-mail | Média |
| RF-04 | Aceite de Termo de Consentimento LGPD no cadastro do Paciente | Alta |
| RF-05 | Administrador pode ativar/desativar contas | Alta |

### 3.2 Agendamento de Consultas

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-06 | Paciente solicita agendamento indicando médico, data e motivo | Alta |
| RF-07 | Médico visualiza solicitações pendentes e confirma/recusa | Alta |
| RF-08 | Paciente visualiza status das suas consultas (pendente, confirmada, realizada, cancelada) | Alta |
| RF-09 | Cancelamento de consulta por ambas as partes (com registro de motivo) | Média |

### 3.3 Prontuário Eletrônico

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-10 | Médico cria/edita anotações clínicas vinculadas a uma consulta | Alta |
| RF-11 | Histórico completo de consultas e anotações por paciente | Alta |
| RF-12 | Paciente visualiza suas próprias consultas (sem editar anotações médicas) | Alta |
| RF-13 | Médico só acessa prontuários de pacientes vinculados a ele | Alta |

### 3.4 Chat Assíncrono

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-14 | Chat texto entre médico e paciente vinculado a uma consulta confirmada | Alta |
| RF-15 | Histórico de mensagens armazenado e acessível por ambas as partes | Alta |
| RF-16 | Chat encerrado automaticamente quando a consulta é marcada como "realizada" | Média |

### 3.5 Painel Administrativo

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-17 | Listagem de todos os usuários com filtros (perfil, status) | Alta |
| RF-18 | Visualização de logs de acesso a prontuários (quem, quando, qual prontuário) | Alta |
| RF-19 | Administrador NÃO tem acesso ao conteúdo do prontuário | Alta |

---

## 4. Requisitos Não Funcionais

| ID | Requisito | Categoria |
|----|-----------|-----------|
| RNF-01 | HTTPS obrigatório em todas as comunicações | Segurança |
| RNF-02 | Senhas armazenadas com bcrypt (cost factor ≥ 10) | Segurança |
| RNF-03 | Dados sensíveis de saúde criptografados em repouso (AES-256) | Segurança |
| RNF-04 | Sessões com token JWT, expiração de 1h, refresh token de 7 dias | Segurança |
| RNF-05 | Log de auditoria imutável (append-only) para acesso a prontuários | Conformidade LGPD |
| RNF-06 | Tempo de resposta ≤ 2s para operações comuns (login, listagem) | Performance |
| RNF-07 | Sistema disponível 99% do tempo durante apresentação/demo | Disponibilidade |
| RNF-08 | Código-fonte com cobertura de testes ≥ 70% nos módulos críticos | Qualidade |

---

## 5. Arquitetura do Sistema

### 5.1 Visão Geral (Diagrama de Contexto)

```
┌─────────────┐         HTTPS          ┌──────────────────────┐
│  Navegador  │ ◄─────────────────────► │   Frontend (SPA)     │
│  (Usuário)  │                         │   React / Vue        │
└─────────────┘                         └──────────┬───────────┘
                                                   │ REST API (JSON)
                                                   ▼
                                        ┌──────────────────────┐
                                        │   Backend (API)       │
                                        │   Node.js / Python    │
                                        │   + Framework Web     │
                                        └───┬──────────┬───────┘
                                            │          │
                              ┌─────────────┘          └──────────────┐
                              ▼                                       ▼
                   ┌────────────────────┐                  ┌───────────────────┐
                   │  Banco de Dados    │                  │  Serviço de Email │
                   │  PostgreSQL        │                  │  (SMTP / externo) │
                   │  (dados + audit)   │                  └───────────────────┘
                   └────────────────────┘
```

### 5.2 Stack Tecnológica (Sugestão)

| Camada | Tecnologia | Justificativa |
|--------|-----------|---------------|
| Frontend | React + TypeScript | Componentização, tipagem, ecossistema maduro |
| Backend | Node.js + Express (ou Python + FastAPI) | Produtividade para MVP, ampla documentação |
| Banco de dados | PostgreSQL | Gratuito, robusto, suporte a JSON, criptografia nativa |
| Autenticação | JWT (jsonwebtoken) + bcrypt | Padrão de mercado, stateless |
| ORM | Prisma (Node) ou SQLAlchemy (Python) | Migrations, tipagem, segurança contra SQL injection |
| Hospedagem | Railway / Render / Vercel (free tier) | Gratuito para projetos acadêmicos |
| Versionamento | Git + GitHub | Colaboração e histórico |

### 5.3 Estrutura de Camadas

```
src/
├── controllers/       # Rotas e validação de entrada
├── middleware/        # Auth (JWT), RBAC, rate limiting, audit logger
├── services/          # Lógica de negócio
├── repositories/      # Acesso a dados (queries)
├── models/            # Entidades / schemas do banco
├── utils/             # Helpers (criptografia, formatação)
└── config/            # Variáveis de ambiente, constantes
```

---

## 6. Modelo de Dados

### 6.1 Entidades Principais

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────────┐
│   Usuario    │       │    Consulta      │       │   Prontuario    │
├──────────────┤       ├──────────────────┤       ├─────────────────┤
│ id (PK)      │       │ id (PK)          │       │ id (PK)         │
│ nome         │       │ paciente_id (FK) │       │ consulta_id (FK)│
│ email        │       │ medico_id (FK)   │       │ medico_id (FK)  │
│ senha_hash   │       │ data_hora        │       │ anotacoes (enc) │
│ perfil       │       │ motivo           │       │ created_at      │
│ ativo        │       │ status           │       │ updated_at      │
│ consentimento│       │ created_at       │       └─────────────────┘
│ created_at   │       │ updated_at       │
└──────────────┘       └──────────────────┘

┌──────────────────┐       ┌──────────────────────┐
│    Mensagem      │       │    LogAuditoria      │
├──────────────────┤       ├──────────────────────┤
│ id (PK)          │       │ id (PK)              │
│ consulta_id (FK) │       │ usuario_id (FK)      │
│ remetente_id(FK) │       │ acao                 │
│ conteudo (enc)   │       │ recurso              │
│ created_at       │       │ recurso_id           │
└──────────────────┘       │ ip_address           │
                           │ timestamp            │
                           └──────────────────────┘
```

### 6.2 Enumerações

- **Perfil:** `PACIENTE`, `MEDICO`, `ADMINISTRADOR`
- **StatusConsulta:** `PENDENTE`, `CONFIRMADA`, `REALIZADA`, `CANCELADA`
- **AcaoAuditoria:** `VISUALIZOU_PRONTUARIO`, `EDITOU_PRONTUARIO`, `CRIOU_PRONTUARIO`, `ENVIOU_MENSAGEM`, `LOGIN`, `LOGOUT`

---

## 7. Controle de Acesso (RBAC)

### 7.1 Matriz de Permissões

| Recurso / Ação | Paciente | Médico | Administrador |
|----------------|----------|--------|---------------|
| Ver próprio perfil | ✅ | ✅ | ✅ |
| Editar próprio perfil | ✅ | ✅ | ✅ |
| Solicitar agendamento | ✅ | ❌ | ❌ |
| Confirmar/recusar consulta | ❌ | ✅ | ❌ |
| Ver próprias consultas | ✅ | ✅ | ❌ |
| Criar anotação de prontuário | ❌ | ✅ (seus pacientes) | ❌ |
| Ver prontuário | ✅ (próprio) | ✅ (seus pacientes) | ❌ |
| Enviar mensagem no chat | ✅ (suas consultas) | ✅ (suas consultas) | ❌ |
| Listar usuários | ❌ | ❌ | ✅ |
| Ver logs de auditoria | ❌ | ❌ | ✅ |
| Ativar/desativar conta | ❌ | ❌ | ✅ |

### 7.2 Implementação

- Middleware de autenticação valida JWT em toda requisição protegida
- Middleware de autorização verifica `perfil` do token contra regra do endpoint
- Para prontuários: query filtra por `medico_id` ou `paciente_id` conforme perfil
- Tentativa de acesso não autorizado retorna `403 Forbidden` e é logada na auditoria

---

## 8. Conformidade com a LGPD

### 8.1 Bases Legais Aplicáveis

| Dado | Base Legal | Artigo |
|------|-----------|--------|
| Dados cadastrais (nome, e-mail) | Consentimento explícito | Art. 7º, I |
| Dados sensíveis de saúde (prontuário) | Tutela da saúde por profissional habilitado | Art. 11, II, f |
| Logs de auditoria | Legítimo interesse / Obrigação legal | Art. 7º, IX / Art. 11, II, d |

### 8.2 Controles Implementados

| Controle | Descrição | Requisito LGPD |
|----------|-----------|----------------|
| Consentimento no cadastro | Checkbox obrigatório com texto legal antes de criar conta | Art. 8º |
| Finalidade específica | Dados coletados apenas para prestação do serviço médico | Art. 6º, I |
| Minimização | Apenas dados essenciais são coletados | Art. 6º, III |
| Criptografia em repouso | Campos sensíveis criptografados (AES-256) no banco | Art. 46 |
| Criptografia em trânsito | HTTPS em toda comunicação | Art. 46 |
| Trilha de auditoria | Log imutável de todo acesso a dados de saúde | Art. 37 |
| Segregação de acesso | RBAC impede acesso indevido entre perfis | Art. 46 |
| Direito de acesso | Paciente pode visualizar todos os seus dados | Art. 18, II |

---

## 9. API — Endpoints Principais

### 9.1 Autenticação

| Método | Endpoint | Descrição | Acesso |
|--------|----------|-----------|--------|
| POST | `/api/auth/register` | Cadastro de novo usuário | Público |
| POST | `/api/auth/login` | Login, retorna JWT | Público |
| POST | `/api/auth/refresh` | Renova token | Autenticado |
| POST | `/api/auth/forgot-password` | Solicita reset de senha | Público |

### 9.2 Consultas

| Método | Endpoint | Descrição | Acesso |
|--------|----------|-----------|--------|
| POST | `/api/appointments` | Paciente solicita agendamento | Paciente |
| GET | `/api/appointments` | Lista consultas do usuário logado | Paciente, Médico |
| PATCH | `/api/appointments/:id/status` | Médico confirma/recusa | Médico |
| DELETE | `/api/appointments/:id` | Cancela consulta | Paciente, Médico |

### 9.3 Prontuário

| Método | Endpoint | Descrição | Acesso |
|--------|----------|-----------|--------|
| POST | `/api/records` | Cria anotação de prontuário | Médico |
| GET | `/api/records/patient/:id` | Histórico de prontuário do paciente | Médico (vinculado), Paciente (próprio) |
| PUT | `/api/records/:id` | Edita anotação | Médico (autor) |

### 9.4 Chat

| Método | Endpoint | Descrição | Acesso |
|--------|----------|-----------|--------|
| POST | `/api/messages` | Envia mensagem | Paciente, Médico (da consulta) |
| GET | `/api/messages/appointment/:id` | Lista mensagens de uma consulta | Paciente, Médico (da consulta) |

### 9.5 Admin

| Método | Endpoint | Descrição | Acesso |
|--------|----------|-----------|--------|
| GET | `/api/admin/users` | Lista todos os usuários | Administrador |
| PATCH | `/api/admin/users/:id/status` | Ativa/desativa usuário | Administrador |
| GET | `/api/admin/audit-logs` | Lista logs de auditoria | Administrador |

---

## 10. Segurança

### 10.1 Medidas Técnicas

| Ameaça | Controle |
|--------|----------|
| SQL Injection | ORM com queries parametrizadas (nunca concatenar strings) |
| XSS | Sanitização de input + Content-Security-Policy headers |
| CSRF | Token CSRF ou SameSite cookies |
| Brute force login | Rate limiting (ex: 5 tentativas/min por IP) |
| Token roubado | Expiração curta (1h), refresh token com rotação |
| Exposição de dados em log | Nunca logar dados sensíveis (senhas, CPF, conteúdo de prontuário) |
| Acesso horizontal | Verificar `owner_id` em toda query de dados do usuário |

### 10.2 Checklist de Segurança (pré-entrega)

- [ ] Nenhum endpoint expõe dados de outro perfil sem autorização
- [ ] Senhas nunca trafegam em plain text (nem em logs)
- [ ] Variáveis sensíveis em `.env` (nunca commitadas no Git)
- [ ] Headers de segurança configurados (Helmet.js ou equivalente)
- [ ] Dependências sem vulnerabilidades conhecidas (`npm audit` / `pip audit`)

---

## 11. Diagramas de Casos de Uso

### 11.1 Paciente

```
                    ┌─────────────────────┐
                    │      Paciente       │
                    └──────────┬──────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
   ┌─────────────┐   ┌────────────────┐   ┌──────────────┐
   │  Cadastrar  │   │   Solicitar    │   │  Visualizar  │
   │  + Aceitar  │   │  Agendamento   │   │  Prontuário  │
   │Consentimento│   └────────────────┘   │   (próprio)  │
   └─────────────┘                        └──────────────┘
                               │
                               ▼
                    ┌────────────────────┐
                    │  Enviar Mensagem   │
                    │  (chat consulta)   │
                    └────────────────────┘
```

### 11.2 Médico

```
                    ┌─────────────────────┐
                    │       Médico        │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
┌─────────────────┐   ┌────────────────┐   ┌────────────────┐
│Confirmar/Recusar│   │Criar/Editar    │   │ Enviar Mensagem│
│  Agendamento    │   │ Prontuário     │   │ (chat consulta)│
└─────────────────┘   └────────────────┘   └────────────────┘
```

### 11.3 Administrador

```
                    ┌─────────────────────┐
                    │   Administrador     │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                                 ▼
   ┌───────────────────┐            ┌───────────────────┐
   │  Gerenciar Contas │            │  Visualizar Logs  │
   │  (ativar/desativ.)│            │  de Auditoria     │
   └───────────────────┘            └───────────────────┘
```

---

## 12. Plano de Testes

| Tipo | Escopo | Ferramenta Sugerida |
|------|--------|---------------------|
| Unitários | Services, utils, validators | Jest (Node) / pytest (Python) |
| Integração | Endpoints de API (CRUD, auth) | Supertest / httpx + fixtures |
| Autorização | Cada endpoint testado com cada perfil (positivo e negativo) | Mesmo framework + factories |
| Segurança (básico) | SQL injection, XSS em inputs | OWASP ZAP (scan automático) ou testes manuais |
| Manual / Exploratório | Fluxos completos E2E | Roteiro de testes documentado |

### 12.1 Cenários Críticos de Teste de Autorização

| # | Cenário | Resultado Esperado |
|---|---------|-------------------|
| 1 | Paciente A tenta ver prontuário do Paciente B | 403 Forbidden |
| 2 | Médico X tenta ver prontuário de paciente de Médico Y | 403 Forbidden |
| 3 | Administrador tenta ver conteúdo de prontuário | 403 Forbidden |
| 4 | Usuário desativado tenta fazer login | 401 Unauthorized |
| 5 | Token expirado em qualquer endpoint | 401 Unauthorized |

---

## 13. WBS — Estrutura Analítica do Projeto (com Esforço e Dependências)

**Premissa de esforço:** Equipe de 3 pessoas, dedicação parcial (~4h/dia por pessoa)

### Legenda

- **Esforço:** dias de trabalho estimados (1 dia = 4h de trabalho efetivo por pessoa)
- **Dependência:** código da(s) tarefa(s) predecessora(s) — a tarefa só começa após a predecessora estar concluída
- **Tipo dep.:** FS = Finish-to-Start (a mais comum); SS = Start-to-Start (podem rodar em paralelo após início da predecessora)
- **Responsável:** Giulia (G), Grazielle (Gz), Luana (L), Equipe (E)

---

### 13.1 Gerenciamento do Projeto

| ID | Atividade | Esforço | Dependência | Responsável | Sprint |
|----|-----------|---------|-------------|-------------|--------|
| 1.1.1 | Elaboração da Carta de Projeto | 2d | — | L | 0 |
| 1.1.2 | Levantamento e priorização de requisitos | 3d | 1.1.1 | E | 0 |
| 1.1.3 | Elaboração do Design Document | 3d | 1.1.2 | E | 0 |
| 1.1.4 | Planejamento de sprints (backlog inicial) | 1d | 1.1.3 | L | 0 |
| 1.1.5 | Acompanhamento semanal (status/retrospectiva) | 0.5d/semana | 1.1.4 (SS) | L | Contínuo |
| 1.1.6 | Gestão de riscos (monitoramento) | 0.5d/semana | 1.1.4 (SS) | L | Contínuo |
| 1.1.7 | Encerramento e lições aprendidas | 1d | Todas | E | 5 |

**Subtotal:** ~12d (distribuídos ao longo do projeto)

---

### 13.2 Infraestrutura e Setup

| ID | Atividade | Esforço | Dependência | Responsável | Sprint |
|----|-----------|---------|-------------|-------------|--------|
| 1.2.1 | Criação do repositório Git + estrutura de pastas | 0.5d | 1.1.3 | G | 0 |
| 1.2.2 | Decisão final de stack (Node vs Python, ORM, etc.) | 1d | 1.1.3 | E | 0 |
| 1.2.3 | Setup do projeto backend (boilerplate, linter, scripts) | 1d | 1.2.1, 1.2.2 | Gz | 0 |
| 1.2.4 | Setup do projeto frontend (React + rotas básicas) | 1d | 1.2.1, 1.2.2 | G | 0 |
| 1.2.5 | Configuração do banco de dados (PostgreSQL + migrations) | 1d | 1.2.3 | Gz | 0 |
| 1.2.6 | Configuração do ambiente de hospedagem (deploy de teste) | 1d | 1.2.3, 1.2.4 | L | 0 |
| 1.2.7 | Configuração de variáveis de ambiente (.env + .env.example) | 0.5d | 1.2.3 | Gz | 0 |

**Subtotal:** ~6d  
**Entrega:** Ambiente funcional com "Hello World" rodando em frontend + backend + banco.

---

### 13.3 Autenticação e Controle de Acesso

| ID | Atividade | Esforço | Dependência | Responsável | Sprint |
|----|-----------|---------|-------------|-------------|--------|
| 1.3.1 | Modelagem de dados — tabela `Usuario` (migration) | 1d | 1.2.5 | Gz | 1 |
| 1.3.2 | API: Cadastro de usuário (com validação de perfil) | 1.5d | 1.3.1 | Gz | 1 |
| 1.3.3 | API: Login com JWT + bcrypt | 1.5d | 1.3.1 | Gz | 1 |
| 1.3.4 | Middleware de autenticação (validação de token) | 1d | 1.3.3 | Gz | 1 |
| 1.3.5 | Middleware de autorização (RBAC — verificação de perfil) | 1.5d | 1.3.4 | L | 1 |
| 1.3.6 | API: Refresh token + expiração de sessão | 1d | 1.3.3 | Gz | 1 |
| 1.3.7 | API: Recuperação de senha via e-mail | 1.5d | 1.3.3 | L | 1 |
| 1.3.8 | Frontend: Telas de login, cadastro e recuperação de senha | 2d | 1.3.2, 1.3.3 | G | 1 |
| 1.3.9 | Testes unitários e de integração (auth) | 2d | 1.3.5 | E | 1 |

**Subtotal:** ~13d  
**Entrega:** Usuário consegue se cadastrar, logar e acessar rotas protegidas conforme seu perfil.

---

### 13.4 Conformidade LGPD

| ID | Atividade | Esforço | Dependência | Responsável | Sprint |
|----|-----------|---------|-------------|-------------|--------|
| 1.4.1 | Definição do texto do Termo de Consentimento | 1d | 1.1.2 | L | 1 |
| 1.4.2 | Implementação do aceite obrigatório no cadastro (backend + frontend) | 1d | 1.3.2, 1.4.1 | G | 1 |
| 1.4.3 | Implementação de criptografia AES-256 para campos sensíveis | 2d | 1.2.5 | Gz | 1 |
| 1.4.4 | Modelagem + implementação da tabela `LogAuditoria` | 1.5d | 1.2.5 | L | 2 |
| 1.4.5 | Middleware de auditoria (log automático a cada acesso a prontuário) | 1.5d | 1.4.4, 1.3.4 | L | 3 |
| 1.4.6 | Documentação das bases legais (seção no design doc) | 0.5d | 1.4.1 | L | 1 |
| 1.4.7 | Testes de autorização cruzada (5 cenários críticos) | 2d | 1.6.4, 1.4.5 | E | 3 |

**Subtotal:** ~9.5d  
**Entrega:** Consentimento coletado, dados criptografados, log de auditoria funcional.

---

### 13.5 Agendamento de Consultas

| ID | Atividade | Esforço | Dependência | Responsável | Sprint |
|----|-----------|---------|-------------|-------------|--------|
| 1.5.1 | Modelagem de dados — tabela `Consulta` (migration) | 1d | 1.3.1 | Gz | 2 |
| 1.5.2 | API: Paciente solicita agendamento | 1.5d | 1.5.1, 1.3.5 | Gz | 2 |
| 1.5.3 | API: Médico confirma/recusa consulta | 1d | 1.5.1, 1.3.5 | L | 2 |
| 1.5.4 | API: Listar consultas do usuário logado (com filtros) | 1d | 1.5.1, 1.3.4 | L | 2 |
| 1.5.5 | API: Cancelamento de consulta (ambas as partes) | 1d | 1.5.2 | Gz | 2 |
| 1.5.6 | Frontend: Tela de agendamento (Paciente) | 2d | 1.5.2 | G | 2 |
| 1.5.7 | Frontend: Painel de consultas (Médico — pendentes + confirmadas) | 2d | 1.5.3, 1.5.4 | G | 2 |
| 1.5.8 | Testes unitários e de integração (agendamento) | 1.5d | 1.5.5 | E | 2 |

**Subtotal:** ~11d  
**Entrega:** Fluxo completo de agendamento funcionando para ambos os perfis.

---

### 13.6 Prontuário Eletrônico

| ID | Atividade | Esforço | Dependência | Responsável | Sprint |
|----|-----------|---------|-------------|-------------|--------|
| 1.6.1 | Modelagem de dados — tabela `Prontuario` (migration) | 1d | 1.5.1 | Gz | 3 |
| 1.6.2 | API: Criar anotação de prontuário (Médico) | 1.5d | 1.6.1, 1.3.5, 1.4.3 | L | 3 |
| 1.6.3 | API: Editar anotação (somente Médico autor) | 1d | 1.6.2 | L | 3 |
| 1.6.4 | API: Visualizar histórico (Médico vinculado / Paciente próprio) | 1.5d | 1.6.1, 1.3.5 | Gz | 3 |
| 1.6.5 | Integração com log de auditoria (cada acesso gera registro) | 1d | 1.6.4, 1.4.5 | L | 3 |
| 1.6.6 | Frontend: Tela de prontuário (Médico — criar/editar/histórico) | 2.5d | 1.6.2, 1.6.3 | G | 3 |
| 1.6.7 | Frontend: Visualização de histórico (Paciente — somente leitura) | 1.5d | 1.6.4 | G | 3 |
| 1.6.8 | Testes unitários e de integração (prontuário + auditoria) | 2d | 1.6.5 | E | 3 |

**Subtotal:** ~12d  
**Entrega:** Prontuário funcional com acesso segregado e auditoria ativa.

---

### 13.7 Chat Assíncrono

| ID | Atividade | Esforço | Dependência | Responsável | Sprint |
|----|-----------|---------|-------------|-------------|--------|
| 1.7.1 | Modelagem de dados — tabela `Mensagem` (migration) | 0.5d | 1.5.1 | Gz | 4 |
| 1.7.2 | API: Enviar mensagem (vinculada a consulta confirmada) | 1.5d | 1.7.1, 1.3.5 | L | 4 |
| 1.7.3 | API: Listar mensagens de uma consulta | 1d | 1.7.1 | L | 4 |
| 1.7.4 | Regra de negócio: Chat encerra ao marcar consulta como "realizada" | 0.5d | 1.7.2, 1.5.3 | Gz | 4 |
| 1.7.5 | Frontend: Interface de chat (caixa de mensagens + envio) | 2.5d | 1.7.2, 1.7.3 | G | 4 |
| 1.7.6 | Testes unitários e de integração (chat) | 1d | 1.7.4 | E | 4 |

**Subtotal:** ~7d  
**Entrega:** Chat texto funcional dentro de consultas confirmadas.

---

### 13.8 Painel Administrativo

| ID | Atividade | Esforço | Dependência | Responsável | Sprint |
|----|-----------|---------|-------------|-------------|--------|
| 1.8.1 | API: Listar usuários com filtros (perfil, status) | 1d | 1.3.5 | Gz | 4 |
| 1.8.2 | API: Ativar/desativar conta de usuário | 1d | 1.8.1 | Gz | 4 |
| 1.8.3 | API: Consultar logs de auditoria (paginado, com filtros) | 1d | 1.4.4, 1.3.5 | L | 4 |
| 1.8.4 | Validação: Admin NÃO acessa conteúdo de prontuário | 0.5d | 1.6.4, 1.3.5 | L | 4 |
| 1.8.5 | Frontend: Painel admin (listagem de usuários + logs) | 2d | 1.8.1, 1.8.3 | G | 4 |
| 1.8.6 | Testes de autorização (admin não vê prontuário) | 1d | 1.8.4 | E | 4 |

**Subtotal:** ~6.5d  
**Entrega:** Administrador gerencia contas e visualiza auditoria sem acesso a dados clínicos.

---

### 13.9 Segurança (Hardening)

| ID | Atividade | Esforço | Dependência | Responsável | Sprint |
|----|-----------|---------|-------------|-------------|--------|
| 1.9.1 | Configuração de HTTPS no ambiente de hospedagem | 0.5d | 1.2.6 | L | 2 |
| 1.9.2 | Headers de segurança (Helmet.js / equivalente + CSP) | 0.5d | 1.2.3 | Gz | 2 |
| 1.9.3 | Rate limiting em endpoints de login | 0.5d | 1.3.3 | Gz | 2 |
| 1.9.4 | Sanitização de inputs (prevenção XSS) | 1d | 1.3.2 | L | 2 |
| 1.9.5 | Validação de proteção contra SQL injection (ORM review) | 0.5d | 1.5.2, 1.6.2 | Gz | 3 |
| 1.9.6 | Auditoria de dependências (npm audit / pip audit) | 0.5d | 1.2.3 | Gz | 5 |
| 1.9.7 | Revisão final de segurança (checklist OWASP completo) | 1.5d | Todos os módulos | E | 5 |

**Subtotal:** ~5.5d  
**Entrega:** Aplicação protegida contra as principais ameaças do OWASP Top 10.

---

### 13.10 Testes e Qualidade

| ID | Atividade | Esforço | Dependência | Responsável | Sprint |
|----|-----------|---------|-------------|-------------|--------|
| 1.10.1 | Configuração do framework de testes (Jest/pytest + scripts) | 0.5d | 1.2.3 | Gz | 1 |
| 1.10.2 | Testes unitários incrementais (ao longo do projeto) | ~1d/sprint | Cada módulo | E | Contínuo |
| 1.10.3 | Testes de integração de API (E2E de cada fluxo) | 2d | 1.7.4, 1.8.4 | E | 5 |
| 1.10.4 | Teste exploratório manual (roteiro de cenários) | 1.5d | 1.10.3 | E | 5 |
| 1.10.5 | Correção de bugs encontrados (buffer) | 2d | 1.10.4 | E | 5 |

**Subtotal:** ~10d (distribuídos)  
**Entrega:** Cobertura ≥ 70% nos módulos críticos, zero bugs críticos abertos.

---

### 13.11 Documentação e Entrega Final

| ID | Atividade | Esforço | Dependência | Responsável | Sprint |
|----|-----------|---------|-------------|-------------|--------|
| 1.11.1 | Atualização final do Design Document | 1d | Todos os módulos | L | 5 |
| 1.11.2 | Diagrama de casos de uso (UML) | 1d | 1.1.2 | G | 0–1 |
| 1.11.3 | Diagrama ER do modelo de dados | 1d | 1.6.1 | Gz | 3 |
| 1.11.4 | README do repositório (como instalar e rodar) | 1d | 1.2.6 | Gz | 5 |
| 1.11.5 | Documentação de API (Swagger ou manual) | 1.5d | 1.8.3 | L | 5 |
| 1.11.6 | Preparação da apresentação (slides + demo) | 2d | 1.10.5 | E | 5 |
| 1.11.7 | Apresentação ao professor | 0.5d | 1.11.6 | E | 5 |

**Subtotal:** ~8d  
**Entrega:** Projeto documentado e apresentado.

---

### 13.12 Resumo de Esforço Total

| Pacote | Esforço Estimado | Sprint Principal |
|--------|-----------------|-----------------|
| 1.1 Gerenciamento | ~12d | Contínuo |
| 1.2 Infraestrutura | ~6d | Sprint 0 |
| 1.3 Autenticação | ~13d | Sprint 1 |
| 1.4 LGPD | ~9.5d | Sprint 1–3 |
| 1.5 Agendamento | ~11d | Sprint 2 |
| 1.6 Prontuário | ~12d | Sprint 3 |
| 1.7 Chat | ~7d | Sprint 4 |
| 1.8 Painel Admin | ~6.5d | Sprint 4 |
| 1.9 Segurança | ~5.5d | Sprint 2–5 |
| 1.10 Testes | ~10d | Contínuo |
| 1.11 Documentação | ~8d | Sprint 0–5 |
| **TOTAL** | **~101 dias-pessoa** | **~9–10 semanas** |

**Com 3 pessoas a 4h/dia → ~34 dias úteis por pessoa → ~7 semanas calendário**  
(Inclui buffer para imprevistos distribuído nos pacotes 1.10 e 1.1)

---

### 13.13 Grafo de Dependências (Caminho Crítico)

```
1.1.1 → 1.1.2 → 1.1.3 → 1.2.1 → 1.2.3 → 1.2.5 → 1.3.1 → 1.3.3 → 1.3.4 → 1.3.5
                                                                                    │
                    ┌───────────────────────────────────────────────────────────────┘
                    ▼
               1.5.1 → 1.5.2 → 1.5.6 (frontend)
                  │
                  ▼
               1.6.1 → 1.6.2 → 1.6.4 → 1.6.5 → 1.4.7 (testes LGPD)
                                    │
                                    ▼
                               1.7.1 → 1.7.2 → 1.7.5 (frontend chat)
                                                          │
                                                          ▼
                                                    1.10.3 → 1.10.4 → 1.10.5
                                                                          │
                                                                          ▼
                                                                    1.11.6 → 1.11.7
```

**Caminho crítico estimado:** ~45 dias úteis (com paralelização entre membros)  
**Atividades paralelizáveis:** Frontend (G) roda em paralelo ao backend (Gz/L) a partir de cada módulo.

---

### 13.14 Matriz de Responsabilidades (RACI simplificada)

| Pacote | Giulia (G) | Grazielle (Gz) | Luana (L) |
|--------|-----------|----------------|-----------|
| 1.1 Gerenciamento | I | I | **R** |
| 1.2 Infraestrutura | Frontend | Backend/DB | Deploy |
| 1.3 Autenticação | Frontend | **R** (backend) | RBAC middleware |
| 1.4 LGPD | Consentimento UI | Criptografia | **R** (auditoria + doc) |
| 1.5 Agendamento | **R** (frontend) | Backend | Backend |
| 1.6 Prontuário | **R** (frontend) | Backend | **R** (backend + audit) |
| 1.7 Chat | **R** (frontend) | Backend | Backend |
| 1.8 Painel Admin | **R** (frontend) | Backend | Backend |
| 1.9 Segurança | — | **R** (técnico) | Revisão |
| 1.10 Testes | E2E manual | Unitários/Integração | Autorização |
| 1.11 Documentação | Diagramas UML | ER + README | Design doc + API |

**R** = Responsável principal | **I** = Informada

---

### 13.15 Cronograma por Sprint

| Sprint | Duração | Pacotes da WBS | Entrega Principal |
|--------|---------|----------------|-------------------|
| Sprint 0 | 1 semana | 1.1 (parcial) + 1.2 | Ambiente funcional, design aprovado |
| Sprint 1 | 2 semanas | 1.3 + 1.4 (parcial) | Auth completa + consentimento LGPD |
| Sprint 2 | 2 semanas | 1.5 + 1.9 (parcial) | Agendamento funcional + hardening básico |
| Sprint 3 | 2 semanas | 1.6 + 1.4 (auditoria) | Prontuário + trilha de auditoria |
| Sprint 4 | 1–2 semanas | 1.7 + 1.8 | Chat + painel admin |
| Sprint 5 | 1 semana | 1.9 (revisão) + 1.10 + 1.11 | Testes finais, docs, apresentação |

---

## 14. Decisões em Aberto

| # | Decisão | Responsável | Prazo |
|---|---------|-------------|-------|
| 1 | Escolha final de stack backend (Node vs Python) | Equipe | Sprint 0 |
| 2 | Provedor de hospedagem para demo | Equipe | Sprint 0 |
| 3 | Necessidade de WebSocket para chat ou polling suficiente? | Equipe | Sprint 3 |
| 4 | Escopo exato do "termo de consentimento" (texto jurídico simplificado) | Equipe + Professor | Sprint 1 |

---

## 15. Referências

- LGPD — Lei nº 13.709/2018: [planalto.gov.br](http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- OWASP Top 10: [owasp.org](https://owasp.org/www-project-top-ten/)
- JWT Best Practices: [RFC 8725](https://datatracker.ietf.org/doc/html/rfc8725)
- Carta de Projeto TeleMed+ (este mesmo grupo)
- Trello do projeto: https://trello.com/b/jd154Gj2/telemedicina-gest%C3%A3o-de-projeto
