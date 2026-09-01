# Design Document — TeleMed+ (Prontuário Eletrônico Simplificado)

**Versão:** 1.1  
**Data:** 01/09/2026
**Autoras:** Giulia Mattedi, Grazielle Almeida, Luana Macedo  
**Disciplina:** Gestão de Projetos — Prof. Mario Farah  

---

## 1. Resumo Executivo

O TeleMed+ é um sistema web para gestão de prontuários eletrônicos simplificados, com segurança e conformidade com a LGPD. O sistema atende três perfis de usuário — Paciente, Médico e Administrador — com controle de acesso baseado em papéis (RBAC) e trilha de auditoria de acesso aos dados clínicos.

> **Ajuste de escopo v1.1:** foram removidos os módulos de **Agendamento**, **Chat assíncrono** e **Termo de Consentimento no cadastro**.

---

## 2. Contexto e Motivação

Clínicas de pequeno porte e consultórios independentes frequentemente utilizam ferramentas fragmentadas (planilhas, prontuários em papel, sistemas sem segregação de acesso) para registro clínico. Isso resulta em:

- Exposição de dados sensíveis de saúde
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
| RF-04 | Administrador pode ativar/desativar contas | Alta |

### 3.2 Prontuário Eletrônico

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-05 | Médico cria/edita anotações clínicas vinculadas a um atendimento | Alta |
| RF-06 | Histórico completo de atendimentos e anotações por paciente | Alta |
| RF-07 | Paciente visualiza seu próprio histórico (sem editar anotações médicas) | Alta |
| RF-08 | Médico só acessa prontuários de pacientes vinculados a ele | Alta |

### 3.3 Painel Administrativo

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-09 | Listagem de todos os usuários com filtros (perfil, status) | Alta |
| RF-10 | Visualização de logs de acesso a prontuários (quem, quando, qual prontuário) | Alta |
| RF-11 | Administrador NÃO tem acesso ao conteúdo do prontuário | Alta |

---

## 4. Requisitos Não Funcionais

| ID | Requisito | Categoria |
|----|-----------|-----------|
| RNF-01 | HTTPS obrigatório em todas as comunicações | Segurança |
| RNF-02 | Senhas armazenadas com bcrypt (cost factor >= 10) | Segurança |
| RNF-03 | Dados sensíveis de saúde criptografados em repouso (AES-256) | Segurança |
| RNF-04 | Sessões com token JWT, expiração de 1h, refresh token de 7 dias | Segurança |
| RNF-05 | Log de auditoria imutável (append-only) para acesso a prontuários | Conformidade LGPD |
| RNF-06 | Tempo de resposta <= 2s para operações comuns (login, listagem) | Performance |
| RNF-07 | Sistema disponível 99% do tempo durante apresentação/demo | Disponibilidade |
| RNF-08 | Cobertura de testes >= 70% nos módulos críticos | Qualidade |

---

## 5. Arquitetura do Sistema

### 5.1 Visão Geral (Diagrama de Contexto)

```text
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
| Backend | Node.js + Express (ou Python + FastAPI) | Produtividade para MVP |
| Banco de dados | PostgreSQL | Robusto, gratuito, suporte a JSON |
| Autenticação | JWT + bcrypt | Padrão de mercado |
| ORM | Prisma (Node) ou SQLAlchemy (Python) | Migrations e segurança |
| Hospedagem | Railway / Render / Vercel | Free tier acadêmico |
| Versionamento | Git + GitHub | Colaboração e histórico |

### 5.3 Estrutura de Camadas

```text
src/
├── controllers/
├── middleware/        # Auth (JWT), RBAC, audit logger
├── services/
├── repositories/
├── models/
├── utils/
└── config/
```

---

## 6. Modelo de Dados

### 6.1 Entidades Principais

```text
┌──────────────┐       ┌──────────────────┐       ┌─────────────────┐
│   Usuario    │       │   Atendimento    │       │   Prontuario    │
├──────────────┤       ├──────────────────┤       ├─────────────────┤
│ id (PK)      │       │ id (PK)          │       │ id (PK)         │
│ nome         │       │ paciente_id (FK) │       │ atendimento_id  │
│ email        │       │ medico_id (FK)   │       │ medico_id (FK)  │
│ senha_hash   │       │ data_hora        │       │ anotacoes (enc) │
│ perfil       │       │ observacoes      │       │ created_at      │
│ ativo        │       │ status           │       │ updated_at      │
│ created_at   │       │ created_at       │       └─────────────────┘
└──────────────┘       │ updated_at       │
                       └──────────────────┘

                    ┌──────────────────────┐
                    │    LogAuditoria      │
                    ├──────────────────────┤
                    │ id (PK)              │
                    │ usuario_id (FK)      │
                    │ acao                 │
                    │ recurso              │
                    │ recurso_id           │
                    │ ip_address           │
                    │ timestamp            │
                    └──────────────────────┘
