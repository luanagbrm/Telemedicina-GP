"""SQL templates used by hospital endpoints.

Replace each query string with your real SQL. Keep named placeholders
(ex: :telefone, :patient_id) aligned with the params built in
`app/services/hospital_service.py`.
"""

# 1) Check if the patient already exists by phone.
GET_PATIENT_BY_PHONE_SQL = """
SELECT id, nome_completo, telefone, cpf, data_nascimento, email, carteirinha_id
FROM paciente
WHERE telefone = :telefone
LIMIT 1;
"""

# 2) Create a new patient when chatbot collects all info.
CREATE_PATIENT_SQL = """
INSERT INTO paciente (nome_completo, telefone, cpf, data_nascimento, email, carteirinha_id)
VALUES (:nome_completo, :telefone, :cpf, :data_nascimento, :email, :carteirinha_id);
"""

# 3) Schedule a medical consultation.
CREATE_CONSULTA_SQL = """
INSERT INTO consulta (id_paciente, id_agenda, status)
VALUES (:patient_id, :agenda_id, :status);
"""

# 4) Schedule an exam.
CREATE_EXAME_SQL = """
INSERT INTO agendamento_exame (id_paciente, id_agenda_exame, status)
VALUES (:patient_id, :agenda_id, :status);
"""

# 5) Cancel a scheduled consultation.
CANCEL_CONSULTA_SQL = """
UPDATE consulta
SET status = :status
WHERE id = :appointment_id;
"""

# 6) Cancel a scheduled exam.
CANCEL_EXAME_SQL = """
UPDATE agendamento_exame
SET status = :status
WHERE id = :appointment_id;
"""

# 7) List doctor's agenda filtered by date/period and doctor name or specialty.
GET_DOCTOR_SCHEDULE_SQL = """
SELECT
    a.id AS agenda_id,
    a.data,
    a.horario,
    a.periodo,
    a.status,
    m.id AS doctor_id,
    m.nome AS doctor_name,
    e.id AS specialty_id,
    e.nome AS specialty_name
FROM agenda a
JOIN medico m ON m.id = a.id_medico
LEFT JOIN especialidade e ON e.id = m.especialidade_id
WHERE a.data = :data
  AND (:periodo IS NULL OR a.periodo = :periodo)
  AND (:doctor_name IS NULL OR m.nome = :doctor_name)
  AND (:specialty IS NULL OR e.nome = :specialty)
ORDER BY a.horario, m.nome;
"""

# 8) List available specialties to show in WhatsApp list/buttons.
GET_CALENDAR_SPECIALTIES_SQL = """
SELECT id, nome
FROM especialidade
ORDER BY nome;
"""

# 9) List doctors (optional filter by specialty) for WhatsApp list/buttons.
GET_CALENDAR_DOCTORS_SQL = """
SELECT
    m.id,
    m.nome,
    m.especialidade_id,
    e.nome AS especialidade_nome
FROM medico m
JOIN especialidade e ON e.id = m.especialidade_id
WHERE (:specialty_id IS NULL OR m.especialidade_id = :specialty_id)
ORDER BY m.nome;
"""

# 10) List agenda slots with IDs that patient can pick to schedule.
GET_CALENDAR_SLOTS_SQL = """
SELECT
    a.id AS agenda_id,
    a.data,
    a.horario,
    a.periodo,
    m.id AS doctor_id,
    m.nome AS doctor_name,
    e.id AS specialty_id,
    e.nome AS specialty_name
FROM agenda a
JOIN medico m ON m.id = a.id_medico
LEFT JOIN especialidade e ON e.id = m.especialidade_id
WHERE a.status = 'available'
  AND a.data = :data
  AND (:periodo IS NULL OR a.periodo = :periodo)
  AND (:specialty_id IS NULL OR m.especialidade_id = :specialty_id)
  AND (:doctor_id IS NULL OR m.id = :doctor_id)
ORDER BY a.horario, m.nome;
"""

# 10b) List available dates first (used to show "calendar-like" options in WhatsApp).
GET_CALENDAR_DATES_SQL = """
SELECT DISTINCT
    a.data
FROM agenda a
JOIN medico m ON m.id = a.id_medico
WHERE a.status = 'available'
  AND (:periodo IS NULL OR a.periodo = :periodo)
  AND (:specialty_id IS NULL OR m.especialidade_id = :specialty_id)
  AND (:doctor_id IS NULL OR m.id = :doctor_id)
  AND a.data >= CURRENT_DATE
ORDER BY a.data
LIMIT 30;
"""

# 11) Reserve consultation agenda only if the slot is still available.
RESERVE_AGENDA_SQL = """
UPDATE agenda
SET status = 'unavailable'
WHERE id = :agenda_id
  AND status = 'available';
"""

# 12) Release consultation agenda when appointment is canceled.
RELEASE_AGENDA_SQL = """
UPDATE agenda
SET status = 'available'
WHERE id = :agenda_id;
"""

# 13) Fetch linked agenda id for consultation cancellation flow.
GET_CONSULTA_AGENDA_ID_SQL = """
SELECT id_agenda
FROM consulta
WHERE id = :appointment_id
LIMIT 1;
"""

# 14) Create or update insurance plan data (used before linking to patient).
UPSERT_CONVENIO_SQL = """
INSERT INTO convenio (carteirinha_id, nome, data_de_expiracao)
VALUES (:carteirinha_id, :nome, :data_de_expiracao)
ON DUPLICATE KEY UPDATE
    nome = VALUES(nome),
    data_de_expiracao = VALUES(data_de_expiracao);
"""

# 15) List scheduled consultations for the patient identified by WhatsApp phone.
GET_PATIENT_CONSULTAS_BY_PHONE_SQL = """
SELECT
    c.id AS appointment_id,
    c.status,
    a.id AS agenda_id,
    a.data,
    a.horario,
    a.periodo,
    m.id AS doctor_id,
    m.nome AS doctor_name,
    e.nome AS specialty_name
FROM consulta c
JOIN paciente p ON p.id = c.id_paciente
JOIN agenda a ON a.id = c.id_agenda
JOIN medico m ON m.id = a.id_medico
LEFT JOIN especialidade e ON e.id = m.especialidade_id
WHERE p.telefone = :telefone
  AND c.status = 'agendada'
ORDER BY a.data, a.horario;
"""

# 16) List scheduled exams for the patient identified by WhatsApp phone.
GET_PATIENT_EXAMES_BY_PHONE_SQL = """
SELECT
    ae.id AS appointment_id,
    ae.status,
    a.id AS agenda_id,
    a.data,
    a.horario,
    a.periodo
FROM agendamento_exame ae
JOIN paciente p ON p.id = ae.id_paciente
JOIN agenda_exame a ON a.id = ae.id_agenda_exame
WHERE p.telefone = :telefone
  AND ae.status = 'agendada'
ORDER BY a.data, a.horario;
"""
