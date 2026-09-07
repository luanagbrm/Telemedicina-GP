"""SQLAdmin ModelViews (painel /admin) — alinhados ao modelo ER do time.

Entidades de agenda são gerenciáveis (CRUD). Dados de paciente, chat e auditoria
são somente leitura (LGPD: a equipe monitora, não edita). Hash de senha nunca é
listado nem editável.
"""

from sqladmin import ModelView

from app.models import (
    Agenda,
    AgendamentoExame,
    Consulta,
    Conversa,
    Convenio,
    Especialidade,
    Exame,
    LogAuditoria,
    Medico,
    Mensagem,
    Paciente,
    Usuario,
)

_AGENDA = "Agenda"
_EXAMES = "Exames"
_CHATBOT = "Chatbot"
_ADMIN = "Administração"


class EspecialidadeAdmin(ModelView, model=Especialidade):
    category = _AGENDA
    name = "Especialidade"
    name_plural = "Especialidades"
    icon = "fa-solid fa-stethoscope"
    column_list = [Especialidade.id, Especialidade.nome_especialidade]
    column_searchable_list = [Especialidade.nome_especialidade]
    column_sortable_list = [Especialidade.nome_especialidade]


class MedicoAdmin(ModelView, model=Medico):
    category = _AGENDA
    name = "Médico"
    name_plural = "Médicos"
    icon = "fa-solid fa-user-doctor"
    column_list = [Medico.id, Medico.nome, Medico.especialidade]
    column_searchable_list = [Medico.nome]
    column_sortable_list = [Medico.nome]


class AgendaAdmin(ModelView, model=Agenda):
    category = _AGENDA
    name = "Horário (Agenda)"
    name_plural = "Agenda"
    icon = "fa-solid fa-clock"
    column_list = [
        Agenda.id,
        Agenda.medico,
        Agenda.data,
        Agenda.horario,
        Agenda.periodo,
        Agenda.status_horario,
    ]
    column_sortable_list = [Agenda.data, Agenda.status_horario]
    column_default_sort = [(Agenda.data, False)]


class ConsultaAdmin(ModelView, model=Consulta):
    category = _AGENDA
    name = "Consulta"
    name_plural = "Consultas"
    icon = "fa-solid fa-calendar-check"
    column_list = [
        Consulta.id,
        Consulta.paciente,
        Consulta.agenda,
        Consulta.status_consulta,
        Consulta.created_at,
    ]
    column_sortable_list = [Consulta.status_consulta, Consulta.created_at]
    column_default_sort = [(Consulta.created_at, True)]


class ExameAdmin(ModelView, model=Exame):
    category = _EXAMES
    name = "Exame (catálogo)"
    name_plural = "Exames"
    icon = "fa-solid fa-flask-vial"
    column_list = [Exame.id, Exame.nome_exame, Exame.duracao_minutos]
    column_searchable_list = [Exame.nome_exame]


class AgendamentoExameAdmin(ModelView, model=AgendamentoExame):
    category = _EXAMES
    name = "Agendamento de exame"
    name_plural = "Agendamentos de exame"
    icon = "fa-solid fa-calendar-plus"
    column_list = [
        AgendamentoExame.id,
        AgendamentoExame.exame,
        AgendamentoExame.paciente,
        AgendamentoExame.data,
        AgendamentoExame.horario,
        AgendamentoExame.status_exame,
    ]
    column_sortable_list = [AgendamentoExame.data, AgendamentoExame.status_exame]
    column_default_sort = [(AgendamentoExame.data, False)]


class ConvenioAdmin(ModelView, model=Convenio):
    category = _AGENDA
    name = "Convênio"
    name_plural = "Convênios"
    icon = "fa-solid fa-id-card"
    column_list = [Convenio.carteirinha, Convenio.nome_convenio, Convenio.data_expiracao]
    column_searchable_list = [Convenio.nome_convenio, Convenio.carteirinha]


class PacienteAdmin(ModelView, model=Paciente):
    category = _AGENDA
    name = "Paciente"
    name_plural = "Pacientes"
    icon = "fa-solid fa-user"
    # Read-only: LGPD — staff apenas visualiza os dados do paciente.
    can_create = False
    can_edit = False
    can_delete = False
    column_list = [
        Paciente.id,
        Paciente.nome_completo,
        Paciente.telefone,
        Paciente.cpf,
        Paciente.carteirinha,
        Paciente.created_at,
    ]
    column_searchable_list = [Paciente.telefone, Paciente.nome_completo, Paciente.cpf]


class ConversaAdmin(ModelView, model=Conversa):
    category = _CHATBOT
    name = "Conversa"
    name_plural = "Conversas"
    icon = "fa-solid fa-comments"
    can_create = False
    can_edit = False
    can_delete = False
    column_list = [Conversa.id, Conversa.wa_id, Conversa.paciente, Conversa.ativa, Conversa.updated_at]
    column_searchable_list = [Conversa.wa_id]
    column_default_sort = [(Conversa.updated_at, True)]


class MensagemAdmin(ModelView, model=Mensagem):
    category = _CHATBOT
    name = "Mensagem"
    name_plural = "Mensagens"
    icon = "fa-solid fa-message"
    can_create = False
    can_edit = False
    can_delete = False
    column_list = [
        Mensagem.id,
        Mensagem.conversa_id,
        Mensagem.from_user,
        Mensagem.canal,
        Mensagem.intencao,
        Mensagem.conteudo,
        Mensagem.created_at,
    ]
    column_default_sort = [(Mensagem.created_at, True)]


class LogAuditoriaAdmin(ModelView, model=LogAuditoria):
    category = _ADMIN
    name = "Log de auditoria"
    name_plural = "Logs de auditoria"
    icon = "fa-solid fa-clipboard-list"
    can_create = False
    can_edit = False
    can_delete = False
    column_list = [
        LogAuditoria.id,
        LogAuditoria.usuario_id,
        LogAuditoria.acao,
        LogAuditoria.recurso,
        LogAuditoria.recurso_id,
        LogAuditoria.timestamp,
    ]
    column_default_sort = [(LogAuditoria.timestamp, True)]


class UsuarioAdmin(ModelView, model=Usuario):
    category = _ADMIN
    name = "Usuário (painel)"
    name_plural = "Usuários (painel)"
    icon = "fa-solid fa-user-gear"
    # Read-only: contas são criadas via script para nunca gravar senha em texto puro.
    can_create = False
    can_edit = False
    can_delete = False
    column_list = [Usuario.id, Usuario.nome, Usuario.email, Usuario.perfil, Usuario.ativo]
    column_details_exclude_list = [Usuario.senha_hash]
    column_searchable_list = [Usuario.email, Usuario.nome]


ALL_VIEWS = [
    EspecialidadeAdmin,
    MedicoAdmin,
    AgendaAdmin,
    ConsultaAdmin,
    ExameAdmin,
    AgendamentoExameAdmin,
    ConvenioAdmin,
    PacienteAdmin,
    ConversaAdmin,
    MensagemAdmin,
    LogAuditoriaAdmin,
    UsuarioAdmin,
]