```

### 6.2 Enumerações

- **Perfil:** `PACIENTE`, `MEDICO`, `ADMINISTRADOR`
- **StatusAtendimento:** `ABERTO`, `FINALIZADO`, `ARQUIVADO`
- **AcaoAuditoria:** `VISUALIZOU_PRONTUARIO`, `EDITOU_PRONTUARIO`, `CRIOU_PRONTUARIO`, `LOGIN`, `LOGOUT`

---

## 7. Controle de Acesso (RBAC)

### 7.1 Matriz de Permissões

| Recurso / Ação | Paciente | Médico | Administrador |
|----------------|----------|--------|---------------|
| Ver próprio perfil | ✅ | ✅ | ✅ |
| Editar próprio perfil | ✅ | ✅ | ✅ |
| Ver próprio histórico clínico | ✅ | ❌ | ❌ |
| Criar anotação de prontuário | ❌ | ✅ (seus pacientes) | ❌ |
| Editar anotação de prontuário | ❌ | ✅ (autor) | ❌ |
| Ver prontuário | ✅ (próprio) | ✅ (seus pacientes) | ❌ |
| Listar usuários | ❌ | ❌ | ✅ |
| Ver logs de auditoria | ❌ | ❌ | ✅ |
| Ativar/desativar conta | ❌ | ❌ | ✅ |

### 7.2 Implementação

- Middleware de autenticação valida JWT
- Middleware de autorização valida `perfil` por endpoint
- Filtro de acesso por `medico_id`/`paciente_id` nas queries clínicas
- Acesso negado retorna `403` e gera log de auditoria

---

## 8. Conformidade com a LGPD

### 8.1 Bases Legais Aplicáveis

| Dado | Base Legal | Artigo |
|------|-----------|--------|
| Dados cadastrais (nome, e-mail) | Execução de contrato/procedimentos preliminares | Art. 7º, V |
| Dados sensíveis de saúde (prontuário) | Tutela da saúde por profissional habilitado | Art. 11, II, f |
| Logs de auditoria | Legítimo interesse / obrigação legal | Art. 7º, IX / Art. 11, II, d |

### 8.2 Controles Implementados

| Controle | Descrição | Requisito LGPD |
|----------|-----------|----------------|
| Finalidade específica | Dados usados apenas para prestação de serviço clínico | Art. 6º, I |
| Minimização | Coleta apenas de dados essenciais | Art. 6º, III |
| Criptografia em repouso | Campos sensíveis com AES-256 | Art. 46 |
| Criptografia em trânsito | HTTPS em toda comunicação | Art. 46 |
| Trilha de auditoria | Log imutável de acesso a dados de saúde | Art. 37 |
| Segregação de acesso | RBAC entre perfis | Art. 46 |
| Direito de acesso | Paciente visualiza seus dados | Art. 18, II |

---

## 9. API — Endpoints Principais

### 9.1 Autenticação

| Método | Endpoint | Descrição | Acesso |
|--------|----------|-----------|--------|
| POST | `/api/auth/register` | Cadastro de usuário | Público |
| POST | `/api/auth/login` | Login e JWT | Público |
| POST | `/api/auth/refresh` | Renova token | Autenticado |
| POST | `/api/auth/forgot-password` | Solicita reset de senha | Público |

### 9.2 Prontuário

| Método | Endpoint | Descrição | Acesso |
|--------|----------|-----------|--------|
| POST | `/api/records` | Cria anotação de prontuário | Médico |
| GET | `/api/records/patient/:id` | Histórico do paciente | Médico vinculado / Paciente próprio |
| PUT | `/api/records/:id` | Edita anotação | Médico autor |

### 9.3 Admin

| Método | Endpoint | Descrição | Acesso |
|--------|----------|-----------|--------|
| GET | `/api/admin/users` | Lista usuários | Administrador |
| PATCH | `/api/admin/users/:id/status` | Ativa/desativa usuário | Administrador |
| GET | `/api/admin/audit-logs` | Lista logs de auditoria | Administrador |

---

## 10. Segurança

### 10.1 Medidas Técnicas

| Ameaça | Controle |
|--------|----------|
| SQL Injection | ORM + queries parametrizadas |
| XSS | Sanitização de input + CSP |
| CSRF | SameSite/CSRF token |
| Brute force login | Rate limiting |
| Token roubado | Expiração curta + refresh com rotação |
| Exposição em logs | Não logar dados sensíveis |
| Acesso horizontal | Verificação de ownership em queries |

### 10.2 Checklist de Segurança (pré-entrega)

- [ ] Nenhum endpoint expõe dados de outro perfil
- [ ] Senhas nunca aparecem em log
- [ ] Segredos em `.env` (não versionados)
- [ ] Headers de segurança configurados
- [ ] Dependências sem vulnerabilidades conhecidas

---

## 11. Diagramas de Casos de Uso

### 11.1 Paciente

```text
                    ┌─────────────────────┐
                    │      Paciente       │
                    └──────────┬──────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
   ┌─────────────┐   ┌────────────────┐   ┌──────────────┐
   │  Cadastrar  │   │   Fazer Login  │   │  Visualizar  │
   │             │   │                │   │ Prontuário   │
   └─────────────┘   └────────────────┘   │  (próprio)   │
                                           └──────────────┘
```

### 11.2 Médico

```text
                    ┌─────────────────────┐
                    │       Médico        │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
