## Ferramentas de Backend - Hospital

Use estes endpoints para informacoes dinamicas. Nunca invente horarios, medicos,
especialidades, agendamentos ou cancelamentos.

### Contexto de telefone

- Sempre use o telefone do paciente vindo do contexto do WhatsApp/OpenClaw.
- Para endpoints que exigem header, envie:
  - `X-Patient-Phone: <telefone_do_whatsapp>`

### Endpoints e quando usar

1) Verificar se paciente ja existe
- `GET /hospital/patients/by-phone/{telefone}`
- Use sempre no inicio de fluxos de agendamento/cancelamento.

2) Cadastrar paciente
- `POST /hospital/patients` (header `X-Patient-Phone`)
- Use quando nao encontrar paciente no passo 1.
- Coletar antes: `nome_completo`, `cpf`, `data_nascimento`.
- O telefone NAO vai no body.

3) Criar/atualizar convenio (se paciente escolher convenio)
- `POST /hospital/insurance`
- Coletar: `nome` do convenio e `carteirinha_id`.
- Opcional: `data_de_expiracao`.
- Chame antes de cadastrar/atualizar paciente com carteirinha.

4) Opcoes para lista de botoes no WhatsApp
- `GET /hospital/calendar/specialties`
- `GET /hospital/calendar/doctors?specialty_id=...`
- `GET /hospital/calendar/slots?data=YYYY-MM-DD&periodo=morning|afternoon|evening&specialty_id=...&doctor_id=...`
- Use para montar selecao guiada (sem pedir nome de medico digitado livre).

5) Agendar consulta/exame
- `POST /hospital/appointments`
- Body:
  - `appointment_type`: `consulta` ou `exame`
  - `patient_id`
  - `agenda_id` (vem de `calendar/slots`)
  - `status`: default `agendada`

6) Listar agendamentos do paciente (para cancelamento com botoes)
- `GET /hospital/appointments/my?appointment_type=consulta|exame` (header `X-Patient-Phone`)
- Use para mostrar opcoes de cancelamento sem pedir ID manual.

7) Cancelar agendamento
- `POST /hospital/appointments/cancel`
- Body:
  - `appointment_type`: `consulta` ou `exame`
  - `appointment_id`
  - `status`: `cancelada`

### Fluxo obrigatorio - AGENDAR CONSULTA

1. Detectar intencao de agendamento.
2. Buscar paciente por telefone.
3. Se nao existir:
   - perguntar dados cadastrais
   - perguntar forma de pagamento com botoes:
     - "Particular"
     - "Convenio"
   - se "Convenio", pedir `nome` e `carteirinha_id`, chamar `/hospital/insurance`
   - cadastrar paciente em `/hospital/patients`
4. Mostrar filtros com botoes:
   - especialidade
   - medico (opcional)
   - periodo
   - data
5. Buscar slots em `/hospital/calendar/slots`.
6. Mostrar slots com botoes.
7. Confirmar com paciente.
8. Chamar `/hospital/appointments`.
9. Se retornar conflito de horario (409), informar indisponibilidade e oferecer
   nova selecao de slots.

### Fluxo obrigatorio - CANCELAR CONSULTA/EXAME

1. Detectar intencao de cancelamento.
2. Buscar paciente por telefone.
3. Se nao existir, informar que nao ha cadastro para esse numero.
4. Listar agendamentos com `/hospital/appointments/my`.
5. Exibir agendamentos em botoes/lista.
6. Confirmar cancelamento.
7. Chamar `/hospital/appointments/cancel`.

### Regras de UX no WhatsApp

- Preferir botoes/listas em vez de texto livre para:
  - forma de pagamento (Particular/Convenio)
  - especialidade
  - medico
  - periodo
  - escolha de horario
  - escolha de agendamento para cancelar
- Pedir digitacao livre somente quando necessario (CPF, nome, data nascimento,
  numero da carteirinha, etc.).
