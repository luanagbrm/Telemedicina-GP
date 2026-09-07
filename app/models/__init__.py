"""ORM models. Importing this package registers all tables on Base.metadata."""

from app.models.agenda import Agenda
from app.models.chatbot import Conversa, Mensagem
from app.models.consulta import Consulta
from app.models.convenio import Convenio
from app.models.enums import (
    AcaoAuditoria,
    CanalMensagem,
    IntencaoChatbot,
    Perfil,
    StatusConsulta,
    StatusExame,
    StatusHorario,
)
from app.models.especialidade import Especialidade
from app.models.exame import AgendamentoExame, Exame
from app.models.log_auditoria import LogAuditoria
from app.models.medico import Medico
from app.models.paciente import Paciente
from app.models.usuario import Usuario

__all__ = [
    # Domínio de agendamento (modelo ER do time)
    "Convenio",
    "Paciente",
    "Especialidade",
    "Medico",
    "Agenda",
    "Consulta",
    "Exame",
    "AgendamentoExame",
    # Chatbot
    "Conversa",
    "Mensagem",
    # Painel admin / infra
    "Usuario",
    "LogAuditoria",
    # Enums
    "Perfil",
    "StatusHorario",
    "StatusConsulta",
    "StatusExame",
    "CanalMensagem",
    "IntencaoChatbot",
    "AcaoAuditoria",
]