┌─────────────────┐   ┌────────────────┐   ┌────────────────┐
│ Ver pacientes   │   │ Criar anotação │   │ Editar anotação│
│ vinculados      │   │ de prontuário  │   │ de prontuário  │
└─────────────────┘   └────────────────┘   └────────────────┘
```

### 11.3 Administrador

```text
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
| Unitários | Services, utils, validators | Jest / pytest |
| Integração | Endpoints de auth, prontuário e admin | Supertest / httpx |
| Autorização | Testes por perfil (positivo/negativo) | Mesmo framework + factories |
| Segurança | SQLi, XSS e hardening básico | OWASP ZAP/manual |
| Manual / Exploratório | Fluxos E2E | Roteiro documentado |

### 12.1 Cenários Críticos de Autorização

| # | Cenário | Resultado Esperado |
|---|---------|-------------------|
| 1 | Paciente A tenta ver prontuário do Paciente B | 403 Forbidden |
| 2 | Médico X tenta ver prontuário de paciente não vinculado | 403 Forbidden |
| 3 | Administrador tenta ver conteúdo de prontuário | 403 Forbidden |
| 4 | Usuário desativado tenta login | 401 Unauthorized |
| 5 | Token expirado em endpoint protegido | 401 Unauthorized |

---

## 13. WBS — Estrutura Analítica do Projeto (escopo revisado)

### 13.1 Resumo de Esforço Total

| Pacote | Esforço Estimado | Sprint Principal |
|--------|------------------|-----------------|
| 1.1 Gerenciamento | ~12d | Contínuo |
| 1.2 Infraestrutura | ~6d | Sprint 0 |
| 1.3 Autenticação e RBAC | ~13d | Sprint 1 |
| 1.4 LGPD (sem termo de consentimento) | ~7d | Sprint 1-3 |
| 1.5 Prontuário Eletrônico | ~12d | Sprint 2-3 |
| 1.6 Painel Administrativo | ~6.5d | Sprint 4 |
| 1.7 Segurança (Hardening) | ~5.5d | Sprint 2-5 |
| 1.8 Testes e Qualidade | ~10d | Contínuo |
| 1.9 Documentação e Entrega | ~8d | Sprint 0-5 |
| **TOTAL** | **~80 dias-pessoa** | **~7-8 semanas** |

> **Removidos do escopo:** antigo pacote `Agendamento` (~11d), antigo pacote `Chat` (~7d), e atividades de consentimento LGPD (~2.5d).

### 13.2 Cronograma por Sprint (revisado)

| Sprint | Duração | Pacotes da WBS | Entrega Principal |
|--------|---------|----------------|-------------------|
| Sprint 0 | 1 semana | 1.1 + 1.2 | Ambiente funcional e design aprovado |
| Sprint 1 | 2 semanas | 1.3 + 1.4 (parcial) | Auth + RBAC + base LGPD técnica |
| Sprint 2 | 2 semanas | 1.5 + 1.7 (parcial) | Núcleo de prontuário funcional |
| Sprint 3 | 2 semanas | 1.5 (final) + 1.4 (auditoria) | Prontuário completo + trilha de auditoria |
| Sprint 4 | 1 semana | 1.6 | Painel admin finalizado |
| Sprint 5 | 1 semana | 1.7 (revisão) + 1.8 + 1.9 | Hardening, testes finais, docs e apresentação |

### 13.3 Caminho Crítico (revisado)

```text
1.1.1 → 1.1.2 → 1.1.3 → 1.2.1 → 1.2.3 → 1.2.5 → 1.3.1 → 1.3.3 → 1.3.4 → 1.3.5
                                                                                  │
                                                                                  ▼
                                                                            1.5.1 → 1.5.2 → 1.5.4 → 1.4.5
                                                                                                      │
                                                                                                      ▼
                                                                                                1.6.3 → 1.8.3 → 1.8.4 → 1.8.5
                                                                                                                        │
                                                                                                                        ▼
                                                                                                                  1.9.6 → 1.9.7
```

---

## 14. Decisões em Aberto

| # | Decisão | Responsável | Prazo |
|---|---------|-------------|-------|
| 1 | Escolha final de stack backend (Node vs Python) | Equipe | Sprint 0 |
| 2 | Provedor de hospedagem para demo | Equipe | Sprint 0 |
| 3 | Escopo de campos sensíveis com criptografia AES-256 | Equipe | Sprint 1 |
| 4 | Política de retenção de logs de auditoria | Equipe + Professor | Sprint 2 |

---

## 15. Referências

- LGPD — Lei nº 13.709/2018: [planalto.gov.br](http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)  
- OWASP Top 10: [owasp.org](https://owasp.org/www-project-top-ten/)  
- JWT Best Practices: [RFC 8725](https://datatracker.ietf.org/doc/html/rfc8725)  
- Carta de Projeto TeleMed+  
- Trello do projeto: [https://trello.com/b/jd154Gj2/telemedicina-gest%C3%A3o-de-projeto](https://trello.com/b/jd154Gj2/telemedicina-gest%C3%A3o-de-projeto)
